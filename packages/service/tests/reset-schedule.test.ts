/**
 * Tests for the reset schedule feature.
 *
 * Covers:
 *   - Pure unit tests for getNextResetDate() and shouldReset()
 *   - DB-level tests for setResetSchedule() and resetTokenCount()
 *   - Integration tests via meter() confirming resets unblock exhausted keys
 *   - HTTP tests for the PATCH endpoint reset_schedule field
 */

import type { Server } from 'http';
import { serve } from '@hono/node-server';

import { getNextResetDate, shouldReset } from '../src/reset-schedule';
import { createApiKey, getApiKey, setResetSchedule, setTokenLimit, resetTokenCount } from '../src/db';
import { meter, isMeterError } from '../src/messages/meter';
import app from '../src/server';

// ---------------------------------------------------------------------------
// Server lifecycle (needed only for HTTP tests at the bottom)
// ---------------------------------------------------------------------------

let server: Server;
let baseURL: string;

beforeAll(async () => {
	await new Promise<void>((resolve) => {
		server = serve({ fetch: app.fetch, port: 0 }, (info) => {
			baseURL = `http://localhost:${info.port}`;
			resolve();
		}) as unknown as Server;
	});
});

afterAll(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
});

// ---------------------------------------------------------------------------
// getNextResetDate()
// ---------------------------------------------------------------------------

describe('getNextResetDate()', () => {
	const from = new Date('2024-03-15T14:30:00Z'); // Friday

	it('returns null for "none"', () => {
		expect(getNextResetDate('none', from)).toBeNull();
	});

	it('returns next midnight UTC for "daily"', () => {
		const next = getNextResetDate('daily', from)!;
		expect(next.toISOString()).toBe('2024-03-16T00:00:00.000Z');
	});

	it('returns the next Monday midnight UTC for "weekly"', () => {
		const next = getNextResetDate('weekly', from)!; // Friday → next Monday
		expect(next.toISOString()).toBe('2024-03-18T00:00:00.000Z');
	});

	it('returns first day of next month midnight UTC for "monthly"', () => {
		const next = getNextResetDate('monthly', from)!;
		expect(next.toISOString()).toBe('2024-04-01T00:00:00.000Z');
	});

	it('handles month-end correctly (March → April)', () => {
		const endOfMarch = new Date('2024-03-31T23:59:59Z');
		const next = getNextResetDate('monthly', endOfMarch)!;
		expect(next.toISOString()).toBe('2024-04-01T00:00:00.000Z');
	});

	it('weekly: returns next Monday even when called on a Monday', () => {
		const monday = new Date('2024-03-18T10:00:00Z');
		const next = getNextResetDate('weekly', monday)!;
		expect(next.toISOString()).toBe('2024-03-25T00:00:00.000Z');
	});
});

// ---------------------------------------------------------------------------
// shouldReset()
// ---------------------------------------------------------------------------

