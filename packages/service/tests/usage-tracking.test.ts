/**
 * Tests for usage tracking and reporting.
 *
 * Covers:
 *   - recordUsage() writes a row to usage_events
 *   - getUsageHistory() returns events in descending order, filtered by date
 *   - getUsageSummary() aggregates correctly by date and model
 *   - meter() calls recordUsage() as a side effect
 *   - GET /v1/admin/api-keys/:key/usage HTTP endpoint
 *   - GET /v1/admin/api-keys/:key/usage/summary HTTP endpoint
 */

import type { Server } from 'http';
import { serve } from '@hono/node-server';

import {
	createApiKey,
	recordUsage,
	getUsageHistory,
	getUsageSummary,
	type UsageEvent,
	type UsageSummaryRow,
} from '../src/db';
import { meter } from '../src/messages/meter';
import app from '../src/server';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseURL: string;

const USAGE_KEY = 'usage-tracking-key';

beforeAll(async () => {
	createApiKey(USAGE_KEY, 1_000_000);

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
// recordUsage()
// ---------------------------------------------------------------------------

describe('recordUsage()', () => {
	it('inserts a row into usage_events', () => {
		const key = 'record-usage-key';
		createApiKey(key, 1_000_000);

		recordUsage(key, 'cheap-model', 'anthropic', 10, 20, 0.006, '2024-01-15T10:00:00.000Z');

		const events = getUsageHistory(key);
		expect(events).toHaveLength(1);

		const e = events[0];
		expect(e.api_key).toBe(key);
		expect(e.model).toBe('cheap-model');
		expect(e.provider).toBe('anthropic');
		expect(e.input_tokens).toBe(10);
		expect(e.output_tokens).toBe(20);
		expect(e.cost).toBeCloseTo(0.006);
		expect(e.ts).toBe('2024-01-15T10:00:00.000Z');
	});
});

// ---------------------------------------------------------------------------
// getUsageHistory()
// ---------------------------------------------------------------------------

describe('getUsageHistory()', () => {
	const key = 'history-key';

	beforeAll(() => {
		createApiKey(key, 1_000_000);
		recordUsage(key, 'cheap-model',     'anthropic', 10, 20, 0.006, '2024-01-10T09:00:00.000Z');
		recordUsage(key, 'gpt-decent',      'openai',    15, 25, 0.016, '2024-01-11T10:00:00.000Z');
		recordUsage(key, 'gemini-decent',   'gemini',    20, 30, 0.020, '2024-01-12T11:00:00.000Z');
	});

	it('returns all events newest first', () => {
		const events = getUsageHistory(key);
		expect(events).toHaveLength(3);
		expect(events[0].model).toBe('gemini-decent');
		expect(events[2].model).toBe('cheap-model');
	});

	it('filters by from date', () => {
		const events = getUsageHistory(key, '2024-01-11T00:00:00.000Z');
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.ts >= '2024-01-11T00:00:00.000Z')).toBe(true);
	});

	it('filters by to date', () => {
		const events = getUsageHistory(key, undefined, '2024-01-11T23:59:59.000Z');
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.ts <= '2024-01-11T23:59:59.000Z')).toBe(true);
	});

	it('filters by from and to date', () => {
		const events = getUsageHistory(
			key,
			'2024-01-11T00:00:00.000Z',
			'2024-01-11T23:59:59.000Z'
		);
		expect(events).toHaveLength(1);
		expect(events[0].model).toBe('gpt-decent');
	});

	it('returns empty array when no events match', () => {
		const events = getUsageHistory(key, '2025-01-01T00:00:00.000Z');
		expect(events).toHaveLength(0);
	});

	it('is isolated per key', () => {
		const otherKey = 'history-other-key';
		createApiKey(otherKey, 1_000_000);
		expect(getUsageHistory(otherKey)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// getUsageSummary()
// ---------------------------------------------------------------------------

describe('getUsageSummary()', () => {
	const key = 'summary-key';

	beforeAll(() => {
		createApiKey(key, 1_000_000);
		// Two requests on the same day with the same model → should aggregate
		recordUsage(key, 'cheap-model', 'anthropic', 10, 20, 0.006, '2024-02-01T08:00:00.000Z');
		recordUsage(key, 'cheap-model', 'anthropic', 5,  15, 0.004, '2024-02-01T09:00:00.000Z');
		// Different model, same day
		recordUsage(key, 'gpt-decent',  'openai',    20, 30, 0.020, '2024-02-01T10:00:00.000Z');
		// Different day
		recordUsage(key, 'cheap-model', 'anthropic', 8,  12, 0.004, '2024-02-02T08:00:00.000Z');
	});

	it('aggregates requests on the same date and model', () => {
		const rows = getUsageSummary(key);
		const jan1Cheap = rows.find((r) => r.date === '2024-02-01' && r.model === 'cheap-model');

		expect(jan1Cheap).toBeDefined();
		expect(jan1Cheap!.requests).toBe(2);
		expect(jan1Cheap!.input_tokens).toBe(15);
		expect(jan1Cheap!.output_tokens).toBe(35);
		expect(jan1Cheap!.total_tokens).toBe(50);
	});

	it('returns separate rows for different models on the same day', () => {
		const rows = getUsageSummary(key).filter((r) => r.date === '2024-02-01');
		expect(rows).toHaveLength(2);
	});

	it('returns separate rows for different days', () => {
		const rows = getUsageSummary(key);
		const dates = [...new Set(rows.map((r) => r.date))];
		expect(dates).toHaveLength(2);
	});

	it('returns rows newest date first', () => {
		const rows = getUsageSummary(key);
		expect(rows[0].date >= rows[rows.length - 1].date).toBe(true);
	});

	it('filters by from / to date range', () => {
		const rows = getUsageSummary(key, '2024-02-02T00:00:00.000Z');
		expect(rows.every((r) => r.date >= '2024-02-02')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// meter() records usage as a side effect
// ---------------------------------------------------------------------------

describe('meter() usage recording', () => {
	it('records one event per successful request', () => {
		const key = 'meter-usage-key';
		createApiKey(key, 1_000_000);

		const before = getUsageHistory(key).length;
		meter(key, 'hello world', 'cheap-model');
		const after = getUsageHistory(key);

		expect(after.length).toBe(before + 1);

		const event = after[0];
		expect(event.model).toBe('cheap-model');
		expect(event.provider).toBe('anthropic');
		expect(event.input_tokens).toBeGreaterThan(0);
		expect(event.output_tokens).toBeGreaterThan(0);
		expect(event.cost).toBeGreaterThan(0);
	});

	it('does not record an event when the key is invalid', () => {
		const before = getUsageHistory('meter-usage-key').length;
		meter('nonexistent-key', 'hello', 'cheap-model');
		expect(getUsageHistory('meter-usage-key').length).toBe(before);
	});

	it('does not record an event when the token limit is exceeded', () => {
		const key = 'meter-exhausted-key';
		createApiKey(key, 0);
		meter(key, 'hello', 'cheap-model');
		expect(getUsageHistory(key)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// HTTP endpoints
// ---------------------------------------------------------------------------

describe('GET /v1/admin/api-keys/:key/usage', () => {
	beforeAll(async () => {
		// Trigger a real request so there is at least one event for USAGE_KEY
		await fetch(`${baseURL}/v1/messages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': USAGE_KEY },
			body: JSON.stringify({
				model: 'cheap-model',
				messages: [{ role: 'user', content: 'hello usage' }],
			}),
		});
	});

	it('returns usage events for a valid key', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/${USAGE_KEY}/usage`);
		expect(res.status).toBe(200);

		const events = await res.json() as UsageEvent[];
		expect(Array.isArray(events)).toBe(true);
		expect(events.length).toBeGreaterThan(0);
		expect(events[0]).toMatchObject({
			api_key: USAGE_KEY,
			model: 'cheap-model',
			provider: 'anthropic',
		});
	});

	it('accepts from/to query params', async () => {
		const from = new Date(Date.now() - 60_000).toISOString();
		const to = new Date(Date.now() + 60_000).toISOString();
		const res = await fetch(
			`${baseURL}/v1/admin/api-keys/${USAGE_KEY}/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
		);
		expect(res.status).toBe(200);
		const events = await res.json() as UsageEvent[];
		expect(events.length).toBeGreaterThan(0);
	});

	it('returns 404 for unknown key', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/no-such-key/usage`);
		expect(res.status).toBe(404);
	});
});

describe('GET /v1/admin/api-keys/:key/usage/summary', () => {
	it('returns aggregated summary for a valid key', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/${USAGE_KEY}/usage/summary`);
		expect(res.status).toBe(200);

		const rows = await res.json() as UsageSummaryRow[];
		expect(Array.isArray(rows)).toBe(true);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]).toMatchObject({ model: 'cheap-model', provider: 'anthropic' });
		expect(typeof rows[0].requests).toBe('number');
		expect(typeof rows[0].total_tokens).toBe('number');
		expect(typeof rows[0].cost).toBe('number');
	});

	it('returns 404 for unknown key', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/no-such-key/usage/summary`);
		expect(res.status).toBe(404);
	});
});