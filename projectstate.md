# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced; PostgreSQL connectivity validated; latest API tests, production build and full-stack development runtime start validated on Windows; deep-workspace visual review 3 completed and fixes pushed  
> **Version:** 0.11.3  
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
Migration 0008                            ⚠️ COMPOSITE-FK FIX PUSHED / SUCCESSFUL RERUN RESULT NOT YET CAPTURED
Migrations 0009–0013                      ⏳ EXECUTION RESULT NOT YET CAPTURED
Migration 0014 M6 analytics/privacy       🟡 CODED / EXECUTION RESULT NOT YET CAPTURED
Migration contract validator              🟡 CODED / EXECUTION RESULT NOT YET CAPTURED
Development identity bootstrap             ✅ VALIDATED BEFORE LATEST DOMAIN SEED
M1–M5 deterministic domain seed           🟡 CODED / DB EXECUTION RESULT NOT YET CAPTURED
OpenAPI + typed client                    🟡 REGENERATION RESULT ON LATEST HEAD NOT YET CAPTURED
Last pre-wave lint                        ✅ 5/5 SUCCESS
Latest M1–M6 API tests                    ✅ 27/27 PASS
Latest HEAD typecheck                     ⏳ RESULT NOT INCLUDED IN LATEST LOG
Latest HEAD production build              ✅ SUCCESS
Latest Next.js static generation          ✅ 25/25 ROUTES
Full-stack development runtime            ✅ STARTED SUCCESSFULLY ON WORKSTATION
Executable browser review                 ✅ THREE PASSES COMPLETED
Deep M1–M6 desktop review                 ✅ 11 ROUTES REVIEWED
Visual fixes from review 3                ✅ PUSHED / FRESH SCREENSHOTS PENDING
Visual acceptance                         ⚠️ NOT YET COMPLETE — RESPONSIVE + RTL + PATCHED-HEAD RECHECK OPEN
M1 Job → Candidate → Evidence             🟡 DB-BACKED API BASELINE CODED / VISUAL RECHECK PENDING
M2 Sourcing + Talent                      🟡 PERSISTED API BASELINE CODED / VISUAL RECHECK PENDING
M3 Outreach + Screening + Scheduling      🟡 PERSISTED WORKFLOW BASELINE CODED / VISUAL RECHECK PENDING
M4 AI Interview                           🟡 DEV_ONLY GATED RUNTIME PRIMITIVES CODED / REALTIME+CALIBRATION PENDING
M5 Assessments                            🟡 SUBMISSION+ISOLATED-RUNNER INGEST CODED / REAL RUNNER PENDING
M6 Analytics + Enterprise hardening       🟡 ANALYTICS+PRIVACY+RETENTION BASELINE CODED / DB+VISUAL RECHECK PENDING
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

`npm run db:check` succeeds. The last captured migration failure was in 0008 because a tenant-safe foreign key referenced `rubric_criteria(organization_id,id)` before that composite key was unique. The repository adds the missing composite uniqueness in 0008. Because 0008 failed transactionally and was never checksum-recorded as applied, the correction does not alter an applied migration. A successful rerun of 0008–0014 has not yet been captured in supplied workstation logs.

The full development stack has been reported as started successfully on the workstation after the latest build/test cycle. This validates process startup, but it does not by itself close browser-flow, API-behavior or visual acceptance gates.

---

# 3. Ten-stage implementation advance

## Stage 1 — Migration contract validation

`scripts/check-migrations.mjs` validates migration sequencing and tenant composite-FK parent availability. Root `npm run db:validate` exposes the check, and `npm run check` includes it before the JavaScript gate.

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
npm run dev    -> full-stack development runtime started successfully
```

The latest supplied logs do not yet contain the output of `db:validate`, the successful rerun of `db:migrate` through 0014, `dev:bootstrap`, `api:sync`, lint or typecheck on the post-review-3 HEAD, so those remain evidence-pending rather than inferred.

---

# 5. Browser review 3

Executable desktop screenshots from the running application were reviewed for:

```text
/app/jobs/senior-backend-engineer
/app/jobs/senior-backend-engineer/sourcing
/app/jobs/senior-backend-engineer/outreach
/app/jobs/senior-backend-engineer/interviews
/app/jobs/senior-backend-engineer/scorecards
/app/candidates/ali-rahimi
/app/candidates/ali-rahimi/assessments
/app/interviews/ali-rahimi
/app/analytics
/app/settings
/candidate
```

The internal product surfaces now show coherent enterprise navigation, job/candidate/interview hierarchy, sourcing policy boundaries, evidence-first scoring, human review state, assessment isolation language and M6 governance anatomy.

Review 3 produced and immediately fixed three concrete defects:

- Fixture/customer-data ambiguity: the old `Fixture data · domain APIs replace this in M1` notice was stale and several deep pages had unlabeled deterministic metrics. The shared notice is now a small neutral `Development dataset · not production metrics` provenance badge and is applied to the reviewed fixture-backed deep surfaces.
- Interview review decision boundary: the visible AI next-round recommendation now explicitly states reviewer approval is required and that final advance/rejection/hiring decisions remain human-controlled.
- Candidate-facing width/hierarchy: an outer `max-w-3xl` layout was constraining the actual candidate page and adding a floating duplicate candidate brand. The clamp/duplicate heading were removed and the candidate flow now owns a wider responsive, sticky-progress consent layout.

A fresh screenshot pass on the patched HEAD is required before these pages can be marked visually accepted. Responsive behavior and explicit Persian/RTL review remain open.

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

Pull the review-3 fixes, rerun the same-HEAD quality gate and refresh screenshots for the patched candidate surface plus representative internal pages. Then perform responsive and Persian/RTL review.

The real workstation-generated `package-lock.json` must be committed only after the dependency/quality gate is green. T012 CI remains gated on that canonical lockfile and must use Node 25.9.x, npm 11.6.x, Dotin Nexus and `npm ci` without committed registry credentials.

No autonomous real-candidate interview mode is production-approved at this stage.
