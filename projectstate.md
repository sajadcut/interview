# AI Recruiter Platform — PROJECT STATE

> **Status:** M0 JavaScript foundation validated on Windows; M1–M5 architecture/code baseline implemented; PostgreSQL 17.11 installed and database authentication validation in progress  
> **Version:** 0.10.0  
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
Last validated lint                      ✅ SUCCESS
Last validated typecheck                 ✅ SUCCESS
Last validated API tests                 ✅ 16/16 PASS
Last validated production build          ✅ SUCCESS
Last validated Next.js generation        ✅ 20/20 STATIC PAGES
Executable browser review                ✅ TWO PASSES COMPLETED
Visual acceptance                        ⚠️ NOT YET COMPLETE
PostgreSQL 17.11 client                  ✅ INSTALLED / psql VERIFIED
PostgreSQL application authentication    ⚠️ IN PROGRESS — interview role password mismatch
Database migrations 0001–0013            ⏳ NOT YET EXECUTED SUCCESSFULLY ON WORKSTATION
M1 Job → Candidate → Evidence             🟡 CODED / DB+API+VISUAL VALIDATION PENDING
M2 Sourcing + Talent                     🟡 CODED / DB+API+VISUAL VALIDATION PENDING
M3 Outreach + Screening + Scheduling     🟡 CODED / DB+API+VISUAL VALIDATION PENDING
M4 AI Interview                          🟡 DEV_ONLY CONTRACTS CODED / REALTIME+CALIBRATION PENDING
M5 Assessments                           🟡 CONTRACTS CODED / ISOLATED RUNNER PENDING
package-lock.json                        🟡 GENERATED LOCALLY / COMMIT PENDING
T012 CI                                  ⏳ AFTER CANONICAL LOCKFILE
Production approval                      ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. ADR-0002 is the active Node/npm decision.

The active local database baseline is PostgreSQL 17.11 per ADR-0003. PostgreSQL remains the primary system of record. The previous 18.x local-version requirement is superseded only for the local development baseline; database architecture and migration policy are unchanged.

---

# 2. Validated workstation evidence

```text
Node.js     v25.9.0
npm         11.6.2
Git         2.53.0.windows.3
Registry    https://nexus3.dotin.ir/repository/Dotin-NPM/
psql        PostgreSQL 17.11
```

`npm run db:check` currently reaches the local PostgreSQL server but fails authentication for role `interview`. This proves the client, server address and port are reachable; the next database action is to align the local `interview` role password with the ignored `.env` `DATABASE_URL`, then rerun `npm run db:check`.

---

# 3. Last validated JavaScript quality gate

The workstation reported:

```text
npm run lint       -> 5/5 tasks successful
npm run typecheck  -> 5/5 tasks successful
npm run test       -> 16 tests, 16 pass, 0 fail
npm run build      -> API TypeScript build + Next.js production build successful
Next.js            -> 20/20 static pages generated
```

These results predate the latest M1–M5 implementation commits. The new HEAD must run lint/typecheck/test/build again before those gates are attributed to the M1–M5 code.

---

# 4. M1–M5 implementation state

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

# 5. Visual state

Executable screenshots have been reviewed for `/app`, `/app/jobs`, and `/app/candidates`. Directionality and enterprise shell hierarchy improved materially over the first review. The latest sidebar viewport fix and the newer M1–M5 surfaces still require fresh executable screenshots and quality validation.

---

# 6. Source of truth

- `master.md` — stable product/architecture contract.
- `docs/architecture-decisions/ADR-0002-node-25-npm-runtime.md` — active Node/npm decision.
- `docs/architecture-decisions/ADR-0003-postgresql-17-11-local-baseline.md` — active local PostgreSQL version decision.
- `projectstate.md` — actual execution status.
- `production-readiness.md` — autonomous interview release gates.
- `AGENTS.md` — implementation rules.
- `docs/visual-product-target.md` — executable UI acceptance contract.

---

# 7. Next real engineering actions

1. Align the local PostgreSQL `interview` role password with `.env` and make `npm run db:check` pass.
2. Run `npm run db:migrate` and validate migrations 0001–0013 on PostgreSQL 17.11.
3. Run `npm run dev:bootstrap` and capture the generated development organization/user identifiers.
4. Run `npm run api:sync` so the typed client reflects the current API.
5. Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` on the latest M1–M5 HEAD and fix any failures.
6. Run the full stack and perform browser review of Job Workspace, Sourcing, Outreach, Candidate Intelligence, Interview Review, Candidate Consent and Assessment surfaces.
7. Commit the workstation-generated `package-lock.json` only after the dependency/quality gate remains green.
8. Implement T012 CI with Nexus connectivity and the canonical npm lockfile.

No M4 autonomous real-candidate mode is production-approved at this stage.
