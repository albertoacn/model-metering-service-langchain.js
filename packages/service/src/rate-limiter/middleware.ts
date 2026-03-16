import type { MiddlewareHandler } from 'hono';
import { checkRateLimit, acquireConcurrency, releaseConcurrency } from './index';

/**
 * Hono middleware that enforces per-API-key rate limiting and concurrency
 * controls. Must be placed after the header zValidator so that
 * `c.req.valid('header')` is already populated.
 *
 * - Returns 429 immediately if the sliding-window rate limit is exceeded.
 * - Returns 429 immediately if the concurrency cap is reached.
 * - Releases the concurrency slot in a finally block so it is always freed
 *   regardless of whether the downstream handler succeeds, errors, or streams.
 */
export const rateLimiterMiddleware: MiddlewareHandler = async (c, next) => {
	const apiKey = c.req.header('x-api-key') ?? '';

	const rateResult = checkRateLimit(apiKey);
	if (!rateResult.allowed) {
		return c.json(
			{ error: 'Rate limit exceeded', retry_after_ms: rateResult.retryAfterMs },
			429
		);
	}

	const concResult = acquireConcurrency(apiKey);
	if (!concResult.allowed) {
		return c.json(
			{ error: 'Too many concurrent requests', limit: concResult.limit },
			429
		);
	}

	try {
		await next();
	} finally {
		releaseConcurrency(apiKey);
	}
};