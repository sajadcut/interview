# AI Recruiter Platform — PROJECT STATE

> **Status:** Core Product Closure implementation is staged on `main`. Primary recruiter surfaces now read persisted API/database state, internal Auth and Organization User Management use generated typed API contracts, migration recovery guidance and DB-backed organization lifecycle coverage are present, and CI now enforces migration contracts, the mandatory Dotin Nexus registry, OpenAPI/client regeneration, contract drift, lint, typecheck, tests and build. Final quality-gate validation is currently blocked externally because Dotin Nexus returns HTTP 500 for `livekit-client@2.21.0`; no public-registry bypass is permitted. Realtime runtime validation remains separately blocked by missing LiveKit Server, FFmpeg and whisper.cpp CLI on the workstation.
> **Version:** 0.14.0
> **Date:** 2026-09-01
> **Repository:** https://github.com/sajadcut/interview
> **Branch:** `main`

---

# 1. Current verified state

```text
Product architecture                       ✅ Defined in master.md
Core technical architecture                ✅ Defined
Interview architecture                     ✅ Defined
Production-readiness gates                 ✅ Defined
Node.js 25.9 / npm 11.x                    ✅ WORKSTATION/GITHUB RUNNER BASELINE
Dotin Nexus registry requirement            ✅ ENFORCED / NO BYPASS
Dotin Nexus livekit-client@2.21.0           🔴 HTTP 500 FROM Dotin-NPM
Migration sequencing + tenant FK contracts  ✅ CI PREFLIGHT GREEN (27 migrations)
Migration recovery procedure                ✅ docs/database-migration-runbook.md
Auth + session persistence                  ✅ DB-BACKED IMPLEMENTATION + EXISTING INTEGRATION COVERAGE
Refresh-token rotation                      ✅ DB-BACKED IMPLEMENTATION + EXISTING INTEGRATION COVERAGE
Organization user lifecycle                 ✅ DB-BACKED IMPLEMENTATION + NEW INTEGRATION COVERAGE
Organization role set incl. HR_MANAGER      ✅ BACKEND + UI ALIGNED
Primary Command Center                      ✅ PERSISTED API DATA
Jobs list                                   ✅ PERSISTED API DATA
Candidates list                             ✅ PERSISTED API DATA
Recruiting Analytics                        ✅ PERSISTED API DATA
Job create/workspace                        ✅ TYPED API CLIENT
Candidate Intelligence workspace            ✅ TYPED API CLIENT
Login/password reset/invite acceptance      ✅ TYPED API CLIENT
Organization Users settings                 ✅ TYPED API CLIENT
OpenAPI + typed-client regeneration         ✅ CI STEP DEFINED
Generated contract drift guard              ✅ CI FAILURE IF GENERATED FILES DIFFER
Latest HEAD lint/typecheck/test/build        ⏳ BLOCKED BEFORE INSTALL BY NEXUS E500
Production approval                         ⬜ NOT APPROVED
```

The current CI blocker is infrastructure outside the repository code path:

```text
npm view livekit-client@2.21.0 version
registry = https://nexus3.dotin.ir/repository/Dotin-NPM/
→ npm E500 Internal Server Error
→ GET .../Dotin-NPM/livekit-client
```

The private registry remains mandatory. The fix is to make `livekit-client@2.21.0` resolvable through `Dotin-NPM` (proxy/cache repair or hosted package in a repository included by that group), not to point npm at the public registry.

---

# 2. Core Product Closure delivered on main

## CI / dependency supply chain

- `.npmrc` remains locked to Dotin Nexus.
- `scripts/check-registry.mjs` validates the configured registry and probes the exact blocking package/version.
- Registry validation is a separate fast GitHub Actions job.
- The quality job runs only after the registry gate passes.
- CI then runs migration validation, `npm ci`, migrations, `api:sync`, generated-contract drift check, lint, typecheck, tests and build.
- Generated OpenAPI/client files are uploaded as a workflow artifact before drift validation so a legitimate contract update can be committed exactly rather than hand-authored.

## Real product data in primary recruiter UI

The main product entry surfaces no longer present fixture metrics as current organization data:

```text
/app
/app/jobs
/app/candidates
/app/analytics
```

They read persisted organization-scoped data through the API and expose loading/empty/error states.

Deep recruiting surfaces now use the generated client rather than hand-built endpoint strings:

```text
job creation
job recruiting workspace
candidate intelligence workspace
organization user management
internal login/session resolution
password reset request/complete
organization invitation acceptance
```

Development fixture-backed deep visual demos may still exist elsewhere for product/reference work; they are not claimed here as persisted production data.

