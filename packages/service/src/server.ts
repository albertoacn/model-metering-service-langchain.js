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
import { getApiKey, incrementTokenCount } from './data';

const app = new Hono();

app.use('*', logger());

app.post(
	'/v1/messages',
	zValidator(
		'header',
		z.object({
			'x-api-key': z.string().min(1),
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
			const { 'x-api-key': apiKey } = c.req.valid('header');

			// Reject unknown keys — zod guarantees apiKey is a non-empty string here,
			// so we only need to check whether it exists in the store.
			if (!getApiKey(apiKey)) {
				return c.json({ error: 'Invalid API key' }, 401);
			}

			// This is us "calling the model"
			const prompt = messages.map((m) => m.content).join('\n');
			const output = generate(prompt, prompt.length * 32);

			/**
 			 * A rule of thumb is that 1 token is roughly 4 characters.
 			 * This isn't always true, so we're using a simple approximation.
 			*/
			const inputTokens = Math.floor(prompt.length / 4);
			const outputTokens = Math.floor(output.length / 4);

			// Attribute usage to the API key regardless of streaming mode.
			incrementTokenCount(apiKey, inputTokens + outputTokens);

			if (stream) {
				return streamingResponse(model, output, inputTokens, outputTokens);
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
						input_tokens: inputTokens,
						output_tokens: outputTokens,
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

/**
 * Builds a streaming Server-Sent Events response compatible with the Anthropic
 * streaming protocol so that `ChatAnthropic.stream()` can consume it.
 *
 * Event sequence (mirrors the real Anthropic API):
 *   message_start       – opens the message envelope with input token count
 *   content_block_start – announces a single text block at index 0
 *   ping                – keepalive (Anthropic sends one early in the stream)
 *   content_block_delta – one event per small chunk of generated text
 *   content_block_stop  – closes the text block
 *   message_delta       – carries stop_reason + final output token count
 *   message_stop        – signals the stream is complete
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/streaming
 *
 * NOTE: `generate()` is synchronous, so the full text is produced upfront and
 * then emitted in chunks. A real implementation would interleave token
 * generation with SSE emission.
 */
function streamingResponse(model: string, output: string, inputTokens: number, outputTokens: number): Response {
	const messageId = `msg_${nanoid()}`;
	const encoder = new TextEncoder();

	/** Encodes a single SSE frame. */
	const frame = (event: string, data: unknown): Uint8Array =>
		encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

	/**
	 * Split output into small word-based chunks so the client receives multiple
	 * delta events, which exercises the LangChain chunk-reassembly path.
	 * 5 words per chunk keeps the event count reasonable without being trivial.
	 */
	const WORDS_PER_CHUNK = 5;
	const words = output.split(' ');
	const textChunks: string[] = [];
	for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
		const slice = words.slice(i, i + WORDS_PER_CHUNK).join(' ');
		// Re-add the inter-chunk space that was removed by split, except at the end
		textChunks.push(i + WORDS_PER_CHUNK < words.length ? slice + ' ' : slice);
	}

	const frames: Uint8Array[] = [
		frame('message_start', {
			type: 'message_start',
			message: {
				id: messageId,
				type: 'message',
				role: 'assistant',
				content: [],
				model,
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: inputTokens, output_tokens: 0 },
			},
		}),
		frame('content_block_start', {
			type: 'content_block_start',
			index: 0,
			content_block: { type: 'text', text: '' },
		}),
		frame('ping', { type: 'ping' }),
		...textChunks.map((chunk) =>
			frame('content_block_delta', {
				type: 'content_block_delta',
				index: 0,
				delta: { type: 'text_delta', text: chunk },
			})
		),
		frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
		frame('message_delta', {
			type: 'message_delta',
			delta: { stop_reason: 'end_turn', stop_sequence: null },
			usage: { output_tokens: outputTokens },
		}),
		frame('message_stop', { type: 'message_stop' }),
	];

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const f of frames) {
				controller.enqueue(f);
			}
			controller.close();
		},
	});

	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
}

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