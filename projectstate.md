# AI Recruiter Platform — PROJECT STATE

> **Status:** Core Product Closure is implementation-complete and validation-complete. The evidence-backed AI Evaluator core, evaluator Calibration Framework, and non-influencing Shadow Testing Framework are code-complete and CI-validated. Real outbound Email providers (SMTP / Amazon SES / SendGrid), real Calendar providers (Google Calendar / Microsoft 365 Calendar), ATS provider code, external candidate sourcing providers, and the isolated Coding Assessment Sandbox worker are implemented. External credentialed connectivity and real sandbox-host security/runtime validation remain deployment-specific and are not claimed without deployment evidence. Real calibration datasets, qualified-human adjudication evidence, real shadow evidence, supervised pilot evidence, and production approval are still pending and remain release-gated by `production-readiness.md`.
> **Version:** 0.26.0
> **Date:** 2026-09-04
> **Repository:** https://github.com/sajadcut/interview
> **Branch:** `main`

---

# 1. Core Product Closure — verified

The deterministic GitHub Actions quality gate installs the committed lockfile, applies the PostgreSQL schema, verifies operational indexes, regenerates OpenAPI and the typed client, rejects generated-contract drift, and runs lint, typecheck, tests, production builds, deterministic browser fixtures, and critical browser E2E flows.

Recent implementation evidence:

```text
AI Evaluator core
  main commit                                 b2f8feb19d74408057827721d7b61554978a8c8b
  main quality-gate                           33680724740 / run #433
  result                                      ✅ success

Evaluator Calibration Framework
  main commit                                 77dd561ce4c0030817d631e0fe85f23cd52a9123
  pull request                                #5
  main quality-gate                           33684053908 / run #443
  result                                      ✅ success

Evaluator Shadow Testing Framework
  validated change head                      341249f284d3d1cf1d9691ee33578a84154eb573
  pull request                                #6
  quality-gate                                33687421974 / run #445
  migration contracts                        ✅
  PostgreSQL migrations (through 0040)       ✅
  operational DB indexes                     ✅
  OpenAPI / typed-client drift               ✅ clean
  lint                                        ✅
  typecheck                                   ✅
  tests incl. PostgreSQL isolation            ✅
  build                                       ✅
  Browser E2E critical flows                  ✅

Email + Calendar providers
  pull request                                #9
  providers                                   SMTP / SES / SendGrid / Google / Microsoft
  external production credential smoke test  deployment-specific / pending credentials

Coding Assessment Sandbox worker
  boundary                                    independent specialized worker
  execution                                   Docker/Podman container only; no host-process fallback
  initial language allowlist                  JavaScript / Python
  local dependency-free worker tests          ✅
  full Node 25 / PostgreSQL / GitHub gate     ASSESSMENT_SANDBOX_VALIDATION_PENDING
  real hardened sandbox-host smoke test       deployment-specific / pending
```

The quality gate is read-only with respect to source/generated artifacts. It does not delete or regenerate the dependency lockfile as part of installation and does not commit generated files back to `main`. Generated OpenAPI/client drift fails the gate and must be committed explicitly before a change is considered closure-ready.

---

# 2. Core product surfaces

Persisted organization-scoped API/database data backs the primary internal surfaces:

```text
/app
/app/jobs
/app/jobs/[jobId]
/app/candidates
/app/candidates/[candidateId]
/app/analytics
/app/interviews
/app/talent
/app/inbox
/app/automations
/app/integrations
/app/settings
/app/settings/audit
/app/settings/users
```

The Web contract guard rejects direct `/api/backend` fetches in production source/helpers and rejects the removed legacy demo fixtures. Product Operations (Automations, Integrations, Settings, Search and Audit) use generated typed API paths and schemas rather than a dynamic manual-fetch helper.

---

# 3. Identity, authorization and tenant safety

Implemented and covered:

```text
Argon2id credential hashing
DB-backed sessions
refresh-token rotation + reuse revocation
logout/session invalidation
single-use password reset + credential/session revocation
candidate invitation state (valid / used / expired / locked)
candidate identity/session flow
organization invitation/user lifecycle
RBAC + permission guard
tenant access resolution
PostgreSQL recruiting tenant-isolation test
audit export tenant-isolation test
```

Consequential hiring decisions remain human-controlled and score/evidence boundaries remain deterministic/auditable.

---

# 4. Database and migration operations

The current schema contains append-only migrations through `0045_assessment_worker_runtime.sql`, including supervised-pilot control-plane persistence, Shadow v2 integrity/telemetry hardening, calendar-provider operation-attempt persistence, ATS Greenhouse/Lever persistence, and durable lease/retry state for isolated assessment execution. The migration runner uses checksum tracking, an advisory lock and transactional migration application. `docs/database-migration-runbook.md` defines the rollback strategy:

```text
expand/contract schema changes
pre-deploy backup evidence
application rollback while schema remains compatible
forward corrective migration for schema defects
verified database restore for destructive/unrecoverable incidents
```

Automatic destructive down-migrations are intentionally not the production rollback strategy.

---

# 5. API contract boundary

Controller DTOs are the public OpenAPI source of truth. `npm run api:sync` regenerates:

```text
openapi/openapi.json
packages/api-client/src/generated/schema.ts
```

CI regenerates both and requires zero diff against committed artifacts. `package-lock.json` is independently canonical and consumed by `npm ci`.

The full Calibration and Shadow Testing Framework APIs are intentionally internal and permission-guarded while evaluation governance and real evidence are being established. The Assessment Sandbox lease API is also internal and excluded from public OpenAPI; it uses a dedicated shared-secret worker boundary and never grants candidate code an API credential. Existing public product contracts remain compatible until internal boundaries are intentionally promoted.

