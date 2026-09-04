# AI Recruiter Platform — PROJECT STATE

> **Status:** Core Product Closure and the current pre-realtime hardening stack are implementation-complete and CI-validated. This includes authentication/authorization hardening, privacy deletion and retention workers, isolated assessment execution, Security Hardening, base/advanced operational Monitoring, Realtime Metrics Contract v1, Alerting Contract v1, LiveKit Deployment Contract, and Whisper STT Integration Contract v1. Real third-party credentials, hardened production worker hosts, production Prometheus/Alertmanager/Grafana deployment and receiver delivery, real evaluator calibration/shadow/pilot evidence, actual LiveKit/FFmpeg runtime telemetry, real whisper.cpp runtime evidence, representative realtime benchmarks, and final production approval remain deployment/evidence-gated by `production-readiness.md`.
> **Version:** 0.34.0
> **Date:** 2026-09-05
> **Repository:** https://github.com/sajadcut/interview
> **Branch:** `main`

---

# 1. Current validated baseline

The deterministic GitHub Actions quality gate installs the committed lockfile, validates and applies PostgreSQL migrations, verifies operational indexes, regenerates OpenAPI and the typed client, rejects generated-contract drift, and runs lint, typecheck, PostgreSQL/integration/unit tests, specialized worker tests, alerting-contract validation, LiveKit deployment-contract validation, Whisper STT contract validation, production builds, deterministic browser fixtures, and critical Browser E2E flows.

Recent implementation evidence:

