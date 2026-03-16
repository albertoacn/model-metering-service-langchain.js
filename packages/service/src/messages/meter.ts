/**
 * Shared metering helpers used by every provider route.
 *
 * Keeping this separate from the routes means the budget-check and
 * attribution logic is tested and changed in exactly one place.
 */

import { generate } from './generate';
import { getApiKey, incrementTokenCount } from '../db';

export interface MeterError {
	status: 401 | 429;
	body: Record<string, unknown>;
}

export interface MeterResult {
	output: string;
	inputTokens: number;
	outputTokens: number;
}

/**
 * Validates the API key, enforces the token budget, generates output,
 * and attributes usage — in that order.
 *
 * Returns either a MeterError (caller should return an error response)
 * or a MeterResult with the generated text and token counts.
 */
export function meter(apiKey: string, prompt: string): MeterError | MeterResult {
	const keyRecord = getApiKey(apiKey);
	if (!keyRecord) {
		return { status: 401, body: { error: 'Invalid API key' } };
	}

	if (keyRecord.token_count >= keyRecord.token_limit) {
		return {
			status: 429,
			body: {
				error: 'Token limit exceeded',
				token_limit: keyRecord.token_limit,
				token_count: keyRecord.token_count,
			},
		};
	}

	const output = generate(prompt, prompt.length * 32);
	const inputTokens = Math.floor(prompt.length / 4);
	const outputTokens = Math.floor(output.length / 4);

	incrementTokenCount(apiKey, inputTokens + outputTokens);

	return { output, inputTokens, outputTokens };
}

export function isMeterError(result: MeterError | MeterResult): result is MeterError {
	return 'status' in result;
}