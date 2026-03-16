/**
 * In-memory SQLite storage for API key metering data.
 */

import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    api_key     TEXT    PRIMARY KEY,
    token_limit INTEGER NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    total_cost  REAL    NOT NULL DEFAULT 0
  );
`);

export interface ApiKeyRecord {
	api_key: string;
	token_limit: number;
	token_count: number;
	total_cost: number;
}

export function createApiKey(apiKey: string, tokenLimit: number) {
	const stmt = db.prepare('INSERT INTO api_keys (api_key, token_limit, token_count, total_cost) VALUES (?, ?, 0, 0)');
	stmt.run(apiKey, tokenLimit);
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