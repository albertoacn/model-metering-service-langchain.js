/**
 * Per-API-key rate limiting and concurrency control — backed by SQLite.
 *
 * Uses the shared database instance from db/index.ts so rate limit state is
 * co-located with key records, survives restarts (when using a file DB), and
 * is consistent within a single process without any extra synchronisation.
 *
 * Rate limiting:  sliding window stored in the request_log table.
 *                 Expired rows are pruned on each check.
 *
 * Concurrency:    concurrent_requests counter column on api_keys,
 *                 incremented on acquire and decremented on release using
 *                 SQLite's atomic UPDATE so the counter is always consistent.
 */

import { db } from '../db';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
	/** Max requests allowed within the window. Default: 60 */
	maxRequestsPerWindow: number;
	/** Window duration in milliseconds. Default: 60_000 (1 minute) */
	windowMs: number;
	/** Max simultaneous in-flight requests per key. Default: 10 */
	maxConcurrent: number;
}

export const DEFAULT_CONFIG: RateLimiterConfig = {
	maxRequestsPerWindow: 60,
	windowMs: 60_000,
	maxConcurrent: 10,
};

// ---------------------------------------------------------------------------
// Rate limiting — sliding window via request_log table
// ---------------------------------------------------------------------------

export interface RateLimitResult {
	allowed: boolean;
	current: number;
	limit: number;
	/** ms until the oldest in-window request expires. 0 when allowed. */
	retryAfterMs: number;
}

/**
 * Records a new request attempt and returns whether it is within the limit.
 * Prunes expired rows from request_log as a side effect (keeps the table lean).
 */
export function checkRateLimit(
	apiKey: string,
	now: number = Date.now(),
	config: RateLimiterConfig = DEFAULT_CONFIG
): RateLimitResult {
	const windowStart = now - config.windowMs;

	// Prune expired entries for this key
	db.prepare('DELETE FROM request_log WHERE api_key = ? AND ts <= ?').run(apiKey, windowStart);

	// Count remaining entries in the window
	const { count } = db.prepare(
		'SELECT COUNT(*) as count FROM request_log WHERE api_key = ?'
	).get(apiKey) as { count: number };

	if (count >= config.maxRequestsPerWindow) {
		const oldest = db.prepare(
			'SELECT MIN(ts) as ts FROM request_log WHERE api_key = ?'
		).get(apiKey) as { ts: number };
		return {
			allowed: false,
			current: count,
			limit: config.maxRequestsPerWindow,
			retryAfterMs: oldest.ts - windowStart,
		};
	}

	db.prepare('INSERT INTO request_log (api_key, ts) VALUES (?, ?)').run(apiKey, now);
	return { allowed: true, current: count + 1, limit: config.maxRequestsPerWindow, retryAfterMs: 0 };
}

// ---------------------------------------------------------------------------
// Concurrency — counter column on api_keys
// ---------------------------------------------------------------------------

export interface ConcurrencyResult {
	allowed: boolean;
	current: number;
	limit: number;
}

/**
 * Atomically increments concurrent_requests if under the cap.
 * On success, caller MUST call releaseConcurrency() when the request ends.
 */
export function acquireConcurrency(
	apiKey: string,
	config: RateLimiterConfig = DEFAULT_CONFIG
): ConcurrencyResult {
	// Upsert ensures a row exists even if this key has never been seen before
	db.prepare(
		'INSERT INTO concurrent_requests (api_key, count) VALUES (?, 0) ON CONFLICT(api_key) DO NOTHING'
	).run(apiKey);

	const { count } = db.prepare(
		'SELECT count FROM concurrent_requests WHERE api_key = ?'
	).get(apiKey) as { count: number };

	if (count >= config.maxConcurrent) {
		return { allowed: false, current: count, limit: config.maxConcurrent };
	}

	db.prepare(
		'UPDATE concurrent_requests SET count = count + 1 WHERE api_key = ?'
	).run(apiKey);

	return { allowed: true, current: count + 1, limit: config.maxConcurrent };
}

/** Decrements the concurrency counter. Safe to call even if no slot was held. */
export function releaseConcurrency(apiKey: string): void {
	db.prepare(
		'UPDATE concurrent_requests SET count = MAX(0, count - 1) WHERE api_key = ?'
	).run(apiKey);
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/** Clears all rate limit state. Call in beforeEach to isolate tests. */
export function _resetState(): void {
	db.prepare('DELETE FROM request_log').run();
	db.prepare('DELETE FROM concurrent_requests').run();
}