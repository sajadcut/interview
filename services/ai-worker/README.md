# AI Worker

`services/ai-worker` is the provider-neutral background execution runtime for AI/evaluator workloads.

It is intentionally usable before an LLM is installed. The worker owns durable execution mechanics and a provider-neutral LLM boundary; real provider adapters are registered later.

## Implemented runtime boundary

- PostgreSQL-backed durable queue owned by the API (`ai_jobs` + append-only `ai_job_events`).
- Atomic `FOR UPDATE SKIP LOCKED` claiming for multiple workers.
- Lease token ownership so stale workers cannot complete a re-claimed job.
- Lease heartbeat and expired-lease recovery.
- Configurable job timeout.
- Exponential retry/backoff with a per-job maximum-attempt limit.
- Dead-letter state for permanent failures or exhausted retries.
- Idempotent enqueue keys per organization.
- Worker concurrency lanes and graceful SIGINT/SIGTERM shutdown.
- Shared-secret authenticated internal API; the secret is never carried in job payloads.

## LLM Provider Layer v1

`src/llm-provider.mjs` is the model-independent execution boundary used by future evaluator/brain processors.

It provides:

- explicit immutable prompt IDs and versions;
- exact prompt-variable contracts;
- JSON structured output with fail-closed schema validation;
- bounded per-provider retries;
- per-attempt timeout using `AbortSignal`;
- token and `costMicros` budget enforcement;
- charging of usage reported by failed attempts;
- ordered fallback providers after retry exhaustion;
- bounded attempt metadata and aggregate usage in results;
- no rendered prompt text in returned execution metadata;
- typed/safe provider errors without leaking raw provider diagnostics.

No OpenAI, Anthropic, Gemini, local-model, or other vendor SDK is installed by this layer. Tests use scripted in-memory providers and require no model, API key, network request, or paid inference.

Contract:

```bash
npm run llm-provider:contract:check
```

Worker tests:

```bash
npm run ai-worker:test
```

The LLM contract checker and scripted-provider tests are part of the root `npm test` quality gate.

### Provider adapter shape

A real adapter can be added later without changing the queue/runtime contract:

```js
const provider = {
  name: "provider-name",
  async generate({ prompt, schema, maxOutputTokens, metadata, signal }) {
    // Invoke the real provider using the supplied AbortSignal.
    // Return only structured output plus actual usage accounting.
    return {
      output: { /* JSON value matching schema */ },
      model: "deployment-model-id",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
      },
    };
  },
};
```

Provider adapters must honor `signal`, respect `maxOutputTokens`, and return non-negative integer usage. Missing or invalid usage is rejected fail-closed because the budget cannot otherwise be trusted.

### Prompt versioning

Published prompt behavior is selected by `{ id, version }`; there is no implicit "latest" prompt. A changed prompt must receive a new version instead of mutating an existing version in place. This keeps evaluator evidence reproducible and makes prompt provenance available in every successful result.

## Local configuration

Set the same secret for the API process and the worker:

```text
AI_WORKER_SHARED_SECRET=<local-secret>
AI_WORKER_API_URL=http://127.0.0.1:4100
AI_WORKER_CONCURRENCY=2
AI_WORKER_POLL_INTERVAL_MS=1000
AI_WORKER_LEASE_MS=120000
AI_WORKER_HEARTBEAT_MS=15000
AI_WORKER_REQUEST_TIMEOUT_MS=10000
```

Run the API/database migrations first, then:

```bash
npm run ai-worker:dev
```

The root `npm test` also runs the worker tests. PostgreSQL queue lifecycle coverage runs in the API suite when `AUTH_INTEGRATION_DATABASE_URL` is present, matching the repository's existing integration-test convention.

## Registering model-backed capabilities later

Capability processors remain registered in `src/main.mjs` (or a dedicated registry module) and should call `LLMProviderLayer.generateStructured(...)` instead of implementing retries, timeout, budget, prompt rendering, or fallback themselves.

Use queue-level `RetryableJobError` only after the provider layer has exhausted its own provider retry/fallback policy and the whole job should be rescheduled. Use `PermanentJobError` for invalid job payloads or policy failures. Provider adapters should use `LLMProviderError` for provider-local failure classification.
