import { nanoid } from 'nanoid';

import { BaseProvider, type ProviderRequest } from './BaseProvider';
import { sseResponse } from './AnthropicProvider';
import type { MeterResult } from '../messages/meter';

export class OpenAIProvider extends BaseProvider {
	readonly name = 'openai';

	handleRequest(req: ProviderRequest, result: MeterResult): Response {
		const { model, stream } = req;
		const { output, inputTokens, outputTokens } = result;
		const id = `chatcmpl-${nanoid()}`;
		const created = Math.floor(Date.now() / 1000);

		if (stream) return this.streamingResponse(id, model, output, created, inputTokens, outputTokens);

		return Response.json({
			id,
			object: 'chat.completion',
			created,
			model,
			choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
			usage: {
				prompt_tokens: inputTokens,
				completion_tokens: outputTokens,
				total_tokens: inputTokens + outputTokens,
			},
		});
	}

	/**
	 * OpenAI SSE streaming response.
	 * @see https://platform.openai.com/docs/api-reference/chat/create
	 */
	private streamingResponse(
		id: string, model: string, output: string, created: number,
		inputTokens: number, outputTokens: number
	): Response {
		const encoder = new TextEncoder();
		const frame = (data: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

		const WORDS_PER_CHUNK = 5;
		const words = output.split(' ');
		const textChunks: string[] = [];
		for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
			const slice = words.slice(i, i + WORDS_PER_CHUNK).join(' ');
			textChunks.push(i + WORDS_PER_CHUNK < words.length ? slice + ' ' : slice);
		}

		return sseResponse([
			frame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }),
			...textChunks.map((chunk) =>
				frame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })
			),
			frame({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } }),
			encoder.encode('data: [DONE]\n\n'),
		]);
	}
}