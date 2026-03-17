# Model Metering Service — Changes (v2)

## Project structure

```
src/
  admin/
    ui.ts                   — HTML for the admin web interface
  config/
    models.ts               — model registry with provider + cost per token
  db/
    index.ts                — shared SQLite instance, all schema and query functions
  messages/
    generate.ts             — deterministic mock text generation
    meter.ts                — key validation, budget, tokens, cost, usage recording
    tokenizer.ts            — Tokenizer interface + CharApproxTokenizer
  providers/
    BaseProvider.ts         — abstract base with handleRequest() contract
    AnthropicProvider.ts
    OpenAIProvider.ts
    GeminiProvider.ts
    index.ts
  rate-limiter/
    index.ts                — sliding-window rate limit + concurrency (SQLite-backed)
    middleware.ts           — Hono middleware adapter
  reset-schedule/
    index.ts                — pure helpers: getNextResetDate(), shouldReset()
  server.ts
```

---

## What changed

### Multi-provider support
Single `POST /v1/messages` endpoint handles Anthropic, OpenAI, and Gemini. Provider is inferred from the model name or set explicitly via `"provider"` in the request body. Each provider implements `handleRequest()` — a stateless method that formats an already-metered result into its own response shape. All cross-cutting concerns (auth, metering, rate limiting) happen before dispatch.

### Pluggable tokenization
`meter()` accepts an optional `Tokenizer` interface (`count(text): number`). Default is `CharApproxTokenizer` (`floor(chars / 4)`) to preserve existing behaviour. Swap in any implementation — e.g. tiktoken — without changing call sites.

### Cost tracking
`cost = (input_tokens + output_tokens) × TOKEN_COSTS[model]` is computed per request and accumulated on `api_keys.total_cost`. The model registry in `config/models.ts` holds per-token USD rates. Both the rolling total and per-event cost are available via the admin API.

### Reset schedule
Keys have a `reset_schedule` (`none | daily | weekly | monthly`) and a `reset_at` timestamp. `meter()` resets `token_count` and `total_cost` lazily on the next inbound request when the window has elapsed, then advances `reset_at` by one interval from the *previous* `reset_at` (not from now) to preserve schedule cadence regardless of when traffic arrives.

### Rate limiting and concurrency
Two per-key controls, both SQLite-backed (no in-memory Maps):
- **Sliding window** — `request_log` table, pruned on each check
- **Concurrency cap** — `concurrent_requests` table, upserted on acquire and decremented in a `try/finally`

Both are wired via a Hono middleware (`rate-limiter/middleware.ts`) that runs after header validation but before JSON parsing, so rejected requests never pay the deserialization cost.

### Usage tracking
Every successful request writes a row to `usage_events`. Two endpoints expose it: raw events (`GET /usage`) and daily aggregates by model (`GET /usage/summary`), both supporting `?from=` / `?to=` date filters.

### Admin web interface
`GET /admin` serves a self-contained HTML page (no build step, no external deps) for creating keys, editing limits and schedules, and browsing usage history. The UI lives in `src/admin/ui.ts` to keep it out of `server.ts`.

### Persistent storage
`DB_PATH` environment variable sets the SQLite file path. Unset defaults to `:memory:`, preserving existing behaviour.

---

## Trade-offs

| Decision | Trade-off |
|---|---|
| Lazy resets in `meter()` | No cron infrastructure needed, but a key with zero traffic isn't reset until its next request |
| `request_log` rows pruned per-key on read | Simple, but rows for inactive keys accumulate until that key makes another request |
| `total_cost` column + `usage_events` table | O(1) totals, but the column can drift from the event sum if rows are manually modified |
| Single unified `/v1/messages` | Less duplication, but response shape varies by provider — callers must be aware |
| No auth on `/admin` | Simpler to develop, but requires network-level access control before production use |

---

## Potential future changes

- **Atomic budget check** — replace check-then-increment with `UPDATE ... WHERE token_count + ? <= token_limit` to close the concurrency race condition
- **Real tokenizer** — drop-in `TiktokenTokenizer` behind the existing `Tokenizer` interface
- **Usage retention policy** — delete `usage_events` and `request_log` rows older than a configurable window
- **PostgreSQL backend** — reimplement `db/index.ts` against a Postgres client for horizontal scaling; nothing else changes
- **Key deletion** — `DELETE /v1/admin/api-keys/:key`
- **Admin authentication** — middleware guard on `/admin` and `/v1/admin/` routes