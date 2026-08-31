# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced; PostgreSQL connectivity validated; latest API tests and production build validated on Windows; DB/runtime/browser validation continues  
> **Version:** 0.11.1  
> **Date:** 2026-08-31  
> **Repository:** https://github.com/sajadcut/interview  
> **Branch:** `main`

---

# 1. Current state

```text
Product architecture                     ✅ Defined in master.md
Core technical architecture              ✅ Defined
Interview architecture                   ✅ Defined
Production-readiness gates               ✅ Defined
Laptop-first dev baseline                ✅ Locked
Node.js 25.9 runtime baseline             ✅ VALIDATED ON WINDOWS
npm 11.6 workspaces                       ✅ VALIDATED ON WINDOWS
Dotin Nexus npm registry                  ✅ VERIFIED ON WORKSTATION
PostgreSQL 17.11 client/server            ✅ CONNECTIVITY + AUTH VALIDATED
Database                                 ✅ interview / role interview
Migration runner                          ✅ TRANSACTIONAL / CHECKSUM-TRACKED
Migrations 0001–0007                      ✅ APPLIED ON WORKSTATION
Migration 0008                            ⚠️ COMPOSITE-FK FIX PUSHED / RERUN RESULT NOT YET CAPTURED
Migrations 0009–0013                      ⏳ EXECUTION RESULT NOT YET CAPTURED
Migration 0014 M6 analytics/privacy       🟡 CODED / EXECUTION RESULT NOT YET CAPTURED
Migration contract validator              🟡 CODED / EXECUTION RESULT NOT YET CAPTURED
Development identity bootstrap             ✅ VALIDATED BEFORE LATEST DOMAIN SEED
M1–M5 deterministic domain seed           🟡 CODED / DB EXECUTION RESULT NOT YET CAPTURED
OpenAPI + typed client                    🟡 REGENERATION RESULT ON LATEST HEAD NOT YET CAPTURED
Latest pre-wave lint                      ✅ 5/5 SUCCESS
Latest M1–M6 API tests                    ✅ 27/27 PASS
Latest HEAD typecheck                     ⏳ RESULT NOT INCLUDED IN LATEST LOG
Latest HEAD production build              ✅ SUCCESS
Latest Next.js static generation          ✅ 25/25 ROUTES
Executable browser review                 ✅ TWO PASSES COMPLETED
Visual acceptance                         ⚠️ NOT YET COMPLETE
M1 Job → Candidate → Evidence             🟡 DB-BACKED API BASELINE CODED / RUNTIME+VISUAL VALIDATION PENDING
M2 Sourcing + Talent                      🟡 PERSISTED API BASELINE CODED / RUNTIME+VISUAL VALIDATION PENDING
M3 Outreach + Screening + Scheduling      🟡 PERSISTED WORKFLOW BASELINE CODED / RUNTIME+VISUAL VALIDATION PENDING
M4 AI Interview                           🟡 DEV_ONLY GATED RUNTIME PRIMITIVES CODED / REALTIME+CALIBRATION PENDING
M5 Assessments                            🟡 SUBMISSION+ISOLATED-RUNNER INGEST CODED / REAL RUNNER PENDING
M6 Analytics + Enterprise hardening       🟡 ANALYTICS+PRIVACY+RETENTION BASELINE CODED / DB+RUNTIME+VISUAL VALIDATION PENDING
package-lock.json                         🟡 REAL WORKSTATION LOCKFILE COMMIT PENDING
T012 CI                                   ⏳ AFTER CANONICAL LOCKFILE
Production approval                       ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo, and the required Dotin Nexus registry. PostgreSQL 17.11 is the active local database baseline per ADR-0003.

---

# 2. Validated workstation evidence

```text
Node.js       v25.9.0
npm           11.6.2
Git           2.53.0.windows.3
Registry      https://nexus3.dotin.ir/repository/Dotin-NPM/
psql          PostgreSQL 17.11
Database      interview
Database user interview
```

`npm run db:check` succeeds. The last captured migration failure was in 0008 because a tenant-safe foreign key referenced `rubric_criteria(organization_id,id)` before that composite key was unique. The repository now adds the missing composite uniqueness in 0008. Because 0008 failed transactionally and was never checksum-recorded as applied, the correction does not alter an applied migration. A successful rerun of 0008–0014 has not yet been captured in the supplied workstation logs.

---

# 3. Ten-stage implementation advance

## Stage 1 — Migration contract validation

`scripts/check-migrations.mjs` validates migration sequencing and tenant composite-FK parent availability. Root `npm run db:validate` exposes the check, and `npm run check` now includes it before the JavaScript gate.

## Stage 2 — Deterministic development domain seed

Development bootstrap provides idempotent M1–M5 development data after domain migrations exist. `dev:bootstrap` continues to bootstrap organization/user/RBAC and conditionally seeds domain fixtures only when required tables are present.

## Stage 3 — M1 DB-backed recruiting workspaces

The API exposes tenant/RBAC-protected DB-backed job and candidate workspace reads including job list, job requirements/rubric/pipeline, organization candidate list, job-scoped candidate list, candidate skills/job applications, and the evidence-backed application intelligence path.

## Stage 4 — M2 sourcing and talent persistence

The API exposes internal talent, sourcing-run history and sourcing-run detail. Internal talent remains the first adapter. Retrieval score is explicitly labeled as a search signal and remains separate from pre-interview match and evidence-backed hiring scores.

## Stage 5 — M3 grounded outreach persistence

Outbound candidate messages validate supplied knowledge references against approved/current knowledge before persistence. Auto-send remains policy-gated; otherwise the message is persisted for human approval.

## Stage 6 — M3 deterministic screening persistence

Hard-minimum rules remain deterministic. Persisted screening sessions always route consequential outcomes to human review; failed hard minimums do not create silent generative rejection.

## Stage 7 — M3 scheduling lifecycle

Scheduling requests can be created, listed and confirmed with timezone/slot state. Confirmation validates ordered ISO timestamps and remains provider-independent for later calendar adapters.

## Stage 8 — M4 controlled interview runtime

Interview-session creation validates published plan/application compatibility, active consent, transcript permission and release-unit policy. Structured turns, transcript segments and evidence can be persisted behind tenant/RBAC/audit boundaries. DEV_ONLY continues to block autonomous real-candidate interviewing.

## Stage 9 — M5 assessment boundary

Assessment submissions persist without execution in the core API. Result ingestion rejects core-process runner identities and accepts only isolated-runner results; deterministic score normalization is retained.

## Stage 10 — M6 analytics and enterprise governance

Migration 0014 adds recruitment-event, retention-policy and privacy-request foundations. Analytics APIs expose funnel/source/review context while distinguishing operational/pre-interview signals from hiring scorecards. Privacy APIs support retention-policy management and reviewed access/deletion/consent-withdrawal requests without silently destroying candidate data.

---

# 4. Latest M1–M6 JavaScript validation

The latest supplied workstation execution validates:

```text
npm run test   -> 27 tests, 27 pass, 0 fail
npm run build  -> API TypeScript build successful
npm run build  -> Next.js 16.3.3 production build successful
Next.js        -> 25/25 static routes generated
```

The generated route set includes the added M1–M6 product surfaces for sourcing, outreach, interviews, scorecards, candidate assessments, analytics, settings and the candidate-facing flow.

The latest supplied log does not include the output of `db:validate`, `db:migrate`, `dev:bootstrap`, `api:sync`, lint or typecheck on this exact HEAD, so those are not marked newly validated here.

---

# 5. Frontend state

The enterprise visual target now spans 15 surfaces. `/app/analytics` and `/app/settings` are no longer generic placeholders and contain recruiting analytics, AI governance, RBAC, retention, privacy-request and release-unit anatomy.

These and the previously implemented M1–M5 surfaces remain **coded, not visually accepted** until executable browser screenshots are reviewed on a green validated HEAD.

---

# 6. Safety boundaries preserved

```text
Candidate remains organization-global; Application remains job-specific.
Evidence precedes consequential score/recommendation.
Final weighted score is deterministic domain code.
Generative judgment cannot silently final-reject a candidate.
Retrieval/vector-like signals are not hiring scores.
External sourcing remains approved-adapter based; hidden scraping is not introduced.
Candidate-facing facts require approved grounding.
AI Interviewer and Evaluator remain logically separate.
Real-candidate interview autonomy remains release-gated.
Candidate code never executes in the core API.
Assessment integrity signals remain review aids.
Unsupported face/body/accent personality/emotion/honesty/suitability inference remains prohibited.
Privacy/retention actions remain reviewable and auditable.
```

---

# 7. Next validation sequence

```powershell
npm run db:validate
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
npm run lint
npm run typecheck
npm run test
npm run build
npm run dev
```

After the remaining gate is green, review executable browser surfaces including Job Workspace, Sourcing, Outreach, Candidate Intelligence, Interview Review, Assessments, Analytics, Settings and the candidate consent/readiness flow.

The real workstation-generated `package-lock.json` must be committed only after the dependency/quality gate is green. T012 CI remains gated on that canonical lockfile and must use Node 25.9.x, npm 11.6.x, Dotin Nexus and `npm ci` without committed registry credentials.

No autonomous real-candidate interview mode is production-approved at this stage.
