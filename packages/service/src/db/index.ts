/**
 * In-memory SQLite storage for API key metering data.
 */

import { DatabaseSync } from 'node:sqlite';
import type { ResetSchedule } from '../reset-schedule';

const db = new DatabaseSync(':memory:');

export { db };

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    api_key              TEXT    PRIMARY KEY,
    token_limit          INTEGER NOT NULL,
    token_count          INTEGER NOT NULL DEFAULT 0,
    total_cost           REAL    NOT NULL DEFAULT 0,
    reset_schedule       TEXT    NOT NULL DEFAULT 'none',
    reset_at             TEXT
  );

  CREATE TABLE IF NOT EXISTS request_log (
    api_key    TEXT    NOT NULL,
    ts         INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_request_log_api_key_ts ON request_log (api_key, ts);

  CREATE TABLE IF NOT EXISTS concurrent_requests (
    api_key  TEXT    PRIMARY KEY,
    count    INTEGER NOT NULL DEFAULT 0
  );
`);

export interface ApiKeyRecord {
	api_key: string;
	token_limit: number;
	token_count: number;
	total_cost: number;
	reset_schedule: ResetSchedule;
	reset_at: string | null;
}

export function createApiKey(apiKey: string, tokenLimit: number, resetSchedule: ResetSchedule = 'none') {
	const stmt = db.prepare(
		'INSERT INTO api_keys (api_key, token_limit, token_count, total_cost, reset_schedule, reset_at) VALUES (?, ?, 0, 0, ?, ?)'
	);
	const resetAt = getInitialResetAt(resetSchedule);
	stmt.run(apiKey, tokenLimit, resetSchedule, resetAt);
}

export function getApiKey(apiKey: string) {
	const stmt = db.prepare('SELECT * FROM api_keys WHERE api_key = ?');
	return stmt.get(apiKey) as ApiKeyRecord | undefined;
}

export function incrementTokenCount(apiKey: string, amount: number) {
	const stmt = db.prepare('UPDATE api_keys SET token_count = token_count + ? WHERE api_key = ?');
	return stmt.run(amount, apiKey);
}

export function incrementCost(apiKey: string, amount: number) {
	const stmt = db.prepare('UPDATE api_keys SET total_cost = total_cost + ? WHERE api_key = ?');
	return stmt.run(amount, apiKey);
}

export function setTokenLimit(apiKey: string, tokenLimit: number) {
	const stmt = db.prepare('UPDATE api_keys SET token_limit = ? WHERE api_key = ?');
	return stmt.run(tokenLimit, apiKey);
}

export function setResetSchedule(apiKey: string, schedule: ResetSchedule) {
	const resetAt = getInitialResetAt(schedule);
	const stmt = db.prepare('UPDATE api_keys SET reset_schedule = ?, reset_at = ? WHERE api_key = ?');
	return stmt.run(schedule, resetAt, apiKey);
}

/**
 * Resets token_count and total_cost to 0, then advances reset_at to the
 * next interval based on the key's current schedule.
 */
export function resetTokenCount(apiKey: string) {
	const record = getApiKey(apiKey);
	if (!record) return;

	const { getNextResetDate } = require('../reset-schedule') as typeof import('../reset-schedule');
	// Advance from the current reset_at (not now) so the next window is always
	// one full interval ahead, regardless of when the reset is actually triggered.
	const baseDate = record.reset_at ? new Date(record.reset_at) : new Date();
	const nextReset = getNextResetDate(record.reset_schedule, baseDate);
	const nextResetAt = nextReset ? nextReset.toISOString() : null;

	const stmt = db.prepare(
		'UPDATE api_keys SET token_count = 0, total_cost = 0, reset_at = ? WHERE api_key = ?'
	);
	stmt.run(nextResetAt, apiKey);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getInitialResetAt(schedule: ResetSchedule): string | null {
	if (schedule === 'none') return null;
	// Defer the import to avoid a circular dependency at module load time
	const { getNextResetDate } = require('../reset-schedule') as typeof import('../reset-schedule');
	const next = getNextResetDate(schedule, new Date());
	return next ? next.toISOString() : null;
}