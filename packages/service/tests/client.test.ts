/**
 * Test suite for the ChatAnthropic proxy service.
 *
 * Migrated from vitest to Jest.
 * Jest globals are injected automatically — no explicit import needed.
 */

import type { Server } from 'http';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { serve } from '@hono/node-server';

import app from '../src/server';
import { createApiKey, getApiKey, setTokenLimit } from '../src/data';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseURL: string;

const VALID_API_KEY = 'example-api-key';
const UNKNOWN_API_KEY = 'this-key-does-not-exist';
const METERING_API_KEY = 'metering-test-key';
const LIMIT_API_KEY = 'limit-test-key';

beforeAll(async () => {
	// Register the key that tests use so the server's lookup succeeds.
	createApiKey(VALID_API_KEY, 1_000_000);
	createApiKey(METERING_API_KEY, 1_000_000);
	createApiKey(LIMIT_API_KEY, 1_000_000);

	await new Promise<void>((resolve) => {
		// port: 0 lets the OS pick a free port, avoiding hardcoded-port collisions
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
// Helpers
// ---------------------------------------------------------------------------

function makeClient(apiKey = VALID_API_KEY, model = 'cheap-model') {
	return new ChatAnthropic({
		model,
		apiKey,
		clientOptions: { baseURL },
	} as ConstructorParameters<typeof ChatAnthropic>[0]);
}

async function postJSON(path: string, body: unknown, headers: Record<string, string> = {}) {
	return fetch(`${baseURL}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

// ---------------------------------------------------------------------------
// ChatAnthropic proxy
// ---------------------------------------------------------------------------

describe('ChatAnthropic proxy', () => {
	it('should return a message', async () => {
		const result = await makeClient().invoke('hey, how are you?');
		expect(result).toBeDefined();
	});

	it('should stream a message', async () => {
		const stream = await makeClient().stream('hey, how are you?');

		const chunks: AIMessageChunk[] = [];
		for await (const chunk of stream) {
			expect(chunk).toBeInstanceOf(AIMessageChunk);
			chunks.push(chunk);
		}

		expect(chunks.length).toBeGreaterThan(0);
		const fullText = chunks.map((c) => (typeof c.content === 'string' ? c.content : '')).join('');
		expect(fullText.length).toBeGreaterThan(0);
	});

	it('should reject an unrecognized api key', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ model: 'cheap-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': UNKNOWN_API_KEY }
		);
		expect(res.status).toBe(401);
		expect(await res.json()).toHaveProperty('error');
	});

	it('should reject an empty api key', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ model: 'cheap-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': '' }
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toHaveProperty('error');
	});

	it('should reject a request that has exceeded the api key token limit', async () => {
		const exhaustedKey = 'exhausted-key';
		createApiKey(exhaustedKey, 0);

		const res = await postJSON(
			'/v1/messages',
			{ model: 'cheap-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': exhaustedKey }
		);

		expect(res.status).toBe(429);
		const body = await res.json() as { error: string; token_limit: number; token_count: number };
		expect(body).toHaveProperty('error');
		expect(body).toHaveProperty('token_limit');
		expect(body).toHaveProperty('token_count');
	});
});

// ---------------------------------------------------------------------------
// Token counting
// ---------------------------------------------------------------------------

describe('Token counting', () => {
	async function postMessage(content: string) {
		const res = await postJSON(
			'/v1/messages',
			{ model: 'cheap-model', messages: [{ role: 'user', content }] },
			{ 'x-api-key': METERING_API_KEY }
		);
		return res.json() as Promise<{ usage: { input_tokens: number; output_tokens: number } }>;
	}

	it('response usage object contains positive input_tokens and output_tokens', async () => {
		const body = await postMessage('hello, count my tokens');
		expect(body.usage.input_tokens).toBeGreaterThan(0);
		expect(body.usage.output_tokens).toBeGreaterThan(0);
	});

	it('usage values are consistent with the 1-token-per-4-chars approximation', async () => {
		const body = await postMessage('a'.repeat(40));
		expect(body.usage.input_tokens).toBeGreaterThanOrEqual(9);
		expect(body.usage.input_tokens).toBeLessThanOrEqual(11);
	});

	it('token usage is attributed to the api key after a non-streaming request', async () => {
		const before = getApiKey(METERING_API_KEY)!.token_count as number;
		const body = await postMessage('attribute these tokens to my key');
		const after = getApiKey(METERING_API_KEY)!.token_count as number;
		const delta = after - before;

		expect(delta).toBe(body.usage.input_tokens + body.usage.output_tokens);
		expect(delta).toBeGreaterThan(0);
	});

	it('token usage is attributed to the api key after a streaming request', async () => {
		const before = getApiKey(METERING_API_KEY)!.token_count as number;

		const res = await postJSON(
			'/v1/messages',
			{ model: 'cheap-model', stream: true, messages: [{ role: 'user', content: 'stream and count my tokens' }] },
			{ 'x-api-key': METERING_API_KEY }
		);
		await res.text();

		const after = getApiKey(METERING_API_KEY)!.token_count as number;
		expect(after).toBeGreaterThan(before);
	});
});

// ---------------------------------------------------------------------------
// Token limits
// ---------------------------------------------------------------------------

describe('Token limits', () => {
	async function postMessage(content: string) {
		return postJSON(
			'/v1/messages',
			{ model: 'cheap-model', messages: [{ role: 'user', content }] },
			{ 'x-api-key': LIMIT_API_KEY }
		);
	}

	it('should accept requests while under the token limit', async () => {
		setTokenLimit(LIMIT_API_KEY, 1_000_000);
		expect((await postMessage('hello within limit')).status).toBe(200);
	});

	it('should reject requests after the token limit is lowered below current usage', async () => {
		setTokenLimit(LIMIT_API_KEY, 0);
		const res = await postMessage('this should be rejected');
		expect(res.status).toBe(429);
		const body = await res.json() as { error: string; token_limit: number };
		expect(body).toHaveProperty('error');
		expect(body.token_limit).toBe(0);
	});

	it('should accept requests again after the token limit is raised', async () => {
		setTokenLimit(LIMIT_API_KEY, 1_000_000);
		expect((await postMessage('back under the limit')).status).toBe(200);
	});

	it('PATCH /v1/admin/api-keys/:key updates the token limit', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/${LIMIT_API_KEY}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token_limit: 999 }),
		});
		expect(res.status).toBe(200);
		const body = await res.json() as { token_limit: number };
		expect(body.token_limit).toBe(999);
	});

	it('PATCH /v1/admin/api-keys/:key returns 404 for unknown key', async () => {
		const res = await fetch(`${baseURL}/v1/admin/api-keys/nonexistent-key`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token_limit: 100 }),
		});
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Unified /v1/messages with explicit provider field
// ---------------------------------------------------------------------------

describe('Unified /v1/messages with provider field', () => {
	it('routes to anthropic when provider is explicit', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ provider: 'anthropic', model: 'cheap-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(200);
		const body = await res.json() as { type: string };
		expect(body.type).toBe('message');
	});

	it('routes to openai when provider is explicit', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ provider: 'openai', model: 'gpt-decent', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(200);
		const body = await res.json() as { object: string };
		expect(body.object).toBe('chat.completion');
	});

	it('routes to gemini when provider is explicit', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ provider: 'gemini', model: 'gemini-decent', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(200);
		const body = await res.json() as { candidates: unknown[] };
		expect(body.candidates).toBeDefined();
	});

	it('infers provider from model when provider field is omitted', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ model: 'gpt-decent', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(200);
		const body = await res.json() as { object: string };
		expect(body.object).toBe('chat.completion');
	});

	it('returns 400 when provider and model are mismatched', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ provider: 'openai', model: 'cheap-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toHaveProperty('error');
	});

	it('returns 400 when model is unknown and no provider is given', async () => {
		const res = await postJSON(
			'/v1/messages',
			{ model: 'no-such-model', messages: [{ role: 'user', content: 'hello' }] },
			{ 'x-api-key': VALID_API_KEY }
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toHaveProperty('error');
	});

});
