/**
 * Test suite for the ChatAnthropic proxy service.
 *
 * Migrated from vitest to Jest.
 * Jest globals (describe, it, expect, beforeAll, afterAll) are injected
 * automatically — no explicit import needed when using @types/jest.
 *
 * The server is started once before all tests on a random OS-assigned port
 * (port: 0) to avoid collisions with other processes, then torn down cleanly
 * in afterAll so the Jest process exits without hanging.
 */

import type { Server } from 'http';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { serve } from '@hono/node-server';

import app from '../src/server';
import { createApiKey, getApiKey } from '../src/data';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server;
let baseURL: string;

const VALID_API_KEY = 'example-api-key';
const UNKNOWN_API_KEY = 'sk-this-key-does-not-exist';
// Isolated key used only by token-counting tests so usage from other tests
// doesn't pollute the count we assert on.
const METERING_API_KEY = 'metering-test-key';

beforeAll(async () => {
	// Register the key that tests use so the server's lookup succeeds.
	createApiKey(VALID_API_KEY, 1_000_000);
	createApiKey(METERING_API_KEY, 1_000_000);

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
// Helper
// ---------------------------------------------------------------------------

function makeClient(apiKey = VALID_API_KEY, model = 'cheap-model') {
	return new ChatAnthropic({
		model,
		apiKey,
		clientOptions: { baseURL },
	} as ConstructorParameters<typeof ChatAnthropic>[0]);
}

// ---------------------------------------------------------------------------
// ChatAnthropic proxy tests
// ---------------------------------------------------------------------------

describe('ChatAnthropic proxy', () => {
	// Existing passing test — unchanged
	it('should return a message', async () => {
		const client = makeClient();
		const result = await client.invoke('hey, how are you?');
		expect(result).toBeDefined();
	});

	/**
	 * Streaming test.
	 *
	 * ChatAnthropic.stream() sets "stream": true in the request body.
	 * The server must respond with an SSE stream that follows the Anthropic
	 * streaming protocol; the LangChain SDK reassembles the events into
	 * AIMessageChunk objects that the caller iterates with `for await`.
	 *
	 * What we assert and why:
	 *
	 *   1. chunks.length > 0
	 *      The stream must emit at least one chunk — a completely empty stream
	 *      would mean the SSE connection opened and closed without any deltas,
	 *      which is broken behaviour.
	 *
	 *   2. Every chunk instanceof AIMessageChunk
	 *      LangChain only emits AIMessageChunk when it has successfully parsed
	 *      an SSE frame. If any of our event names, shape, or required fields
	 *      are wrong, the SDK throws before producing a chunk.
	 *
	 *   3. Concatenated content is non-empty
	 *      Verifies that the text_delta values were actually forwarded — not
	 *      just that the envelope events arrived.
	 */
	it('should stream a message', async () => {
		const client = makeClient();
		const stream = await client.stream('hey, how are you?');

		const chunks: AIMessageChunk[] = [];
		for await (const chunk of stream) {
			expect(chunk).toBeInstanceOf(AIMessageChunk);
			chunks.push(chunk);
		}

		expect(chunks.length).toBeGreaterThan(0);

		const fullText = chunks
			.map((c) => (typeof c.content === 'string' ? c.content : ''))
			.join('');
		expect(fullText.length).toBeGreaterThan(0);
	});

	/**
	 * Unknown key rejection test.
	 *
	 * We use fetch directly rather than ChatAnthropic because the LangChain
	 * client wraps HTTP errors in its own exception hierarchy and the raw
	 * status code is easier to assert on without digging through SDK internals.
	 */
	it('should reject an unrecognized api key', async () => {
		const response = await fetch(`${baseURL}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': UNKNOWN_API_KEY,
			},
			body: JSON.stringify({
				model: 'cheap-model',
				messages: [{ role: 'user', content: 'hello' }],
			}),
		});

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body).toHaveProperty('error');
	});

	/**
	 * Empty key test.
	 *
	 * The zod header validator requires x-api-key to be a non-empty string.
	 * Sending an empty string should be rejected before we even hit the
	 * getApiKey lookup — zod returns a 400 Bad Request in this case.
	 */
	it('should reject an empty api key', async () => {
		const response = await fetch(`${baseURL}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': '',
			},
			body: JSON.stringify({
				model: 'cheap-model',
				messages: [{ role: 'user', content: 'hello' }],
			}),
		});

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body).toHaveProperty('error');
	});

	it.todo('should reject a request that has exceeded the api key token limit');
});

// ---------------------------------------------------------------------------
// Token counting tests
// ---------------------------------------------------------------------------

describe('Token counting', () => {
	/**
	 * Helper — posts a raw request using METERING_API_KEY and returns the
	 * parsed JSON response body. Using fetch instead of ChatAnthropic gives us
	 * direct access to the response shape without the SDK abstracting it away.
	 */
	async function postMessage(content: string) {
		const res = await fetch(`${baseURL}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': METERING_API_KEY,
			},
			body: JSON.stringify({
				model: 'cheap-model',
				messages: [{ role: 'user', content }],
			}),
		});
		return res.json() as Promise<{ usage: { input_tokens: number; output_tokens: number } }>;
	}

	it('response usage object contains positive input_tokens and output_tokens', async () => {
		const body = await postMessage('hello, count my tokens');

		expect(body.usage).toBeDefined();
		expect(body.usage.input_tokens).toBeGreaterThan(0);
		expect(body.usage.output_tokens).toBeGreaterThan(0);
	});

	it('usage values are consistent with the 1-token-per-4-chars approximation', async () => {
		const content = 'a'.repeat(40); // 40 chars → ~10 input tokens
		const body = await postMessage(content);

		// Allow ±1 for rounding at the floor boundary
		expect(body.usage.input_tokens).toBeGreaterThanOrEqual(9);
		expect(body.usage.input_tokens).toBeLessThanOrEqual(11);
	});

	it('token usage is attributed to the api key after a non-streaming request', async () => {
		const before = getApiKey(METERING_API_KEY)!.token_count as number;

		const body = await postMessage('attribute these tokens to my key');

		const after = getApiKey(METERING_API_KEY)!.token_count as number;
		const delta = after - before;

		// The delta must equal exactly what the response reported
		expect(delta).toBe(body.usage.input_tokens + body.usage.output_tokens);
		expect(delta).toBeGreaterThan(0);
	});

	it('token usage is attributed to the api key after a streaming request', async () => {
		const before = getApiKey(METERING_API_KEY)!.token_count as number;

		const res = await fetch(`${baseURL}/v1/messages`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': METERING_API_KEY,
			},
			body: JSON.stringify({
				model: 'cheap-model',
				stream: true,
				messages: [{ role: 'user', content: 'stream and count my tokens' }],
			}),
		});

		// Drain the stream so the server finishes processing
		await res.text();

		const after = getApiKey(METERING_API_KEY)!.token_count as number;
		expect(after).toBeGreaterThan(before);
	});
});

// ---------------------------------------------------------------------------
// Management API stubs (future tasks)
// ---------------------------------------------------------------------------

describe('Management API', () => {
	it.todo('should create new api keys');
	it.todo('should set new token limits for existing api keys');
	it.todo("should derive cost from an api key's usage");
});