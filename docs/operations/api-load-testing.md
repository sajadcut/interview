# API / PostgreSQL load testing

This load test measures the HTTP API and the PostgreSQL work performed by real product routes. It deliberately does **not** wait for LiveKit, Whisper, FFmpeg, TTS, or an LLM. Realtime audio load, transport fan-out, media jitter, and end-to-end spoken-interview latency remain a separate gate until LiveKit is available.

## What is exercised

The runner uses `/health` for API overhead, `/health/ready` for database readiness queries, authenticated `/auth/session`, recruiting aggregate reads, multi-query job/candidate workspaces, a deliberately heavier candidate-list query, and audited `PATCH /v1/jobs/:jobId` writes. The write scenario only targets deterministic titles prefixed with `Load Test Write Job `; there is no special production-only load-test endpoint or authorization bypass.

Before an authenticated run, seed the normal development identity/domain fixtures and then create scalable synthetic load fixtures:

```bash
npm run db:migrate
npm run dev:bootstrap
LOAD_TEST_CANDIDATES=1200 LOAD_TEST_JOBS=24 npm run load:test:seed
```

Start the API with a non-test runtime so the normal database pool is used, then run a profile:

```bash
NODE_ENV=development npm run dev:api
LOAD_TEST_URL=http://127.0.0.1:4000 \
LOAD_TEST_PROFILE=ci \
LOAD_TEST_USER_EMAIL="$DEV_USER_EMAIL" \
LOAD_TEST_USER_PASSWORD="$DEV_USER_PASSWORD" \
LOAD_TEST_ENABLE_WRITES=true \
LOAD_TEST_REPORT=load-test-report.json \
npm run load:test
```

Profiles are `public`, `smoke`, `ci`, and `capacity`. `public` requires no login and tests only API health plus DB readiness. Authenticated profiles require the seeded internal user. `audited-write` can be disabled with `LOAD_TEST_ENABLE_WRITES=false` when testing a persistent environment where fixture mutation is undesirable.

Each scenario reports request count, concurrency, requests/second, response MiB, p50/p95/p99/max latency, status distribution, and error rate. The run fails when a scenario exceeds its p95 or error-rate threshold. Individual scenario request counts, concurrency, and p95 ceilings can be overridden with environment variables such as `LOAD_TEST_JOBS_AGGREGATE_REQUESTS`, `LOAD_TEST_JOBS_AGGREGATE_CONCURRENCY`, and `LOAD_TEST_JOBS_AGGREGATE_P95_MAX_MS`.

GitHub Actions has a dedicated `api-db-load-test` workflow. It starts PostgreSQL, migrates and seeds a disposable database, launches the built API with `NODE_ENV=development`, captures `pg_stat_database` before and after the run, executes the selected profile, and uploads the JSON report plus API/DB evidence.

The resulting throughput is **not a production capacity claim**. GitHub-hosted runner CPU, storage, network, PostgreSQL topology, connection pool size, dataset shape, and deployment architecture differ from production. Use these results to detect regressions and establish a tested baseline; run the same harness against production-like infrastructure before setting customer concurrency/SLA limits.
