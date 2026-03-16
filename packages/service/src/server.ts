/**
 * Server entry point.
 *
 * Routes:
 *   POST /v1/messages          	— unified route, provider chosen via body.provider
 *   PATCH /v1/admin/api-keys/:key 	— update token limit
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { AnthropicProvider, OpenAIProvider, GeminiProvider } from './providers';
import type { BaseProvider } from './providers';
import { getApiKey, getAllApiKeys, setTokenLimit, setResetSchedule, getUsageHistory, getUsageSummary, createApiKey } from './db';
import { MODELS } from './config/models';
import { meter, isMeterError } from './messages/meter';
import { rateLimiterMiddleware } from './rate-limiter/middleware';
import { adminUI } from './admin/ui';

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
	rateLimiterMiddleware,
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
			const result = meter(apiKey, prompt, model);
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

/** GET /admin — web interface */
app.get('/admin', (c) => {
	return c.html(adminUI());
});

/** GET /v1/admin/api-keys — list all keys */
app.get('/v1/admin/api-keys', (c) => {
	return c.json(getAllApiKeys());
});

/** POST /v1/admin/api-keys — create a new key */
app.post(
	'/v1/admin/api-keys',
	zValidator('json', z.object({
		api_key: z.string().min(1),
		token_limit: z.number().int().positive(),
		reset_schedule: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
	})),
	(c) => {
		const { api_key, token_limit, reset_schedule = 'none' } = c.req.valid('json');
		if (getApiKey(api_key)) return c.json({ error: 'API key already exists' }, 409);
		createApiKey(api_key, token_limit, reset_schedule);
		return c.json(getApiKey(api_key), 201);
	}
);

/**
 * GET /v1/admin/api-keys/:key
 *
 * Reports current usage and accumulated cost for an API key.
 */
app.get('/v1/admin/api-keys/:key', (c) => {
	const record = getApiKey(c.req.param('key'));
	if (!record) return c.json({ error: 'API key not found' }, 404);
	return c.json(record);
});

/**
 * GET /v1/admin/api-keys/:key/usage
 *
 * Returns individual usage events for a key, newest first.
 * Optional query params: from, to
 */
app.get('/v1/admin/api-keys/:key/usage', (c) => {
	const key = c.req.param('key');
	if (!getApiKey(key)) return c.json({ error: 'API key not found' }, 404);

	const { from, to } = c.req.query();
	return c.json(getUsageHistory(key, from, to));
});

/**
 * GET /v1/admin/api-keys/:key/usage/summary
 *
 * Returns usage aggregated by date and model, newest first.
 * Optional query params: from, to
 */
app.get('/v1/admin/api-keys/:key/usage/summary', (c) => {
	const key = c.req.param('key');
	if (!getApiKey(key)) return c.json({ error: 'API key not found' }, 404);

	const { from, to } = c.req.query();
	return c.json(getUsageSummary(key, from, to));
});

app.patch(
	'/v1/admin/api-keys/:key',
	zValidator('json', z.object({
		token_limit: z.number().int().positive(),
		reset_schedule: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
	})),
	(c) => {
		const key = c.req.param('key');
		const { token_limit, reset_schedule } = c.req.valid('json');

		if (!getApiKey(key)) return c.json({ error: 'API key not found' }, 404);

		setTokenLimit(key, token_limit);
		if (reset_schedule !== undefined) setResetSchedule(key, reset_schedule);

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