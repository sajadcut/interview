# AI Recruiter Platform — PROJECT STATE

> **Status:** Core Product Closure is implementation-complete and validation-complete on `main`. The deterministic GitHub Actions quality gate installs the committed lockfile, applies the full PostgreSQL schema, regenerates and verifies OpenAPI/typed-client drift, runs lint/typecheck/tests, and produces the production Web/API build. Branch protection is an optional repository-governance hardening choice for the current development model and is not tracked as Core Product Closure debt.
> **Version:** 0.20.1
> **Date:** 2026-09-02
> **Repository:** https://github.com/sajadcut/interview
> **Branch:** `main`

---

# 1. Core Product Closure — verified

Evidence from GitHub Actions quality-gate run `33608615821` on commit `396a63f26380cf14ac0d91270fe13055f48fd26b`:

```text
Node.js                                       25.9.0
npm                                           11.6.2 pinned by CI
Registry                                      https://registry.npmjs.org/
Migration contract validation                ✅
Frontend direct-backend/demo fixture guard   ✅
Committed lockfile npm ci                     ✅
Production dependency high-severity audit    ✅ (0 high-severity findings)
PostgreSQL migrations                         ✅ 34/34
Operational DB index contracts               ✅ 21/21
OpenAPI regeneration                          ✅
Typed API client regeneration                 ✅
Generated contract drift                      ✅ clean
Lint                                          ✅
Typecheck                                     ✅
Tests                                         ✅ 92/92, 0 failed, 0 skipped
Build                                         ✅ API + Next.js production build
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

Current schema contains 34 append-only migrations. The migration runner uses checksum tracking, an advisory lock and transactional migration application. `docs/database-migration-runbook.md` defines the rollback strategy:

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

Controller DTOs are the OpenAPI source of truth. `npm run api:sync` regenerates:

```text
openapi/openapi.json
packages/api-client/src/generated/schema.ts
```

CI regenerates both and requires zero diff against committed artifacts. `package-lock.json` is independently canonical and consumed by `npm ci`.

---

# 6. Current milestone state beyond Core Closure

```text
M1 Job → Candidate → Evidence        materially implemented
M2 Sourcing + Talent                provider-neutral architecture + internal source implemented; external providers plug-in
M3 Outreach/Screening/Scheduling    persisted workflow/policy implemented; real email/calendar providers plug-in
M4 Interview Brain/contracts        materially implemented; realtime runtime validation remains pending
M5 Assessments                      domain/runner contract implemented; isolated execution worker pending
M6 Analytics/Enterprise hardening   materially advanced
```

Candidate-facing consent, privacy/recording disclosure, device checks, Persian/English directionality, reconnect states and completion surfaces exist. Realtime contracts include media lifecycle, idempotent media journal, participant/TURN state, short-lived credentials, and VAD/STT/TTS provider boundaries.

---

# 7. Production-readiness boundary

Core Product Closure being green does **not** approve autonomous real-candidate interviewing. LiveKit/FFmpeg/whisper.cpp runtime validation, speech/realtime benchmarks, evaluator calibration, shadow testing, supervised pilot evidence and production approval remain governed by `production-readiness.md`.

External provider implementations (ATS/job board/email/calendar), the isolated assessment execution worker, and realtime media/speech runtime are separate milestones rather than hidden Core Closure debt.

---

# 8. Repository governance

The code-level quality gate is complete and green. The current development model permits direct maintenance on `main`, so GitHub branch protection is treated as optional governance hardening rather than a Core Closure requirement.

The enforced source-level protections are the deterministic `quality-gate` workflow, committed dependency lockfile, generated-contract drift check, migration/index verification, typed-client usage guard, lint, typecheck, full test suite and production build. If the repository later moves to a multi-contributor or pull-request-only workflow, branch protection with required `quality` status checks should be enabled as an additional governance layer.