```text
Coding Assessment Sandbox worker
  validated main commit                       b5aafb702e30b34d9ad47380108235ea8f9df8a6
  quality-gate                                33881153098 / run #509
  boundary                                    independent specialized worker
  execution                                   Docker/Podman container only; no host-process fallback
  initial language allowlist                  JavaScript / Python
  result                                      ✅ success
  real hardened sandbox-host smoke test       deployment-specific / pending

Security Hardening baseline
  validated main commit                       bb3f2db35c89e673948515543a053df634ab7d68
  quality-gate                                33902965785 / run #554
  secret handling                             centralized validation + constant-time worker secret comparison
  log/audit redaction                         application + PostgreSQL defense-in-depth
  headers                                     API + Next security headers / CSP / HSTS production policy
  token security                              hardened production cookies + existing rotation/reuse controls
  permission audit                            grant/deny audit coverage
  result                                      ✅ success

Base + Advanced Monitoring
  validated main commit                       06f80608a095a7ccbb13ab597498bff5bdb461ff
  quality-gate                                33905072061 / run #556
  endpoint                                    GET /metrics; Prometheus text; public OpenAPI excluded
  API runtime                                 throughput / in-flight / 5xx / status class / latency histogram / CPU / memory
  PostgreSQL                                  connectivity / connections / size / transactions / cache / deadlocks / temp bytes
  durable queues                              AI / Assessment / Privacy / Retention depth, ready backlog, age, attempts, failures
  workers                                     active leases / expired leases / lease-derived active workers / last activity
  interview lifecycle                         session states / stalled sessions / duration / transcript / evidence / media heartbeat/errors/reconnects
  scrape protection                           coalesced cached snapshots + bounded PostgreSQL statement timeout
  cardinality/privacy                         no org/candidate/job/worker/token identifiers exported as metric labels
  result                                      ✅ success

Realtime Metrics Contract v1
  validated main commit                       b31a82df01ec8ce19342abde28208702df1e5fa4
  quality-gate                                33907049793 / run #558
  source of truth                             contracts/realtime-metrics.v1.json
  namespace                                   interview_realtime_*
  media-worker endpoint                       GET /metrics; Prometheus text; internal operational surface
  LiveKit contract                            control-plane latency/results + sessions/participants + RTT/jitter/loss/reconnects
  whisper.cpp wired telemetry                 requests/results + processing latency + WAV duration + realtime factor + empty transcripts
  FFmpeg contract                             jobs/latency/input duration/RTF/bytes/frames/exits/active processes
  cross-pipeline SLI                          vad_to_stt / stt / brain / tts / avatar / e2e
  Gate F histogram boundary                   explicit 1.8 second E2E bucket
  cardinality/privacy                         finite label allowlists; ID/PII/unbounded labels forbidden
  false-green protection                      provider_data_pending families emit no synthetic zero observations
  recorder boundary                           LiveKit / FFmpeg / turn-stage adapters ready for measured values
  result                                      ✅ success
  real LiveKit RTP / FFmpeg runtime samples   deployment/runtime-specific / pending
  representative Gate F benchmark             evidence-specific / pending

Alerting Contract v1
  validated main commit                       4ce0141353bf6c4f850527c7a84bf3fcfbcb8973
  quality-gate                                33910542611 / run #569
  contract                                    ops/monitoring/alerting-contract.v1.json
  Prometheus rules                            36 rules under ops/monitoring/prometheus-alerts.yml
  coverage                                    collector / API errors+latency / PostgreSQL / queues / workers / interview / realtime
  escalation                                  paired warning/critical alert_family policy where escalation is meaningful
  runbook                                     docs/operations/alerting-runbook.md
  result                                      ✅ success

LiveKit Deployment Contract
  validated main commit                       bf3f48f1056511918bae39d3c1fae4a44b2b9a62
  quality-gate                                33914568659 / run #571
  final documented HEAD                       dc3ab5065283e85c9606c61975a43cbc99177d0d
  final quality-gate                          33915022521 / run #572
  adapter                                     LiveKitTransportAdapter behind REALTIME_TRANSPORT_ADAPTER
  health                                      GET /health/livekit; public OpenAPI excluded
  startup policy                              livekit optional when disabled; fail-closed validation when selected
  production transport                       wss:// required; health https:// required; strong secret required
  deployment template                         ops/livekit/livekit.yaml.example
  runbook                                     docs/operations/livekit-deployment.md
  contract check                              ✅ npm run livekit:config:check
  result                                      ✅ success
  real LiveKit/TURN/RTP evidence              deployment/runtime-specific / pending

Whisper STT Integration Contract v1
  validated main commit                       9ddc5d1f611a02b52729d3650ba3af89197aea19
  quality-gate                                33919266035 / run #583
  source of truth                             contracts/whisper-stt.v1.json
  provider abstraction                        SPEECH_TO_TEXT_ADAPTER
  API client                                  WhisperHttpClient
  worker endpoints                            GET /stt/health + POST /stt/finalize
  contract version                            whisper-stt.v1
  request                                     WAV only; max 20 MiB; bounded request id; shared-secret auth
  timeout/retry                               per-attempt timeout + bounded exponential retry + Retry-After
  retryable conditions                        network/client timeout + 429/500/502/503/504
  deterministic failures                      contract/auth/request/media/audio validation are non-retryable
  response validation                         content type + header version + body version + provider + request-id + final schema
  production transport                       https:// required; strong media-worker secret required
  privacy/security                            raw audio not persisted by API; redirects disabled; stderr/provider diagnostics not returned
  internal health                             GET /health/whisper; public OpenAPI excluded
  contract check                              ✅ npm run whisper:contract:check
  TypeScript client tests                     ✅
  dependency-free Python HTTP contract tests  ✅
  lint / typecheck / full tests / build       ✅
  Browser E2E critical flows                  ✅
  result                                      ✅ success
  real whisper.cpp runtime/quality evidence   deployment/runtime-specific / pending
```

The quality gate is read-only with respect to source/generated artifacts. Generated OpenAPI/client drift fails the gate and must be committed explicitly before a change is considered closure-ready.

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

The Web contract guard rejects direct `/api/backend` fetches in production source/helpers and rejects removed legacy demo fixtures. Product Operations use generated typed API paths and schemas rather than a dynamic manual-fetch helper.

---

