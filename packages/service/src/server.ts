/**
 * Server entry point.
 *
 * Routes:
 *   POST /v1/messages          	— unified route, provider chosen via body.provider
 *   PATCH /v1/admin/api-keys/:key  — update token limit
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { AnthropicProvider, OpenAIProvider, GeminiProvider } from './providers';
import type { BaseProvider } from './providers';
import { getApiKey, setTokenLimit } from './data';
import { MODELS } from './const';
import { meter, isMeterError } from './messages/meter';

const app = new Hono();

app.use('*', logger());

// ---------------------------------------------------------------------------
// Build provider registry — keyed by name for O(1) lookup
// ---------------------------------------------------------------------------

const ALL_PROVIDERS: BaseProvider[] = [
	new AnthropicProvider(),
	new OpenAIProvider(),
	new GeminiProvider(),
];

const providerMap = new Map(ALL_PROVIDERS.map((p) => [p.name, p]));

// ---------------------------------------------------------------------------
// Unified POST /v1/messages
//
// Accepts a `provider` field in the request body to explicitly choose which
// provider handles the request. If omitted, the provider is inferred from the
// model name via the MODELS registry.
//
// Example — explicit provider:
//   { "provider": "openai", "model": "gpt-decent", "messages": [...] }
//
// Example — inferred from model:
//   { "model": "gpt-decent", "messages": [...] }   → openai
//   { "model": "cheap-model", "messages": [...] }  → anthropic
// ---------------------------------------------------------------------------

app.post(
	'/v1/messages',
	zValidator('header', z.object({ 'x-api-key': z.string().min(1) })),
	zValidator(
		'json',
		z.object({
			provider: z.enum(['anthropic', 'openai', 'gemini']).optional(),
			model: z.string().min(1),
			stream: z.boolean().optional(),
			messages: z.array(z.object({ role: z.string(), content: z.string() })),
		})
	),
	async (c) => {
		try {
			const { provider: explicitProvider, model, messages, stream } = c.req.valid('json');
			const { 'x-api-key': apiKey } = c.req.valid('header');

			// Resolve provider — explicit field takes precedence over model inference
			const modelConfig = MODELS[model];
			const providerName = explicitProvider ?? modelConfig?.provider;

			if (!providerName) {
				return c.json({ error: `Unknown model "${model}". Specify a "provider" field or use a model in the registry.` }, 400);
			}

			// Validate that the model belongs to the resolved provider (only when model is in the registry)
			if (modelConfig && modelConfig.provider !== providerName) {
				return c.json(
					{ error: `Model "${model}" belongs to provider "${modelConfig.provider}", not "${providerName}".` },
					400
				);
			}

			const provider = providerMap.get(providerName);
			if (!provider) {
				return c.json({ error: `Provider "${providerName}" is not registered.` }, 400);
			}

			const prompt = messages.map((m) => m.content).join('\n');
			const result = meter(apiKey, prompt);
			if (isMeterError(result)) return c.json(result.body, result.status);

			return provider.handleRequest({ model, messages, stream }, result);
		} catch (err) {
			console.error(err);
			return c.json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
		}
	}
);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

app.patch(
	'/v1/admin/api-keys/:key',
	zValidator('json', z.object({ token_limit: z.number().int().positive() })),
	(c) => {
		const key = c.req.param('key');
		const { token_limit } = c.req.valid('json');

		if (!getApiKey(key)) return c.json({ error: 'API key not found' }, 404);

		setTokenLimit(key, token_limit);
		return c.json(getApiKey(key));
	}
);

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.onError((err, c) => {
	console.error('Error:', err);
	return c.json({ error: err.message || 'Internal server error' }, 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (require.main === module) {
	serve({ fetch: app.fetch, port: parseInt(process.env.PORT || '4780') });
	console.log(`Proxy service running on http://localhost:${process.env.PORT}`);
}

export default app;