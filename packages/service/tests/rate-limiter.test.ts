/**
 * Tests for per-API-key rate limiting and concurrency control.
 *
 * Covers:
 *   - Unit tests for checkRateLimit() sliding window
 *   - Unit tests for acquireConcurrency() / releaseConcurrency()
 *   - Integration tests via HTTP confirming 429 responses
 */

import type { Server } from 'http';
import { serve } from '@hono/node-server';

import {
	checkRateLimit,
	acquireConcurrency,
	releaseConcurrency,
	_resetState,
	DEFAULT_CONFIG,
	type RateLimiterConfig,
} from '../src/rate-limiter';
import { createApiKey } from '../src/db';
import app from '../src/server';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseURL: string;

beforeAll(async () => {
	createApiKey('rl-valid-key', 1_000_000);

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

beforeEach(() => {
	_resetState();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tightConfig: RateLimiterConfig = {
	maxRequestsPerWindow: 3,
	windowMs: 60_000,
	maxConcurrent: 2,
};

async function postMessage(apiKey = 'rl-valid-key') {
	return fetch(`${baseURL}/v1/messages`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
		body: JSON.stringify({
			model: 'cheap-model',
			messages: [{ role: 'user', content: 'hello' }],
		}),
	});
}

// ---------------------------------------------------------------------------
// checkRateLimit() — sliding window
// ---------------------------------------------------------------------------

describe('checkRateLimit()', () => {
	it('allows requests under the limit', () => {
		const result = checkRateLimit('key-a', 1000, tightConfig);
		expect(result.allowed).toBe(true);
		expect(result.current).toBe(1);
	});

	it('allows exactly maxRequestsPerWindow requests', () => {
		checkRateLimit('key-b', 1000, tightConfig);
		checkRateLimit('key-b', 2000, tightConfig);
		const third = checkRateLimit('key-b', 3000, tightConfig);
		expect(third.allowed).toBe(true);
		expect(third.current).toBe(3);
	});

	it('rejects the request that exceeds the limit', () => {
		checkRateLimit('key-c', 1000, tightConfig);
		checkRateLimit('key-c', 2000, tightConfig);
		checkRateLimit('key-c', 3000, tightConfig);
		const fourth = checkRateLimit('key-c', 4000, tightConfig);
		expect(fourth.allowed).toBe(false);
		expect(fourth.current).toBe(3);
		expect(fourth.retryAfterMs).toBeGreaterThan(0);
	});

	it('allows again after the window slides past old requests', () => {
		const t0 = 0;
		checkRateLimit('key-d', t0, tightConfig);
		checkRateLimit('key-d', t0 + 1000, tightConfig);
		checkRateLimit('key-d', t0 + 2000, tightConfig);

		// Slide window past all three: t0 + windowMs + 1 > t0 + windowMs
		const tLater = t0 + tightConfig.windowMs + 1;
		const result = checkRateLimit('key-d', tLater, tightConfig);
		expect(result.allowed).toBe(true);
	});

	it('tracks keys independently', () => {
		for (let i = 0; i < tightConfig.maxRequestsPerWindow; i++) {
			checkRateLimit('key-x', i * 100, tightConfig);
		}
		// key-y is unaffected
		const result = checkRateLimit('key-y', 0, tightConfig);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// acquireConcurrency() / releaseConcurrency()
// ---------------------------------------------------------------------------

describe('acquireConcurrency()', () => {
	it('allows up to maxConcurrent slots', () => {
		const first = acquireConcurrency('conc-a', tightConfig);
		const second = acquireConcurrency('conc-a', tightConfig);
		expect(first.allowed).toBe(true);
		expect(second.allowed).toBe(true);
		expect(second.current).toBe(2);
	});

	it('rejects when the limit is reached', () => {
		acquireConcurrency('conc-b', tightConfig);
		acquireConcurrency('conc-b', tightConfig);
		const third = acquireConcurrency('conc-b', tightConfig);
		expect(third.allowed).toBe(false);
		expect(third.current).toBe(2);
	});

	it('allows a new request after a slot is released', () => {
		acquireConcurrency('conc-c', tightConfig);
		acquireConcurrency('conc-c', tightConfig);

		releaseConcurrency('conc-c');

		const next = acquireConcurrency('conc-c', tightConfig);
		expect(next.allowed).toBe(true);
	});

	it('release is a no-op when no slots are held', () => {
		expect(() => releaseConcurrency('conc-nobody')).not.toThrow();
	});

	it('tracks keys independently', () => {
		acquireConcurrency('conc-d', tightConfig);
		acquireConcurrency('conc-d', tightConfig);

		// conc-e is unaffected
		const result = acquireConcurrency('conc-e', tightConfig);
		expect(result.allowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// HTTP integration
// ---------------------------------------------------------------------------

describe('rate limiting via HTTP', () => {
	it('returns 200 for normal requests', async () => {
		const res = await postMessage();
		expect(res.status).toBe(200);
	});

	it('returns 429 with error body when rate limit is exceeded', async () => {
		// Saturate the default window (60 req/min) by injecting directly
		const { checkRateLimit } = await import('../src/rate-limiter');
		const now = Date.now();
		for (let i = 0; i < DEFAULT_CONFIG.maxRequestsPerWindow; i++) {
			checkRateLimit('rl-valid-key', now + i);
		}

		const res = await postMessage('rl-valid-key');
		expect(res.status).toBe(429);
		const body = await res.json() as { error: string; retry_after_ms: number };
		expect(body.error).toContain('Rate limit');
		expect(body.retry_after_ms).toBeGreaterThan(0);
	});
});

describe('concurrency limiting via HTTP', () => {
	it('returns 429 when concurrency limit is already saturated', async () => {
		// Saturate the concurrency slots directly so we can test the HTTP response
		// without needing to fire parallel requests (which are hard to synchronise).
		for (let i = 0; i < DEFAULT_CONFIG.maxConcurrent; i++) {
			acquireConcurrency('rl-valid-key');
		}

		const res = await postMessage('rl-valid-key');
		expect(res.status).toBe(429);
		const body = await res.json() as { error: string; limit: number };
		expect(body.error).toContain('concurrent');
		expect(body.limit).toBe(DEFAULT_CONFIG.maxConcurrent);

		// Clean up slots so other tests aren't affected
		for (let i = 0; i < DEFAULT_CONFIG.maxConcurrent; i++) {
			releaseConcurrency('rl-valid-key');
		}
	});
});