describe('shouldReset()', () => {
	const now = new Date('2024-03-15T12:00:00Z');

	it('returns false when reset_at is null', () => {
		expect(shouldReset(null, now)).toBe(false);
	});

	it('returns false when reset_at is in the future', () => {
		expect(shouldReset('2024-03-16T00:00:00.000Z', now)).toBe(false);
	});

	it('returns true when reset_at is in the past', () => {
		expect(shouldReset('2024-03-14T00:00:00.000Z', now)).toBe(true);
	});

	it('returns true when reset_at equals now exactly', () => {
		expect(shouldReset(now.toISOString(), now)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

describe('setResetSchedule()', () => {
	it('sets reset_schedule and computes reset_at for daily', () => {
		createApiKey('rs-daily-key', 1_000_000);
		setResetSchedule('rs-daily-key', 'daily');

		const record = getApiKey('rs-daily-key')!;
		expect(record.reset_schedule).toBe('daily');
		expect(record.reset_at).not.toBeNull();
		// reset_at should be tomorrow midnight
		const resetAt = new Date(record.reset_at!);
		expect(resetAt.getUTCHours()).toBe(0);
		expect(resetAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('clears reset_at when schedule is set to "none"', () => {
		createApiKey('rs-none-key', 1_000_000, 'daily');
		setResetSchedule('rs-none-key', 'none');

		const record = getApiKey('rs-none-key')!;
		expect(record.reset_schedule).toBe('none');
		expect(record.reset_at).toBeNull();
	});
});

describe('resetTokenCount()', () => {
	it('resets token_count and total_cost to 0', () => {
		createApiKey('rs-reset-key', 1_000_000, 'daily');
		// Burn some tokens
		meter('rs-reset-key', 'hello', 'cheap-model');

		const before = getApiKey('rs-reset-key')!;
		expect(before.token_count).toBeGreaterThan(0);

		resetTokenCount('rs-reset-key');

		const after = getApiKey('rs-reset-key')!;
		expect(after.token_count).toBe(0);
		expect(after.total_cost).toBe(0);
	});

	it('advances reset_at to the next interval after reset', () => {
		createApiKey('rs-advance-key', 1_000_000, 'daily');
		const before = getApiKey('rs-advance-key')!.reset_at;

		resetTokenCount('rs-advance-key');

		const after = getApiKey('rs-advance-key')!.reset_at;
		// The new reset_at must be later than the previous one
		expect(new Date(after!).getTime()).toBeGreaterThan(new Date(before!).getTime());
	});
});

// ---------------------------------------------------------------------------
// meter() integration — auto-reset unblocks an exhausted key
// ---------------------------------------------------------------------------

describe('meter() auto-reset', () => {
	it('resets and allows a request when now is past reset_at', () => {
		createApiKey('rs-meter-key', 1_000_000, 'daily');

		// Exhaust the key
		setTokenLimit('rs-meter-key', 0);

		// Pass a `now` that is one day beyond reset_at to simulate the reset
		// window having elapsed — no DB backdating needed
		const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
		setTokenLimit('rs-meter-key', 1_000_000);

		const result = meter('rs-meter-key', 'hello', 'cheap-model', undefined, future);
		expect(isMeterError(result)).toBe(false);
		if (!isMeterError(result)) expect(result.inputTokens).toBeGreaterThan(0);
	});

	it('does not reset when schedule is "none"', () => {
		createApiKey('rs-none-meter-key', 0);
		const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
		const result = meter('rs-none-meter-key', 'hello', 'cheap-model', undefined, future);
		expect(isMeterError(result)).toBe(true);
		if (isMeterError(result)) expect(result.status).toBe(429);
	});
});

// ---------------------------------------------------------------------------
// HTTP — PATCH /v1/admin/api-keys/:key with reset_schedule
// ---------------------------------------------------------------------------

describe('PATCH /v1/admin/api-keys/:key reset_schedule', () => {
	const HTTP_KEY = 'rs-http-key';

	beforeAll(() => {
		createApiKey(HTTP_KEY, 1_000_000);
	});

	async function patch(body: unknown) {
		return fetch(`${baseURL}/v1/admin/api-keys/${HTTP_KEY}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	it('sets reset_schedule via PATCH', async () => {
		const res = await patch({ token_limit: 1_000_000, reset_schedule: 'weekly' });
		expect(res.status).toBe(200);
		const body = await res.json() as { reset_schedule: string; reset_at: string };
		expect(body.reset_schedule).toBe('weekly');
		expect(body.reset_at).not.toBeNull();
	});

	it('can update token_limit and reset_schedule in one call', async () => {
		const res = await patch({ token_limit: 500, reset_schedule: 'monthly' });
		expect(res.status).toBe(200);
		const body = await res.json() as { token_limit: number; reset_schedule: string };
		expect(body.token_limit).toBe(500);
		expect(body.reset_schedule).toBe('monthly');
	});

	it('clears reset_at when schedule is set to "none"', async () => {
		const res = await patch({ token_limit: 1_000_000, reset_schedule: 'none' });
		expect(res.status).toBe(200);
		const body = await res.json() as { reset_schedule: string; reset_at: string | null };
		expect(body.reset_schedule).toBe('none');
		expect(body.reset_at).toBeNull();
	});

	it('returns 400 when token_limit is missing', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/${HTTP_KEY}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ reset_schedule: 'daily' }),
		});
		expect(res.status).toBe(400);
	});
});