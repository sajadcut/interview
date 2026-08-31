# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced; PostgreSQL connectivity validated; latest API tests, production build and full-stack development runtime start validated on Windows; functionalization pass now wires primary navigation actions, makes unsupported controls explicit, and replaces fake interview media with a real media boundary  
> **Version:** 0.11.5  
> **Date:** 2026-09-01  
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
Development identity bootstrap            ✅ VALIDATED BEFORE LATEST DOMAIN SEED
M1–M5 deterministic domain seed           🟡 CODED / DB EXECUTION RESULT NOT YET CAPTURED
OpenAPI + typed client                    🟡 REGENERATION RESULT ON LATEST HEAD NOT YET CAPTURED
Last captured API tests                   ✅ 27/27 PASS
Last captured production build            ✅ SUCCESS
Last captured Next.js static generation   ✅ 25/25 ROUTES
Full-stack development runtime            ✅ STARTED SUCCESSFULLY ON WORKSTATION
Executable browser review                 ✅ FOUR PASSES COMPLETED
Deep M1–M6 desktop review                 ✅ 11 ROUTES REVIEWED
Patched desktop representative recheck    ✅ 3 ROUTES PASSED
Responsive source audit                   ✅ COMPLETED / MOBILE NAV FIX PUSHED
RTL source audit                          ✅ COMPLETED / CANDIDATE DIRECTION FIX PUSHED
UI functionalization pass                 🟡 PRIMARY ACTIONS WIRED / LATEST HEAD VALIDATION PENDING
Fake interview media                      ✅ REMOVED FROM REVIEW SURFACE
Interview recording player boundary       ✅ REAL <video> WHEN URL EXISTS / NO FAKE VIDEO OTHERWISE
Candidate consent interaction             🟡 BROWSER-INTERACTIVE / SERVER PERSISTENCE PENDING
Candidate device check                    🟡 getUserMedia PREVIEW CODED / WORKSTATION VALIDATION PENDING
Realtime AI interview media loop          ⏳ NOT IMPLEMENTED
Latest functionalization HEAD lint        ⏳ PENDING
Latest functionalization HEAD typecheck   ⏳ PENDING
Latest functionalization HEAD build       ⏳ PENDING
Visual acceptance                         ⚠️ NOT YET COMPLETE — SAME-HEAD FUNCTIONAL/QUALITY RECHECK OPEN
M1 Job → Candidate → Evidence             🟡 DB-BACKED API BASELINE CODED / FUNCTIONAL WIRING CONTINUES
M2 Sourcing + Talent                      🟡 PERSISTED API BASELINE CODED / API-TO-UI EXECUTION WIRING PENDING
M3 Outreach + Screening + Scheduling      🟡 PERSISTED WORKFLOW BASELINE CODED / WRITE-ACTION UI WIRING PENDING
M4 AI Interview                           🟡 DEV_ONLY DOMAIN + CONSENT/DEVICE UX / REALTIME+CALIBRATION PENDING
M5 Assessments                            🟡 SUBMISSION+ISOLATED-RUNNER INGEST CODED / REAL RUNNER PENDING
M6 Analytics + Enterprise hardening       🟡 ANALYTICS+PRIVACY+RETENTION BASELINE CODED / DB+ACTION WIRING PENDING
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

The full development stack has been reported as started successfully on the workstation. This validates process startup, but it does not by itself close database-migration, API-behavior or final functional acceptance gates.

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

# 4. JavaScript validation evidence

The latest captured workstation execution before the responsive/functionalization patches validates:

```text
npm run test   -> 27 tests, 27 pass, 0 fail
npm run build  -> API TypeScript build successful
npm run build  -> Next.js 16.3.3 production build successful
Next.js        -> 25/25 static routes generated
npm run dev    -> full-stack development runtime started successfully
```

Because responsive/RTL and functionalization commits modify web source after that gate, lint/typecheck/build must be rerun before the newer HEAD is marked green.

---

# 5. Functionalization pass

The latest UI pass explicitly addresses the gap between polished screens and actual behavior.

Implemented now:

- shared `ToolbarButton` supports real navigation targets and explicit disabled states;
- Job Workspace `Find Candidates` navigates to Sourcing;
- Candidate Workspace review/add-to-job navigation is wired where a real destination exists;
- Sourcing evidence review navigates to candidate workspaces, while sourcing execution is explicitly disabled until authenticated API-to-UI wiring is implemented;
- Outreach thread/grounding navigation is wired; sequence creation remains explicit pending behavior;
- Interview plan links to scorecards and the candidate internal test surface;
- Scorecard review routes to interview evidence;
- Assessment review routes into scorecard review;
- global search, global Ask AI, notification center, share/more actions that are not implemented no longer pretend to be functional;
- Interview Review no longer displays a decorative digital-human image as if it were video. A real HTML `<video>` player is rendered only when a recording URL exists; otherwise an explicit no-recording state is shown;
- Candidate consent is browser-interactive and gates progression;
- Candidate device check uses `navigator.mediaDevices.getUserMedia` for local camera/microphone preview without upload/persistence;
- the candidate flow reaches Introduction, then explicitly blocks `Start AI interview` until the realtime M4 media/brain runtime is connected.

This pass intentionally does **not** fake backend writes or interview media. Unsupported actions are disabled and labeled rather than silently no-op.

---

# 6. Browser review state

Deep desktop review covered:

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

Review 3 fixed fixture/customer-data provenance, interview recommendation decision-boundary visibility and candidate-surface width/hierarchy. Review 4 rechecked representative patched desktop routes successfully.

The new functionalization pass requires a fresh same-HEAD workstation validation, especially the browser media permission flow and the updated navigation/disabled states.

---

# 7. Safety boundaries preserved

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

# 8. Next validation sequence

Pull the functionalization pass and run:

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
npm run dev
```

Then validate the candidate consent/device flow on localhost and the primary navigation actions. After that, the next engineering priority is real API-to-UI mutation wiring for M1–M3 and the M4 realtime media/Interview Brain loop.

The real workstation-generated `package-lock.json` must be committed only after the dependency/quality gate is green. T012 CI remains gated on that canonical lockfile and must use Node 25.9.x, npm 11.6.x, Dotin Nexus and `npm ci` without committed registry credentials.

No autonomous real-candidate interview mode is production-approved at this stage.
