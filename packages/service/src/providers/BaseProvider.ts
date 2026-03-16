import type { Hono } from 'hono';
import type { MeterResult } from '../messages/meter';

export interface ProviderRequest {
	model: string;
	messages: { role: string; content: string }[];
	stream?: boolean;
}

/**
 * Base class for all providers.
 *
 * Providers implement `handleRequest()` to format a metered result into their
 * own response shape. The unified POST /v1/messages route in server.ts handles
 * authentication, metering, and dispatch — providers stay stateless.
 *
 * `register()` can optionally mount additional provider-native routes.
 * It is a no-op by default; providers only override it if needed.
 */
export abstract class BaseProvider {
	abstract readonly name: string;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	register(_app: Hono): void {}

	abstract handleRequest(req: ProviderRequest, result: MeterResult): Response | Promise<Response>;
}