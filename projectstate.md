# AI Recruiter Platform — PROJECT STATE

> **Status:** Core Product Closure is implementation-complete and validation-complete. The evidence-backed AI Evaluator core and the evaluator Calibration Framework are now code-complete and CI-validated. Real calibration datasets, qualified-human adjudication evidence, shadow testing, supervised pilot evidence, and production approval are still pending and remain release-gated by `production-readiness.md`.
> **Version:** 0.22.0
> **Date:** 2026-09-03
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
  validated change head                      2798b08e3b8f45daadcf5fc8d6c8d38527515a38
  pull request                                #5
  quality-gate                               33683568307 / run #441
  migration contracts                        ✅
  PostgreSQL migrations (through 0039)       ✅
  operational DB indexes                     ✅
  OpenAPI / typed-client drift               ✅ clean
  lint                                        ✅
  typecheck                                   ✅
  tests incl. PostgreSQL integration          ✅
  build                                       ✅
  Browser E2E critical flows                  ✅
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

The current schema contains append-only migrations through `0039_evaluator_calibration_framework.sql`. The migration runner uses checksum tracking, an advisory lock and transactional migration application. `docs/database-migration-runbook.md` defines the rollback strategy:

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

The full Calibration Framework API is intentionally internal and permission-guarded while calibration governance and real benchmark data are being established. Existing public calibration endpoints remain compatible; internal framework routes are excluded from public OpenAPI until that boundary is intentionally promoted.

---

# 6. Current milestone state beyond Core Closure

```text
M1 Job → Candidate → Evidence        materially implemented
M2 Sourcing + Talent                provider-neutral architecture + internal source implemented; external providers plug-in
M3 Outreach/Screening/Scheduling    persisted workflow/policy implemented; real email/calendar providers plug-in
M4 Interview Brain/Evaluator        brain + evidence-backed evaluator + calibration framework implemented; realtime runtime and real calibration evidence pending
M5 Assessments                      domain/runner contract implemented; isolated execution worker pending
M6 Analytics/Enterprise hardening   materially advanced
```

Candidate-facing consent, privacy/recording disclosure, device checks, Persian/English directionality, reconnect states and completion surfaces exist. Realtime contracts include media lifecycle, idempotent media journal, participant/TURN state, short-lived credentials, and VAD/STT/TTS provider boundaries.

The AI Evaluator is provider-neutral and LLM-independent at the validation/scoring boundary. It validates rubric criteria and persisted evidence, requires candidate-grounded finalized transcript evidence, computes conservative confidence, refuses unsupported scoring, persists provenance/idempotency state, and delegates deterministic final score computation to the domain score engine. Human review remains mandatory.

The Calibration Framework now provides:

```text
versioned calibration datasets with explicit thresholds
draft → locked dataset lifecycle
multiple qualified-human reviews per case
one adjudicated immutable human reference per case
criterion-level Human ↔ AI score comparison
coverage / MAE / RMSE / max delta / signed bias
recommendation agreement
false-reject and false-promotion measurement
evidence-reference agreement
low-confidence measurement
weighted overall Human ↔ AI ranking comparison
Pearson score correlation
Spearman ranking correlation
score-delta percentiles
confidence-calibration buckets and Expected Calibration Error
job-family / language / interview-type slices
idempotent immutable comparison runs with provider/model/prompt provenance
dataset-specific calibration gate thresholds
```

No real candidate calibration corpus or production acceptance evidence is claimed by this implementation.

---

# 7. Production-readiness boundary

Core Product Closure, the AI Evaluator implementation, and the Calibration Framework being green do **not** approve autonomous real-candidate interviewing.

The framework needed to collect and compare qualified-human and AI evaluation evidence is implemented, but Gate H remains evidence-pending until representative real calibration data is collected, adjudicated, analyzed across required slices, and accepted against explicitly approved thresholds. A calibration gate result has no release authority by itself.

LiveKit/FFmpeg/whisper.cpp runtime validation, speech/realtime benchmarks, real evaluator calibration evidence, shadow testing, supervised pilot evidence, and production approval remain governed by `production-readiness.md`.

External provider implementations (ATS/job board/email/calendar), the isolated assessment execution worker, and realtime media/speech runtime are separate milestones rather than hidden Core Closure debt.

---

# 8. Repository governance

The code-level quality gate is complete and green. The current development model permits direct maintenance on `main`, so GitHub branch protection is treated as optional governance hardening rather than a Core Closure requirement.

The enforced source-level protections are the deterministic `quality-gate` workflow, committed dependency lockfile, generated-contract drift check, migration/index verification, typed-client usage guard, lint, typecheck, full test suite, production build, deterministic browser fixtures, and critical Browser E2E flows. If the repository later moves to a multi-contributor or pull-request-only workflow, branch protection with required `quality` status checks should be enabled as an additional governance layer.
