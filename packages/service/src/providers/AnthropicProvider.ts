import { nanoid } from 'nanoid';

import { BaseProvider, type ProviderRequest } from './BaseProvider';
import type { MeterResult } from '../messages/meter';

export class AnthropicProvider extends BaseProvider {
	readonly name = 'anthropic';

	handleRequest(req: ProviderRequest, result: MeterResult): Response {
		const { model, stream } = req;
		const { output, inputTokens, outputTokens } = result;

		if (stream) return this.streamingResponse(model, output, inputTokens, outputTokens);

		return Response.json({
			id: nanoid(),
			type: 'message',
			role: 'assistant',
			content: [{ type: 'text', text: output }],
			model,
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

	/**
	 * Anthropic SSE streaming response.
	 * @see https://docs.anthropic.com/en/docs/build-with-claude/streaming
	 */
	private streamingResponse(model: string, output: string, inputTokens: number, outputTokens: number): Response {
		const messageId = `msg_${nanoid()}`;
		const encoder = new TextEncoder();
		const frame = (event: string, data: unknown): Uint8Array =>
			encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

		const WORDS_PER_CHUNK = 5;
		const words = output.split(' ');
		const textChunks: string[] = [];
		for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
			const slice = words.slice(i, i + WORDS_PER_CHUNK).join(' ');
			textChunks.push(i + WORDS_PER_CHUNK < words.length ? slice + ' ' : slice);
		}

		return sseResponse([
			frame('message_start', {
				type: 'message_start',
				message: {
					id: messageId, type: 'message', role: 'assistant', content: [], model,
					stop_reason: null, stop_sequence: null,
					usage: { input_tokens: inputTokens, output_tokens: 0 },
				},
			}),
			frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
			frame('ping', { type: 'ping' }),
			...textChunks.map((chunk) =>
				frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })
			),
			frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
			frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens } }),
			frame('message_stop', { type: 'message_stop' }),
		]);
	}
}

/** Wraps pre-built encoded frames into a text/event-stream Response. */
export function sseResponse(frames: Uint8Array[]): Response {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const f of frames) controller.enqueue(f);
			controller.close();
		},
	});
	return new Response(body, {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
	});
}