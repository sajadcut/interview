# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced; PostgreSQL connectivity validated; latest captured API tests/build/runtime are green; candidate device check validated in Firefox; M4 now includes a persisted deterministic Interview Brain and internal engineering harness while realtime speech/media remains intentionally unimplemented  
> **Version:** 0.11.6  
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
OpenAPI + typed client                    🟡 REGENERATION REQUIRED AFTER NEW M4 ENDPOINT
Last captured API tests                   ✅ 27/27 PASS — PRE-BRAIN HEAD
Last captured production build            ✅ SUCCESS — PRE-BRAIN HEAD
Last captured Next.js static generation   ✅ 25/25 ROUTES — PRE-BRAIN HEAD
Full-stack development runtime            ✅ STARTED SUCCESSFULLY ON WORKSTATION
Executable browser review                 ✅ FOUR PASSES COMPLETED
Deep M1–M6 desktop review                 ✅ 11 ROUTES REVIEWED
Patched desktop representative recheck    ✅ 3 ROUTES PASSED
Responsive source audit                   ✅ COMPLETED / MOBILE NAV FIX PUSHED
RTL source audit                          ✅ COMPLETED / CANDIDATE DIRECTION FIX PUSHED
UI functionalization pass                 🟡 PRIMARY ACTIONS WIRED / LATEST HEAD VALIDATION PENDING
Fake interview media                      ✅ REMOVED FROM REVIEW SURFACE
Interview recording player boundary       ✅ REAL <video> WHEN URL EXISTS / NO FAKE VIDEO OTHERWISE
Candidate consent interaction             ✅ BROWSER-INTERACTIVE
Candidate device check                    ✅ FIREFOX WORKSTATION VALIDATED
Chrome camera recovery diagnostics        ✅ IMPLEMENTED
Controlled Interview Brain                🟡 DETERMINISTIC STATE MACHINE CODED / WORKSTATION VALIDATION PENDING
Interview Brain persistence               🟡 SESSION + TURN + TRANSCRIPT + MANUAL EVIDENCE HARNESS CODED
Internal Interview Brain harness          🟡 /app/interviews/internal-test CODED / WORKSTATION VALIDATION PENDING
Real-customer Brain execution             ✅ BLOCKED FROM DEVELOPMENT BRAIN ENDPOINT
Realtime AI interview media loop          ⏳ NOT IMPLEMENTED
LiveKit / coturn / VAD / STT / TTS/avatar ⏳ NOT IMPLEMENTED
Latest M4 Brain HEAD lint                  ⏳ PENDING
Latest M4 Brain HEAD typecheck             ⏳ PENDING
Latest M4 Brain HEAD tests                 ⏳ PENDING
Latest M4 Brain HEAD build                 ⏳ PENDING
Visual/functional acceptance              ⚠️ NOT YET COMPLETE — SAME-HEAD BRAIN HARNESS + QUALITY RECHECK OPEN
M1 Job → Candidate → Evidence             🟡 DB-BACKED API BASELINE CODED / FUNCTIONAL WIRING CONTINUES
M2 Sourcing + Talent                      🟡 PERSISTED API BASELINE CODED / API-TO-UI EXECUTION WIRING PENDING
M3 Outreach + Screening + Scheduling      🟡 PERSISTED WORKFLOW BASELINE CODED / WRITE-ACTION UI WIRING PENDING
M4 AI Interview                           🟡 CONTROLLED BRAIN + CONSENT/DEVICE + PERSISTENCE CODED / REALTIME+CALIBRATION PENDING
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
Candidate camera/microphone device check  Firefox validated
```

`npm run db:check` succeeds. The last captured migration failure was in 0008 because a tenant-safe foreign key referenced `rubric_criteria(organization_id,id)` before that composite key was unique. The repository adds the missing composite uniqueness in 0008. Because 0008 failed transactionally and was never checksum-recorded as applied, the correction does not alter an applied migration. A successful rerun of 0008–0014 has not yet been captured in supplied workstation logs.

The full development stack has been reported as started successfully on the workstation. Candidate consent/device behavior was then exercised; Firefox successfully opened the camera/microphone path. Chrome previously returned `Could not start video source`, so the device check now probes camera and microphone independently and provides browser/device-specific recovery guidance rather than treating a camera failure as a microphone failure.

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

Interview-session creation validates published plan/application compatibility, active consent, transcript permission and release-unit policy. Structured turns, transcript segments and evidence persist behind tenant/RBAC/audit boundaries.

M4 now also contains `deterministic-state-machine-v1`, a controlled Interview Brain that:

- selects uncovered rubric criteria rather than unconstrained chat topics;
- emits only validated structured turns;
- requires expected evidence for ask/probe actions;
- respects clarification, interruption, silence, skip, refusal and reconnect intents;
- routes candidate factual questions away from model improvisation and toward approved knowledge;
- never converts silence/skip/refusal into positive evidence;
- closes on evidence completion or time-budget exhaustion;
- stores question IDs, reason, evidence coverage and Brain version in session checkpoint state;
- refuses real-customer candidate sessions on the development Brain endpoint.

`/app/interviews/internal-test` is an internal engineering harness that resolves the local development tenant/user, creates a synthetic session through the real API, persists Brain turns/transcript segments and allows the human tester to explicitly mark a synthetic answer as evidence. This is not a substitute for realtime speech/media and is never represented as a production candidate interview.

## Stage 9 — M5 assessment boundary

Assessment submissions persist without execution in the core API. Result ingestion rejects core-process runner identities and accepts only isolated-runner results; deterministic score normalization is retained.

## Stage 10 — M6 analytics and enterprise governance

Migration 0014 adds recruitment-event, retention-policy and privacy-request foundations. Analytics APIs expose funnel/source/review context while distinguishing operational/pre-interview signals from hiring scorecards. Privacy APIs support retention-policy management and reviewed access/deletion/consent-withdrawal requests without silently destroying candidate data.

---

# 4. JavaScript validation evidence

The latest captured workstation execution before the responsive/functionalization/M4-Brain patches validates:

```text
npm run test   -> 27 tests, 27 pass, 0 fail
npm run build  -> API TypeScript build successful
npm run build  -> Next.js 16.3.3 production build successful
Next.js        -> 25/25 static routes generated
npm run dev    -> full-stack development runtime started successfully
```

The Brain state-machine spec adds seven new deterministic tests, but they are **not** recorded as passing until the workstation reruns the suite. The new internal harness also adds a Next.js route, so the previous 25-route production-build evidence must not be attributed to the current HEAD.

---

# 5. Functionalization + M4 Brain pass

The product no longer treats polished appearance as equivalent to implemented behavior.

Implemented now:

- shared `ToolbarButton` supports real navigation targets and explicit disabled states;
- Job Workspace `Find Candidates` navigates to Sourcing;
- Candidate Workspace review/add-to-job navigation is wired where a real destination exists;
- Sourcing evidence review navigates to candidate workspaces, while sourcing execution is explicit about missing write wiring;
- Outreach thread/grounding navigation is wired; sequence creation remains explicit pending behavior;
- Interview plan links to scorecards and now routes `Run controlled internal test` to a persisted Brain harness rather than the candidate consent page;
- Scorecard review routes to interview evidence;
- Assessment review routes into scorecard review;
- global search, global Ask AI, notification center, share/more actions that are not implemented do not pretend to be functional;
- Interview Review renders a real HTML `<video>` player only when a recording URL exists; otherwise it shows an explicit no-recording state;
- Candidate consent is browser-interactive and gates progression;
- Candidate device check uses `navigator.mediaDevices.getUserMedia` for local camera/microphone preview without upload/persistence and now diagnoses the two devices independently;
- the candidate flow reaches Introduction, then explicitly blocks `Start AI interview` until realtime M4 speech/media is connected;
- the controlled Brain endpoint persists state-machine turns through real interview tables and is audited;
- the internal Brain harness persists transcript and human-marked synthetic evidence through the same domain APIs.

This pass intentionally does **not** fake realtime media, STT, TTS, avatar, evaluator calibration or production interview approval.

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

Candidate camera/microphone behavior has now also been validated successfully in Firefox. The new `/app/interviews/internal-test` route still requires executable workstation review on the current HEAD.

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
The development Interview Brain refuses real-customer candidate sessions.
Real-candidate interview autonomy remains release-gated.
Skip/refusal/silence never manufacture positive interview evidence.
Candidate code never executes in the core API.
Assessment integrity signals remain review aids.
Unsupported face/body/accent personality/emotion/honesty/suitability inference remains prohibited.
Privacy/retention actions remain reviewable and auditable.
```

---

# 8. Next validation sequence

Pull the M4 Brain pass and run:

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

Then open `/app/jobs/senior-backend-engineer/interviews` and select **Run controlled internal test**. Start a synthetic session, submit answers/intents, and verify that persisted evidence causes the Brain to transition between rubric criteria. Real candidate `Start AI interview` remains disabled until the next M4 step connects the realtime media pipeline.

The next M4 engineering slice is the self-hosted realtime boundary: media-worker foundation → LiveKit OSS/coturn transport → VAD/STT → controlled Brain transport adapter → TTS → AvatarProvider → checkpoint/reconnect integration. Production autonomy remains blocked throughout engineering validation.

The real workstation-generated `package-lock.json` must be committed only after the dependency/quality gate is green. T012 CI remains gated on that canonical lockfile and must use Node 25.9.x, npm 11.6.x, Dotin Nexus and `npm ci` without committed registry credentials.

No autonomous real-candidate interview mode is production-approved at this stage.
