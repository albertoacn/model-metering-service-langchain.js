/**
 * Shared metering helpers used by every provider route.
 *
 * Keeping this separate from the routes means the budget-check and
 * attribution logic is tested and changed in exactly one place.
 */

import { generate } from './generate';
import { getApiKey, incrementTokenCount, incrementCost, resetTokenCount, recordUsage } from '../db';
import { type Tokenizer, CharApproxTokenizer } from './tokenizer';
import { TOKEN_COSTS, MODELS } from '../config/models';
import { shouldReset } from '../reset-schedule';

export interface MeterError {
	status: 401 | 429;
	body: Record<string, unknown>;
}

export interface MeterResult {
	output: string;
	inputTokens: number;
	outputTokens: number;
	cost: number;
}

/**
 * Validates the API key, enforces the token budget, generates output,
 * computes cost from the model's per-token rate, and attributes both
 * token usage and cost to the API key.
 *
 * An optional `tokenizer` can be supplied to override the default
 * character-based approximation with any counting strategy.
 *
 * Returns either a MeterError (caller should return an error response)
 * or a MeterResult with the generated text, token counts, and cost.
 */
export function meter(
	apiKey: string,
	prompt: string,
	model: string,
	tokenizer: Tokenizer = new CharApproxTokenizer(),
	now: Date = new Date()
): MeterError | MeterResult {
	const keyRecord = getApiKey(apiKey);
	if (!keyRecord) {
		return { status: 401, body: { error: 'Invalid API key' } };
	}

	// Reset token_count and total_cost if the schedule has elapsed
	if (shouldReset(keyRecord.reset_at, now)) {
		resetTokenCount(apiKey);
	}

	// Re-fetch after potential reset so the budget check sees the fresh count
	const current = getApiKey(apiKey)!;

	if (current.token_count >= current.token_limit) {
		return {
			status: 429,
			body: {
				error: 'Token limit exceeded',
				token_limit: current.token_limit,
				token_count: current.token_count,
			},
		};
	}

	const output = generate(prompt, prompt.length * 32);
	const inputTokens = tokenizer.count(prompt);
	const outputTokens = tokenizer.count(output);
	const costPerToken = TOKEN_COSTS[model] ?? 0;
	const cost = (inputTokens + outputTokens) * costPerToken;

	incrementTokenCount(apiKey, inputTokens + outputTokens);
	incrementCost(apiKey, cost);
	recordUsage(
		apiKey,
		model,
		MODELS[model]?.provider ?? 'unknown',
		inputTokens,
		outputTokens,
		cost,
		now.toISOString()
	);

	return { output, inputTokens, outputTokens, cost };
}

export function isMeterError(result: MeterError | MeterResult): result is MeterError {
	return 'status' in result;
}