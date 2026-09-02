# AI Worker

`services/ai-worker` is the provider-neutral background execution runtime for AI/evaluator workloads.

It is intentionally usable before an LLM is installed. The worker owns execution mechanics only; model/provider code is registered as a capability processor later.

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
- No production LLM is faked. `system.healthcheck` is the only built-in processor and exists only to validate worker plumbing.

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

Tests:

```bash
npm run ai-worker:test
```

The root `npm test` also runs these worker tests. PostgreSQL queue lifecycle coverage runs in the API suite when `AUTH_INTEGRATION_DATABASE_URL` is present, matching the repository's existing integration-test convention.

## Adding an LLM later

Add a processor to the registry in `src/main.mjs` (or extract a provider-specific registry module) with this shape:

```js
async ({ job, payload, signal, workerId }) => {
  // call the real provider using signal for cancellation
  return { /* structured JSON result */ };
}
```

Use `RetryableJobError` for temporary provider/network/rate-limit failures and `PermanentJobError` for invalid/non-retryable work. The queue lifecycle does not need to change when the real model is installed.