# 3. Identity, authorization, security and tenant safety

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
permission grant/deny audit trail
central secret validation and worker shared-secret hardening
recursive structured-log and audit redaction
PostgreSQL audit secret-redaction trigger
production cookie hardening
API + Web security headers / CSP / HSTS policy
PostgreSQL recruiting tenant-isolation test
audit export tenant-isolation test
```

Consequential hiring decisions remain human-controlled and score/evidence boundaries remain deterministic/auditable.

---

# 4. Database and migration operations

The append-only schema is current through `0052_monitoring_indexes.sql`.

Recent operational migrations include:

```text
0045_assessment_worker_runtime.sql       durable assessment lease/retry runtime
0046_privacy_deletion_worker.sql        durable verified privacy deletion jobs/objects/receipts
0047_retention_worker.sql               automatic durable retention execution
0048_privacy_receipt_conflict_target.sql
0049_audit_export_indexes.sql
0050_auth_rate_limit_hardening.sql
0051_audit_secret_redaction.sql         PostgreSQL audit defense-in-depth
0052_monitoring_indexes.sql             queue/interview/media monitoring read paths
```

Realtime provider telemetry is intentionally not persisted as OLTP rows merely to satisfy monitoring. Prometheus is the intended time-series sink; durable interview lifecycle/audit evidence remains in the existing relational/event schema.

The migration runner uses checksum tracking, an advisory lock and transactional application. `docs/database-migration-runbook.md` defines expand/contract changes, pre-deploy backup evidence, compatible application rollback, forward corrective migrations, and verified restore for destructive incidents. Automatic destructive down-migrations are intentionally not the production rollback strategy.

---

# 5. API and operational contract boundary

Controller DTOs are the public OpenAPI source of truth. `npm run api:sync` regenerates:

```text
openapi/openapi.json
packages/api-client/src/generated/schema.ts
```

CI requires zero generated-contract drift. Internal worker lease APIs remain excluded from public OpenAPI and use dedicated shared-secret boundaries. Candidate code never receives an API credential and is never executed by the core API.

The API `GET /metrics` is deliberately excluded from public OpenAPI. It exposes aggregate Prometheus text only and must be deployed on an internal/protected operational network path. Runtime HTTP/process counters are in-process; durable DB/queue/worker/interview state is derived from PostgreSQL at scrape time so operational state survives API restarts. Snapshot collection is cached/coalesced and uses a bounded database statement timeout.

The media worker separately exposes `GET /metrics`. Its metric behavior is governed by `contracts/realtime-metrics.v1.json` and `docs/operations/realtime-metrics-contract.md`. The registry rejects unknown metric families, missing/extra labels, and label values outside finite allowlists. Contract-only LiveKit/FFmpeg families remain absent until an actual adapter records measured observations; this prevents synthetic telemetry from being mistaken for runtime evidence.

Alert behavior is separately governed by `ops/monitoring/alerting-contract.v1.json`. Prometheus rules must pass `npm run alerting:check`, which validates required categories, contracted rule names, warning/critical family semantics, bounded static labels, positive `for` durations, runbook anchors, balanced expressions, and realtime metric references against the Realtime Metrics Contract. The contract deliberately describes routing intent without embedding Alertmanager receiver credentials or deployment secrets.

LiveKit deployment wiring is governed by the runtime config in `apps/api/src/config/env.ts`, `LiveKitTransportAdapter`, the internal `GET /health/livekit` endpoint, and `npm run livekit:config:check`. The deployment template intentionally contains placeholders only and never production credentials.

Whisper transport behavior is governed by `contracts/whisper-stt.v1.json`, `WhisperHttpClient`, `services/media-worker/whisper_contract.py`, and `docs/operations/whisper-integration-contract.md`. The core API validates the complete successful response contract before accepting transcript text, does not follow redirects while sending audio/credentials, and retries only explicitly transient failures. The worker returns bounded structured errors instead of raw subprocess diagnostics.

---

# 6. Current milestone state beyond Core Closure

```text
M1 Job → Candidate → Evidence        materially implemented
M2 Sourcing + Talent                provider-neutral architecture + internal/external provider implementations
M3 Outreach/Screening/Scheduling    persisted workflow/policy + SMTP/SES/SendGrid + Google/Microsoft Calendar implemented; external credential smoke tests deployment-specific
M4 Interview Brain/Evaluator        brain + evaluator/calibration/shadow + monitoring + realtime/alerting + LiveKit deployment + Whisper integration contracts implemented; actual realtime provider runtime and representative Gate F evidence pending
M5 Assessments                      isolated container execution worker implemented and CI-validated; hardened-host smoke/load/security validation pending
M6 Analytics/Enterprise hardening   privacy deletion + retention + security hardening + operational monitoring + alerting contract materially implemented and CI-validated
```

Candidate-facing consent, privacy/recording disclosure, device checks, Persian/English directionality, reconnect states and completion surfaces exist. Realtime contracts include media lifecycle, idempotent media journal, participant/TURN state, short-lived credentials, VAD/STT/TTS provider boundaries, a frozen low-cardinality metrics contract for LiveKit/whisper.cpp/FFmpeg and E2E turn latency, deployment wiring for LiveKit, and a versioned HTTP contract for Whisper STT.

The Privacy Deletion Worker performs verified object deletion plus derived-data cleanup, blocks on legal holds/shared-object safety conditions, and writes de-identified durable receipts. The Retention Worker delegates candidate erasure through the privacy deletion boundary rather than bypassing verified deletion semantics.

The Coding Assessment Sandbox remains a separate specialized worker. The core API persists/leases jobs and results but never executes candidate source code. There is deliberately no direct host-process fallback.

The AI Evaluator is provider-neutral and LLM-independent at the validation/scoring boundary. Calibration and Shadow frameworks persist the evidence needed for qualified-human comparison while keeping real production release authority outside those framework results.

Operational Monitoring covers API, PostgreSQL, all four durable worker queues, lease state, persisted Interview/media lifecycle, and the media-worker realtime contract surface. Alerting Contract v1 adds CI-validated Prometheus rules across collector health, API errors/latency, PostgreSQL, queue backlog/leases/failures, worker availability, stalled interviews, media heartbeat/error health, Gate F E2E latency, Whisper, LiveKit, and FFmpeg.

---

# 7. Production-readiness boundary

A green repository does **not** by itself approve autonomous real-candidate interviewing.

Still requiring real environment/evidence validation:

```text
actual LiveKit transport/control-plane integration and RTP telemetry
actual TURN/firewall/TLS validation under real network conditions
actual FFmpeg media-pipeline execution telemetry
real whisper.cpp model/host performance and quality evidence
real Whisper request latency/error/RTF observations through the v1 HTTP contract
100+ representative realtime interview benchmark required by Gate F
speech/realtime quality, reconnect and load evidence
representative evaluator calibration data + qualified-human adjudication
representative shadow evidence
supervised pilot evidence
hardened production assessment-worker host and pinned-image provenance
real email/calendar/ATS/sourcing credentials and provider-side permissions
production backup/replica/object-version privacy-erasure lifecycle evidence
Prometheus / Alertmanager / Grafana deployment and real alert-delivery evidence
real warning/critical receiver tests, paging/escalation, inhibition and maintenance-silence evidence
worker process/service-level liveness supervision beyond lease-derived metrics
long-term metrics retention, dashboard/SLO tuning, paging policy and capacity baselines
final production approval
```

The Realtime Metrics Contract guarantees that future provider data has a stable, bounded and testable place to land. It does **not** satisfy Gate F by itself. In particular, absence of a provider-data-pending series is not success, component readiness is not an SLA, and the committed `1.8s` histogram bucket is only measurement geometry until representative real interview observations exist.

The LiveKit Deployment Contract proves configuration policy, health wiring, token issuance and CI consistency without proving real media transport. The Whisper STT Integration Contract proves client/worker HTTP semantics, timeout/retry behavior, error mapping and response validation without proving model accuracy, production host performance, or language quality. Those require environment-specific evidence.

---

# 8. Repository governance

The current direct-maintenance-on-`main` model remains supported. The enforced source-level protections are the deterministic `quality-gate`, committed dependency lockfile, migration/index verification, generated-contract drift check, typed-client usage guard, `npm run whisper:contract:check`, `npm run livekit:config:check`, `npm run alerting:check`, lint, typecheck, full test suite (including PostgreSQL privacy/monitoring integration, TypeScript realtime/Whisper contract tests, dependency-free Python media-worker tests, alerting contract/runbook checks, and specialized worker tests), production build, deterministic browser fixtures, and critical Browser E2E flows.

If the repository later moves to a multi-contributor or pull-request-only workflow, branch protection with required `quality` status checks should be enabled as an additional governance layer.
