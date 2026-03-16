# Model Metering Service

A proxy service that mimics the Anthropic Messages API with metering and budget controls.

## Changes

### Streaming (`stream: true`)
`POST /v1/messages` now returns a proper SSE stream following the Anthropic streaming protocol (`message_start → content_block_start → ping → content_block_delta × N → content_block_stop → message_delta → message_stop`). Output is emitted in 5-word chunks so the LangChain client exercises its chunk-reassembly path.

### API key validation
Unknown keys → `401`. Empty key → `400` (rejected at the zod layer before the DB lookup).

### Token counting
`input_tokens` and `output_tokens` are computed once per request and persisted to the key's `token_count` via `incrementTokenCount`, for both streaming and non-streaming requests.

### Token limits
Requests are rejected with `429` before generation if `token_count >= token_limit`. The response body includes `token_limit` and `token_count` so callers know where they stand.

### `PATCH /v1/admin/api-keys/:key`
Updates the `token_limit` for an existing key. Returns the updated record or `404`.

## Running tests

```bash
pnpm test
```

Tests use `port: 0` so the OS assigns a free port — no conflicts with other processes. Error-path tests use raw `fetch` rather than the LangChain SDK to assert HTTP status codes directly.

## Potential improvements

- **Cost tracking** — `TOKEN_COSTS` exists in `const.ts` but cost is never stored. Add a `total_cost` column and expose it via a `GET /v1/admin/api-keys/:key` endpoint.
- **Key provisioning endpoint** — `POST /v1/admin/api-keys` so keys can be created over HTTP rather than calling the data layer directly.
- **Atomic budget check** — the current check-then-increment has a race condition under concurrent requests. Fix with `UPDATE ... WHERE token_count + ? <= token_limit` returning affected rows.
- **Real tokeniser** — replace the `length / 4` approximation with `tiktoken` for accurate counts.
- **Persistent storage** — swap `:memory:` for a file or Postgres so usage survives restarts.
- **Auth middleware** — extract key lookup, budget check, and token attribution into a reusable Hono middleware.