## Auth / organization management contracts

OpenAPI response/request DTO coverage was added for internal Auth and organization-user flows, including:

```text
login
session
refresh
logout
password reset request/complete
organization user list
pending invitations
invite
role change
status change
membership removal
invitation acceptance
```

The UI role list is aligned with the backend canonical organization roles:

```text
ORGANIZATION_ADMIN
HR_MANAGER
RECRUITER
INTERVIEWER
HIRING_MANAGER
```

## Integration coverage

Existing PostgreSQL integration coverage already exercises persisted sessions and refresh-token rotation. Core Closure adds a PostgreSQL-backed organization lifecycle test covering:

```text
invitation persistence
raw-token hashing boundary
invitation acceptance
credential creation
membership listing
role change
disable
self-disable protection
self-remove protection
membership removal without deleting the global user
audit-event persistence
```

## Database operations

`docs/database-migration-runbook.md` defines:

```text
append-only forward migrations
checksum/advisory-lock invariants
pre-deploy backup evidence
migration application + idempotent second run
application-only rollback for compatible schemas
corrective forward migration
full database restore for destructive/unrecoverable incidents
required release evidence
```

Automatic destructive down-migrations are intentionally not used.

---

# 3. Validation still required after Nexus repair

As soon as Dotin Nexus can serve `livekit-client@2.21.0`, the existing GitHub Actions workflow must be allowed to reach the remaining gates on the same HEAD:

```text
registry probe
→ npm ci
→ db:migrate
→ api:sync
→ generated contract artifact
→ committed-contract drift check
→ lint
→ typecheck
→ PostgreSQL integration/unit tests
→ build
```

Because the committed `openapi/openapi.json` and generated client predate the new Auth/organization contract annotations, the first post-Nexus run may intentionally fail the drift check after producing the exact generated artifact. In that case the generated OpenAPI/client artifact must be committed, then the workflow rerun. No handwritten substitute should be used.

Core Product Closure is **implementation-complete but not validation-complete** until that final workflow is green.

---

# 4. M1–M6 product baseline

## M1 — Job → Candidate → Evidence

Tenant-safe jobs, requirements, rubrics, candidates, applications, evidence and scorecards exist. Candidate remains organization-global; Application remains job-specific. Missing evidence remains incomplete rather than fabricated.

## M2 — Sourcing + Talent

Internal-talent-first adapter architecture, sourcing runs, discovered candidates and merge review are persisted. Real semantic/pgvector retrieval and production external adapters remain incomplete.

## M3 — Outreach + Screening + Scheduling

Approved-knowledge grounding, persisted communications, deterministic hard-minimum screening with human review and provider-neutral scheduling lifecycle exist. Real outbound/calendar provider execution remains incomplete.

## M4 — AI Interview

Persisted release units/plans/sessions/turns/transcript/evidence, controlled candidate intents, deterministic Brain, release gating, consent/device UX, media readiness/persistence, short-lived LiveKit credential issuance, browser transport harness and local media-worker boundaries exist. Real-candidate autonomous interview remains blocked and is not production-approved.

## M5 — Assessments

Assessment persistence and isolated-runner boundary exist. Real isolated execution worker remains pending.

## M6 — Analytics + Enterprise hardening

Analytics/privacy/retention/event foundations, tenant isolation, RBAC and audit are materially advanced. External integrations, observability and broader production hardening remain incomplete.

---

# 5. Realtime blockers are separate from Core Closure

Current workstation runtime blockers remain:

```text
LiveKit Server executable                   ⏳ MISSING
FFmpeg executable                           ⏳ MISSING
whisper.cpp / whisper-cli executable        ⏳ MISSING
```

These executables are not needed to validate Core Product Closure. They are required later for realtime media transport/speech runtime validation.

The npm package `livekit-client@2.21.0` is different: it is a JavaScript build dependency already declared by the Web workspace and must be supplied by the mandatory Dotin Nexus registry before the normal quality gate can install dependencies.

---

# 6. Immediate external action

From the repository root, verify the Nexus package path with:

```powershell
npm view livekit-client@2.21.0 version --registry=https://nexus3.dotin.ir/repository/Dotin-NPM/ --fetch-retries=0
```

Healthy result:

```text
2.21.0
```

Current GitHub Actions result:

```text
E500 Internal Server Error
GET https://nexus3.dotin.ir/repository/Dotin-NPM/livekit-client
```

After Nexus returns `2.21.0`, rerun the latest failed GitHub Actions workflow and continue only from evidence produced by that exact HEAD.