---

# 6. Current milestone state beyond Core Closure

```text
M1 Job → Candidate → Evidence        materially implemented
M2 Sourcing + Talent                provider-neutral architecture + internal/external provider implementations
M3 Outreach/Screening/Scheduling    persisted workflow/policy + SMTP/SES/SendGrid + Google/Microsoft Calendar implemented; external credential smoke tests deployment-specific
M4 Interview Brain/Evaluator        brain + evidence-backed evaluator + calibration + shadow frameworks implemented; realtime runtime and real validation evidence pending
M5 Assessments                      domain/runner contract + isolated container execution worker implemented; hardened-host smoke/load/security validation pending
M6 Analytics/Enterprise hardening   materially advanced
```

Candidate-facing consent, privacy/recording disclosure, device checks, Persian/English directionality, reconnect states and completion surfaces exist. Realtime contracts include media lifecycle, idempotent media journal, participant/TURN state, short-lived credentials, and VAD/STT/TTS provider boundaries.

The Email integration has real provider adapters for SMTP, Amazon SES v2 and SendGrid v3. Approved outbound messages and recruitment notifications use provider acceptance before being marked sent, delivery attempts/provider references are persisted, configuration fails closed, and protocol tests run against local SMTP/HTTP fakes without committing credentials.

The Calendar integration has real Google Calendar and Microsoft 365 Calendar adapters. Google uses service-account JWT OAuth with deterministic custom event IDs for duplicate prevention; Microsoft uses Entra client-credentials OAuth and Graph event `transactionId`. Scheduling confirmation persists a remote provider reference only after event creation succeeds, cancellation removes an existing remote event before local cancellation, provider mismatch/disabled states fail closed for existing remote events, and reserve/cancel attempts are persisted. No deployment credential is committed or claimed as externally smoke-tested.

The Coding Assessment Sandbox is a separate specialized worker under `services/assessment-worker`. The core API persists/leases jobs and results but never executes candidate source code. The worker supports an initial JavaScript/Python allowlist and executes hidden deterministic test cases only inside Docker/Podman containers with network disabled, read-only root/source filesystems, dropped capabilities, `no-new-privileges`, non-root execution, CPU/memory/PID/output/time bounds, pre-pulled images, lease heartbeats, bounded retries and stale-lease rejection. There is deliberately no direct host-process fallback. Production activation still requires a dedicated hardened Linux worker host, rootless runtime where practical, digest-pinned images, and real isolation/smoke/load evidence.

The AI Evaluator is provider-neutral and LLM-independent at the validation/scoring boundary. It validates rubric criteria and persisted evidence, requires candidate-grounded finalized transcript evidence, computes conservative confidence, refuses unsupported scoring, persists provenance/idempotency state, and delegates deterministic final score computation to the domain score engine. Human review remains mandatory.

The Calibration Framework provides versioned datasets, qualified-human references, criterion/overall agreement metrics, false-reject/false-promotion analysis, confidence calibration, slices, immutable comparison provenance and dataset-specific gates.

The Shadow Testing Framework provides release-unit-scoped programs, prospective blind evaluation, sealed AI results, independent human outcomes, failure/latency telemetry, disagreement/root-cause queues, aggregate agreement metrics and PostgreSQL isolation proving Shadow does not mutate consequential scorecards or pipeline state.

No real candidate calibration corpus, real shadow corpus, hardened production assessment sandbox evidence, or production acceptance evidence is claimed by these implementations.

---

# 7. Production-readiness boundary

Core Product Closure, provider integrations, the AI Evaluator implementation, Calibration Framework, Shadow Testing Framework, and Assessment Sandbox code being green do **not** approve autonomous real-candidate interviewing.

The framework needed to collect and compare qualified-human and AI evaluation evidence is implemented. Gate H remains evidence-pending until representative real calibration data is collected and adjudicated. The SHADOW lifecycle now has a code-complete evidence-capture/comparison framework, but the real Shadow stage is not complete until representative real interviews have produced sealed AI outputs, independent qualified-human outcomes, disagreement/root-cause evidence, and accepted aggregate metrics. Neither a calibration result nor a shadow-program gate has production-release authority by itself.

LiveKit/FFmpeg/whisper.cpp runtime validation, speech/realtime benchmarks, real evaluator calibration evidence, real shadow evidence, supervised pilot evidence, and production approval remain governed by `production-readiness.md`.

The isolated assessment execution worker is implemented independently from realtime/media/AI workers, but hardened production-host validation, container isolation evidence, pinned-image provenance and load/abuse testing remain required before treating arbitrary candidate code execution as production-ready. Email/calendar/ATS/sourcing provider code is implemented, but actual third-party account connectivity still requires deployment credentials and provider-side permissions/configuration.

---

# 8. Repository governance

The code-level quality gate is complete and green for previously validated milestones. The Coding Assessment Sandbox change remains `ASSESSMENT_SANDBOX_VALIDATION_PENDING` until its `main` commit passes the same deterministic GitHub Actions quality gate and a real hardened sandbox host is separately smoke-tested for deployment readiness.

The current development model permits direct maintenance on `main`, so GitHub branch protection is treated as optional governance hardening rather than a Core Closure requirement.

The enforced source-level protections are the deterministic `quality-gate` workflow, committed dependency lockfile, generated-contract drift check, migration/index verification, typed-client usage guard, lint, typecheck, full test suite (including the dependency-free assessment-worker tests), production build, deterministic browser fixtures, and critical Browser E2E flows. If the repository later moves to a multi-contributor or pull-request-only workflow, branch protection with required `quality` status checks should be enabled as an additional governance layer.
