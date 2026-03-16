/**
 * This file contains constants for the proxy service.
 */

export type Provider = 'anthropic' | 'openai' | 'gemini';

export interface ModelConfig {
	cost: number;
	provider: Provider;
}

/**
 * Central model registry.
 */
export const MODELS: Record<string, ModelConfig> = {
	// Anthropic
	'cheap-model':             { cost: 0.20, provider: 'anthropic' },
	'decent-model':            { cost: 0.40, provider: 'anthropic' },
	'expensive-model':         { cost: 0.60, provider: 'anthropic' },
	// OpenAI
	'gpt-cheap':               { cost: 0.20, provider: 'openai' },
	'gpt-decent':              { cost: 0.40, provider: 'openai' },
	'gpt-expensive':           { cost: 0.60, provider: 'openai' },
	// Gemini
	'gemini-cheap':            { cost: 0.20, provider: 'gemini' },
	'gemini-decent':           { cost: 0.40, provider: 'gemini' },
	'gemini-expensive':        { cost: 0.60, provider: 'gemini' },
} as const;

/** Back-compat alias so existing references to TOKEN_COSTS still work. */
export const TOKEN_COSTS = Object.fromEntries(
	Object.entries(MODELS).map(([model, { cost }]) => [model, cost])
) as Record<string, number>;