# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 JavaScript foundation validated on Windows; M1–M5 architecture/code baseline implemented; PostgreSQL 17.11 connectivity validated; M1 migration and generated-client type fixes pushed for re-validation  
> **Version:** 0.10.1  
> **Date:** 2026-08-31  
> **Repository:** https://github.com/sajadcut/interview  
> **Branch:** `main`

---

# 1. Current state

```text
Product architecture                     ✅ Defined
Core technical architecture              ✅ Defined
Interview architecture                   ✅ Defined
Production-readiness gates               ✅ Defined
Laptop-first dev baseline                ✅ Locked
Node.js 25.9 runtime baseline            ✅ VALIDATED ON WINDOWS
npm 11.6 workspaces                      ✅ VALIDATED ON WINDOWS
Dotin Nexus npm registry                 ✅ VERIFIED ON WORKSTATION
Clean npm install                        ✅ SUCCESS (320 packages)
Workspace metadata check                 ✅ SUCCESS (8 workspaces)
JavaScript workstation check             ✅ NODE/NPM/GIT VERIFIED
PostgreSQL 17.11 client                  ✅ INSTALLED / psql VERIFIED
PostgreSQL application authentication    ✅ VALIDATED AS interview@interview
Database migration runner                ✅ TRANSACTIONAL / CHECKSUM-TRACKED
Database migrations 0001–0013            ⚠️ 0008 FAILED ON RESERVED current_role / FIX PUSHED / RERUN PENDING
Development bootstrap                    ✅ SUCCESS
OpenAPI + typed client sync              ✅ SUCCESS LOCALLY / RERUN AFTER HEALTH FIX PENDING
Latest M1–M5 lint                        ✅ SUCCESS
Latest M1–M5 typecheck                   ⚠️ WEB HEALTH GENERATED TYPE FAILURE / FIX PUSHED
Latest M1–M5 API tests                   ✅ 27/27 PASS
Latest M1–M5 production build            ⏳ RESULT NOT YET CAPTURED
Executable browser review                ✅ TWO PASSES COMPLETED
Visual acceptance                        ⚠️ NOT YET COMPLETE
M1 Job → Candidate → Evidence             🟡 CODED / DB RERUN + API + VISUAL VALIDATION PENDING
M2 Sourcing + Talent                     🟡 CODED / DB+API+VISUAL VALIDATION PENDING
M3 Outreach + Screening + Scheduling     🟡 CODED / DB+API+VISUAL VALIDATION PENDING
M4 AI Interview                          🟡 DEV_ONLY CONTRACTS CODED / REALTIME+CALIBRATION PENDING
M5 Assessments                           🟡 CONTRACTS CODED / ISOLATED RUNNER PENDING
package-lock.json                        🟡 GENERATED LOCALLY / COMMIT PENDING
T012 CI                                  ⏳ AFTER CANONICAL LOCKFILE
Production approval                      ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 is the active Node/npm decision.

The active local database baseline is PostgreSQL 17.11 per ADR-0003. PostgreSQL remains the primary system of record.

---

# 2. Validated workstation and database evidence

```text
Node.js       v25.9.0
npm           11.6.2
Git           2.53.0.windows.3
Registry      https://nexus3.dotin.ir/repository/Dotin-NPM/
psql          PostgreSQL 17.11
Database      interview
Database user interview
```

`npm run db:check` now succeeds and reports `current_database = interview` and `current_user = interview`.

The first real M1–M5 migration execution successfully applied the earlier foundation migrations and then stopped at `0008_m1_job_candidate_evidence.sql` with `syntax error at or near "current_role"`. The migration runner executes each migration inside a transaction and records its checksum only after success, so the failed `0008` did not leave a partial M1 migration or a false applied record.

The repository fix quotes the PostgreSQL-reserved `current_role` identifier consistently in the M1 schema and the affected recruiting/sourcing queries. A fresh `npm run db:migrate` is required to validate 0008–0013.

---

# 3. Bootstrap and API contract evidence

`npm run dev:bootstrap` succeeded and created/updated the local development organization, user, active membership and organization-admin role/permissions. The bootstrap emitted Node DEP0190 because Windows used `shell: true` for `psql`; the repository now invokes `psql` directly with `shell: false` and handles spawn errors explicitly.

`npm run api:sync` also completed successfully locally. The generated client then exposed a health-response typing regression: `/health` was inferred as `{}` in the local generated contract, causing `system-health-card.tsx` to fail on `service` and `timestamp`. The API now publishes an explicit OpenAPI object schema with required `status`, `service`, and `timestamp`; `api:sync` must be rerun before typecheck.

---

# 4. Latest M1–M5 JavaScript quality evidence

## Lint

```text
npm run lint -> 5/5 tasks successful
```

## Typecheck

The latest typecheck reached all major workspaces. API, DB, UI and API client passed; Web failed only on the generated `/health` response type used by `SystemHealthCard`. The source fix is pushed and requires a fresh `api:sync` plus typecheck.

## Tests

```text
tests  27
pass   27
fail   0
```

The expanded suite now covers the foundation plus M1–M5 safety/domain rules including:

- evidence-backed deterministic scoring;
- grounded candidate reply policy;
- deterministic hard-minimum screening and human review routing;
- interview structured-turn evidence objectives;
- DEV_ONLY real-candidate autonomy blocking and production approval checks;
- assessment score normalization;
- refusal to execute candidate code inside the core API;
- authorization, tenant isolation and storage boundaries.

## Build

The supplied workstation log ends immediately after `npm run build`; no result was captured. Build is therefore still validation-pending for the current M1–M5 HEAD.

---

# 5. M1–M5 implementation state

## M1 — Job → Candidate → Evidence

Coded baseline includes Job/Requirement/Rubric/RubricVersion/Candidate/Application/Evidence/CriterionEvaluation/Scorecard/Override persistence contracts and a deterministic evidence-backed score engine. Missing evidence prevents a consequential overall score.

## M2 — Sourcing + Talent

Coded baseline includes adapter-based sourcing contracts, internal-talent-first retrieval, sourcing runs, discovered candidates and separation of retrieval score from hiring score. External source adapters remain integration work and hidden/unapproved scraping is not part of the architecture.

## M3 — Outreach + Screening + Scheduling

Coded baseline includes approved-knowledge grounding, candidate conversation state, deterministic hard-minimum screening, human review boundaries and scheduling state. Generative judgment does not silently reject candidates.

## M4 — AI Interview

Coded baseline includes release units, lifecycle state, consent, interview plan/session/turn/transcript/evidence/evaluator/recording contracts, structured turn policy and Interviewer/Evaluator separation. The release state remains DEV_ONLY until production-readiness gates are evidenced. Realtime LiveKit/STT/TTS/avatar implementation is still pending.

## M5 — Assessments

Coded baseline includes assessment/session/submission/result/evidence contracts and an AssessmentRunner boundary. Candidate code is not permitted to execute inside the core NestJS API process. A real isolated runner remains pending.

---

# 6. Visual state

Executable screenshots have been reviewed for `/app`, `/app/jobs`, and `/app/candidates`. Directionality and enterprise shell hierarchy improved materially over the first review. The latest sidebar viewport fix and the newer M1–M5 surfaces still require fresh executable screenshots and quality validation.

---

# 7. Source of truth

- `master.md` — stable product/architecture contract.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active Node/npm decision.
- `docs/architecture-decisions/ADR-0003-postgresql-17-11-local-baseline.md` — active local PostgreSQL version decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — executable UI acceptance contract.

---

# 8. Next real engineering actions

1. Pull the migration/OpenAPI/bootstrap fixes.
2. Run `npm run db:check` and then `npm run db:migrate`; validate 0008–0013 successfully.
3. Rerun `npm run dev:bootstrap` to verify the warning-free direct `psql` invocation is idempotent.
4. Run `npm run api:sync` to regenerate the OpenAPI document and typed client from the explicit health schema.
5. Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` and fix any new failures.
6. Run the full stack and perform browser review of Job Workspace, Sourcing, Outreach, Candidate Intelligence, Interview Review, Candidate Consent and Assessment surfaces.
7. Commit the workstation-generated `package-lock.json`, regenerated `openapi/openapi.json`, and `packages/api-client/src/generated/schema.ts` only after the quality gate is green and the generated diffs are reviewed.
8. Implement T012 CI with Nexus connectivity and the canonical npm lockfile.

No M4 autonomous real-candidate mode is production-approved at this stage.
