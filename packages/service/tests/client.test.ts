import { describe, it, expect, beforeAll } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { serve } from '@hono/node-server';

import app from '../src/server';

beforeAll(() => {
	serve({
		fetch: app.fetch,
		port: 4780,
	});
});

describe('ChatAnthropic proxy', () => {
	// This test should work as expected
	it('should return a message', async () => {
		const client = new ChatAnthropic({
			model: 'cheap-model',
			apiKey: 'example-api-key',
			clientOptions: {
				baseURL: 'http://localhost:4780',
			},
		});

		const result = await client.invoke('hey, how are you?');
		return result;
	});

	// This test should fail, but you should fix it
	it('should stream a message', async () => {
		const client = new ChatAnthropic({
			model: 'cheap-model',
			apiKey: 'example-api-key',
			clientOptions: {
				baseURL: 'http://localhost:4780',
			},
		});

		const stream = await client.stream('hey, how are you?');
		const chunks: AIMessageChunk[] = [];
		for await (const chunk of stream) {
			chunks.push(chunk);
			expect(chunk).toBeDefined();
		}

		expect(chunks.length).toBeGreaterThan(0);
	});

	it('should reject an unrecognized api key', async () => {
		/**
		 * You should implement this test that can reliably test
		 * that the server rejects an unrecognized api key.
		 */
		expect.fail('Not implemented');
	});

	it('should reject a request that has exceeded the api key token limit', async () => {
		/**
		 * If a request is made with an api key that has exceeded its token limit,
		 * the server should reject the request.
		 */
		expect.fail('Not implemented');
	});
});

describe('Management API', () => {
	it('should create new api keys', async () => {
		/**
		 * Through the management API, you should be able to create new api keys.
		 */
		expect.fail('Not implemented');
	});

	it('should set new token limits for existing api keys', async () => {
		/**
		 * Through the management API, you should be able to set new token limits for existing api keys.
		 */
		expect.fail('Not implemented');
	});

	it("should derive cost from an api key's usage", async () => {
		/**
		 * Through the management API, you should be able to derive cost from the usage of an api key.
		 */
		expect.fail('Not implemented');
	});
});
