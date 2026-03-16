/**
 * This file exports a utility function for generating mock model responses.
 * The function is deterministic, meaning that the same input will always produce the same output.
 * We use this to generate mock responses instead of using a real model to avoid paying $$$.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const fixturesDir = join(__dirname, 'fixtures');
const fixtures = readdirSync(fixturesDir).map((file) => {
	const filePath = join(fixturesDir, file);
	return readFileSync(filePath, 'utf-8');
});

/**
 * Generates a simple hash value for a given string using a basic hash algorithm.
 * This implementation uses a variant of the djb2 hash function.
 *
 * @param str - The input string to hash
 * @returns A 32-bit integer hash value
 */
function hash(str: string) {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return hash;
}

/**
 * Selects a subset of fixtures based on a hash value.
 * The number of fixtures selected is determined by the hash value modulo the total number of fixtures.
 * Uses a deterministic approach to select fixtures while attempting to avoid duplicates.
 *
 * @param hash - The hash value used to determine which fixtures to select
 * @returns An array of selected fixture strings
 */
function pickFixtures(hash: number) {
	const numToSelect = Math.max(1, (Math.abs(hash) % fixtures.length) + 1);
	const selectedFixtures: string[] = [];
	let currentHash = Math.abs(hash);

	for (let i = 0; i < numToSelect; i++) {
		const fixtureIndex = currentHash % fixtures.length;
		selectedFixtures.push(fixtures[fixtureIndex]);
		// Modify hash for next selection to avoid duplicates
		currentHash = Math.floor(currentHash / fixtures.length) + i;
	}

	return selectedFixtures;
}

/**
 * Generates a set of normalized weights that sum to 1.0 using a deterministic pseudo-random approach.
 *
 * @param hash - The hash value used as a seed for weight generation
 * @param length - The number of weights to generate (must be >= 1)
 * @returns An array of normalized weights that sum to 1.0
 *
 * @example
 * ```typescript
 * const weights = pickWeights(12345, 3);
 * // Returns something like [0.3, 0.5, 0.2] (exact values depend on hash)
 * console.log(weights.reduce((sum, w) => sum + w, 0)); // Always equals 1.0
 * ```
 */
function pickWeights(hash: number, length: number) {
	const weights: number[] = [];
	let currentHash = Math.abs(hash * length);
	let sum = 0;

	// Generate length-1 random weights
	for (let i = 0; i < length - 1; i++) {
		// Linear congruential generator
		currentHash = (currentHash * 1103515245 + 12345) & 0x7fffffff;
		const value = (currentHash / 0x7fffffff) * (1 - sum);
		weights.push(value);
		sum += value;
	}

	// Last number ensures sum equals 1
	weights.push(1 - sum);

	return weights;
}

/**
 * Generates mock AI response content based on a given prompt and desired token count.
 *
 * This function creates deterministic, pseudo-random content by:
 * 1. Selecting fixtures based on the prompt hash
 * 2. Calculating weighted token distribution across selected fixtures
 * 3. Extracting content segments from fixtures to meet the target token count
 *
 * The output is deterministic - the same prompt and token count will always
 * produce the same result, making it suitable for testing and development.
 *
 * @param prompt - The input prompt used to seed content generation
 * @param numTokens - The target number of tokens for the generated content
 * @returns A string containing the generated mock response content
 *
 * @example
 * ```typescript
 * const response = generate("Hello, how are you?", 100);
 * console.log(response); // Returns ~100 tokens worth of content
 *
 * // Same inputs always produce same output
 * const response2 = generate("Hello, how are you?", 100);
 * console.log(response === response2); // true
 * ```
 */
export function generate(prompt: string, numTokens: number) {
	const promptHash = hash(prompt);
	const selectedFixtures = pickFixtures(promptHash);
	const weights = pickWeights(promptHash, selectedFixtures.length);

	// Calculate how many tokens to take from each fixture based on weights
	const tokensPerFixture = weights.map((weight) => Math.floor(weight * numTokens));

	// Adjust for rounding errors - distribute remaining tokens
	const totalAllocated = tokensPerFixture.reduce((sum, tokens) => sum + tokens, 0);
	const remaining = numTokens - totalAllocated;

	// Distribute remaining tokens to fixtures with highest weights first
	const weightedIndices = weights.map((weight, index) => ({ weight, index })).sort((a, b) => b.weight - a.weight);

	for (let i = 0; i < remaining; i++) {
		tokensPerFixture[weightedIndices[i % weightedIndices.length].index]++;
	}

	// Generate content from each fixture
	let result = '';
	for (let i = 0; i < selectedFixtures.length; i++) {
		const fixtureContent = selectedFixtures[i];
		const tokensNeeded = tokensPerFixture[i];

		if (tokensNeeded > 0) {
			// Estimate characters per token (rough approximation: ~4 chars per token)
			const charsNeeded = tokensNeeded * 4;

			// Use hash to determine starting position in fixture
			const startHash = (promptHash + i) & 0x7fffffff;
			const maxStart = Math.max(0, fixtureContent.length - charsNeeded);
			const startPos = maxStart > 0 ? startHash % maxStart : 0;

			// Extract content from fixture
			const excerpt = fixtureContent.slice(startPos, startPos + charsNeeded);

			// Clean up excerpt to end at word boundary if possible
			const lastSpaceIndex = excerpt.lastIndexOf(' ');
			const cleanExcerpt = lastSpaceIndex > excerpt.length * 0.8 ? excerpt.slice(0, lastSpaceIndex) : excerpt;

			result += cleanExcerpt;
			if (i < selectedFixtures.length - 1) {
				result += ' ';
			}
		}
	}

	return result.trim();
}
