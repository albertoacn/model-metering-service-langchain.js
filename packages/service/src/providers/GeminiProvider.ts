import { BaseProvider, type ProviderRequest } from './BaseProvider';
import type { MeterResult } from '../messages/meter';

export class GeminiProvider extends BaseProvider {
	readonly name = 'gemini';

	handleRequest(_req: ProviderRequest, result: MeterResult): Response {
		const { output, inputTokens, outputTokens } = result;

		return Response.json({
			candidates: [
				{
					content: { role: 'model', parts: [{ text: output }] },
					finishReason: 'STOP',
					index: 0,
				},
			],
			usageMetadata: {
				promptTokenCount: inputTokens,
				candidatesTokenCount: outputTokens,
				totalTokenCount: inputTokens + outputTokens,
			},
		});
	}
}