/**
 * This is the main entry point for the proxy service.
 * It uses Hono to create a server that mocks the Anthropic API.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { generate } from './messages/generate';

const app = new Hono();

app.use('*', logger());

app.post(
	'/v1/messages',
	zValidator(
		'header',
		z.object({
			'x-api-key': z.string(),
		})
	),
	zValidator(
		'json',
		z.object({
			model: z.enum(['cheap-model', 'expensive-model', 'decent-model']),
			stream: z.boolean().optional(),
			messages: z.array(
				z.object({
					role: z.enum(['user', 'assistant']),
					content: z.string(),
				})
			),
		})
	),
	async (c) => {
		try {
			const { model, messages, stream } = c.req.valid('json');
			const headers = c.req.valid('header');
			if (!headers['x-api-key']) {
				return c.json({ error: 'API key required' }, 401);
			}

			// This is us "calling the model"
			const prompt = messages.map((m) => m.content).join('\n');
			const output = generate(prompt, prompt.length * 32);

			if (stream) {
				/**
				 * Part of your task is to add streaming support for this endpoint.
				 * Just like normal message responses, the `ChatAnthropic` client
				 * can accept a response so long as it complies with the Anthropic API.
				 * @see https://docs.anthropic.com/en/docs/build-with-claude/streaming
				 */
				return c.json({ message: 'Streaming is not currently supported' }, 400);
			} else {
				/**
				 * The `ChatAnthropic` client can accept any endpoint that returns a response
				 * in the same format as the Anthropic API. This is a simple example of how to do that.
				 * @see https://docs.anthropic.com/en/api/messages
				 */
				return c.json({
					id: nanoid(),
					type: 'message',
					role: 'assistant',
					content: [{ type: 'text', text: output }],
					model: model,
					stop_reason: 'end_turn',
					stop_sequence: null,
					usage: {
						cache_creation: null,
						cache_creation_input_tokens: null,
						cache_read_input_tokens: null,
						server_tool_use: null,
						service_tier: 'standard',
						/**
						 * A rule of thumb is that 1 token is roughly 4 characters.
						 * This isn't always true, so we're using a simple approximation.
						 */
						input_tokens: Math.floor(prompt.length / 4),
						output_tokens: Math.floor(output.length / 4),
					},
					container: null,
				});
			}
		} catch (err) {
			console.error(err);
			if (err instanceof Error) {
				return c.json({ error: err.message }, 500);
			}
			return c.json({ error: 'Internal server error' }, 500);
		}
	}
);

app.onError((err, c) => {
	console.error('Error:', err);
	return c.json(
		{
			error: err.message || 'Internal server error',
		},
		500
	);
});

if (require.main === module) {
	serve({
		fetch: app.fetch,
		port: parseInt(process.env.PORT || '4780'),
	});
	console.log(`Proxy service running on http://localhost:${process.env.PORT}`);
}

export default app;
