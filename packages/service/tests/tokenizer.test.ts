/**
 * Tests for the pluggable tokenization strategy.
 *
 * Covers:
 *   - Unit tests for CharApproxTokenizer
 *   - Conformance test: any object satisfying Tokenizer is accepted by meter()
 *   - Integration test: meter() uses the supplied tokenizer
 */

import { CharApproxTokenizer, type Tokenizer } from '../src/messages/tokenizer';
import { meter, isMeterError } from '../src/messages/meter';
import { createApiKey } from '../src/db';

// ---------------------------------------------------------------------------
// CharApproxTokenizer
// ---------------------------------------------------------------------------

describe('CharApproxTokenizer', () => {
	const tokenizer = new CharApproxTokenizer();

	it('counts tokens as floor(chars / 4)', () => {
		expect(tokenizer.count('abcd')).toBe(1);     // 4 chars → 1 token
		expect(tokenizer.count('abcdefgh')).toBe(2); // 8 chars → 2 tokens
		expect(tokenizer.count('abc')).toBe(0);      // 3 chars → 0 (floor)
	});

	it('returns 0 for an empty string', () => {
		expect(tokenizer.count('')).toBe(0);
	});

	it('accepts a custom charsPerToken ratio', () => {
		const t = new CharApproxTokenizer(2);
		expect(t.count('abcd')).toBe(2); // 4 chars / 2 = 2 tokens
	});
});

// ---------------------------------------------------------------------------
// Tokenizer interface conformance
// ---------------------------------------------------------------------------

describe('Tokenizer interface', () => {
	it('a custom implementation is accepted by meter()', () => {
		const fixedTokenizer: Tokenizer = { count: () => 10 };

		const apiKey = 'tokenizer-conformance-key';
		createApiKey(apiKey, 1_000_000);

		const result = meter(apiKey, 'any prompt', fixedTokenizer);
		if (isMeterError(result)) throw new Error('Expected MeterResult');

		expect(result.inputTokens).toBe(10);
		expect(result.outputTokens).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// meter() integration
// ---------------------------------------------------------------------------

describe('meter() tokenizer integration', () => {
	it('uses the supplied tokenizer for input and output counts', () => {
		const counted: string[] = [];
		const spyTokenizer: Tokenizer = {
			count(text) {
				counted.push(text);
				return text.length; // 1 token per char, easy to assert
			},
		};

		const apiKey = 'tokenizer-spy-key';
		createApiKey(apiKey, 1_000_000);

		const result = meter(apiKey, 'hello', spyTokenizer);
		if (isMeterError(result)) throw new Error('Expected MeterResult');

		// count() must have been called for both input and output
		expect(counted.length).toBe(2);
		expect(result.inputTokens).toBe('hello'.length);
	});

	it('default tokenizer behaves like CharApproxTokenizer', () => {
		const prompt = 'the quick brown fox'; // 19 chars → floor(19/4) = 4

		const defaultKey = 'tokenizer-default-key';
		const charKey = 'tokenizer-char-key';
		createApiKey(defaultKey, 1_000_000);
		createApiKey(charKey, 1_000_000);

		const defaultResult = meter(defaultKey, prompt);
		const charResult = meter(charKey, prompt, new CharApproxTokenizer());

		if (isMeterError(defaultResult) || isMeterError(charResult)) {
			throw new Error('Expected MeterResult');
		}

		expect(defaultResult.inputTokens).toBe(charResult.inputTokens);
		expect(defaultResult.outputTokens).toBe(charResult.outputTokens);
	});
});