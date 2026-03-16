/**
 * Pluggable tokenization strategy.
 *
 * Implement the Tokenizer interface to swap in any counting logic — a real
 * tiktoken binding, a model-specific heuristic, or one of the built-ins below.
 *
 * Usage:
 *   import { meter } from './meter';
 *   import { WordApproxTokenizer } from './tokenizer';
 *
 *   meter(apiKey, prompt, new WordApproxTokenizer());
 */

export interface Tokenizer {
	/** Returns the number of tokens in the given text. */
	count(text: string): number;
}

/**
 * Default strategy: 1 token ≈ 4 characters.
 *
 * Fast and dependency-free. Matches the approximation already used throughout
 * the codebase. Accurate enough for budget enforcement at scale, but will
 * under-count heavily punctuated or non-ASCII text.
 */
export class CharApproxTokenizer implements Tokenizer {
	private readonly charsPerToken: number;

	constructor(charsPerToken = 4) {
		this.charsPerToken = charsPerToken;
	}

	count(text: string): number {
		return Math.floor(text.length / this.charsPerToken);
	}
}