# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced. The deterministic M4 Interview Brain is browser-validated end-to-end for a synthetic internal candidate. The next five M4 realtime-media foundation stages are coded: provider-neutral contracts, persistence, health-probed self-hosted provider boundary, preflight/lifecycle API, and product readiness/launch gating. The actual LiveKit/VAD/STT/TTS/avatar realtime loop is **not yet implemented or validated**.  
> **Version:** 0.12.0  
> **Date:** 2026-09-01  
> **Repository:** https://github.com/sajadcut/interview  
> **Branch:** `main`

---

# 1. Current state

```text
Product architecture                       ✅ Defined in master.md
Core technical architecture                ✅ Defined
Interview architecture                     ✅ Defined
Production-readiness gates                 ✅ Defined
Laptop-first dev baseline                  ✅ Locked
Node.js 25.9 runtime baseline              ✅ VALIDATED ON WINDOWS
npm 11.6 workspaces                        ✅ VALIDATED ON WINDOWS
Dotin Nexus npm registry                    ✅ VERIFIED ON WORKSTATION
PostgreSQL 17.11 client/server              ✅ CONNECTIVITY + AUTH VALIDATED
Database                                   ✅ interview / role interview
API bind                                   ✅ 127.0.0.1:4100 VALIDATED
Root monorepo .env                          ✅ API + Web shared local source-of-truth
CORS config                                ✅ allowlist or * from CORS_ORIGIN
Same-origin Web→API proxy                  ✅ BROWSER/API VALIDATED
Migration runner                           ✅ TRANSACTIONAL / CHECKSUM-TRACKED
Migrations 0001–0007                       ✅ APPLIED ON WORKSTATION
Migrations 0008–0014                       ⚠️ DOMAIN TABLES ARE RUNTIME-USABLE; COMPLETE MIGRATION-RUN LOG STILL NOT CAPTURED
Migration 0015 realtime media              🟡 CODED / NOT YET APPLIED+VALIDATED ON WORKSTATION
Migration contract validator               🟡 CODED / LATEST EXECUTION PENDING
Development context                        ✅ /development/context READY=true VALIDATED
M1–M5 development fixtures                 ✅ SUFFICIENT FOR VALIDATED M4 INTERNAL BRAIN FLOW
OpenAPI + typed client                     🟡 REGENERATION REQUIRED AFTER NEW MEDIA ENDPOINTS
Last captured pre-Brain API suite           ✅ 27/27 PASS
Last captured pre-Brain production build    ✅ SUCCESS
Latest HEAD lint                            ⏳ PENDING
Latest HEAD typecheck                       ⏳ PENDING
Latest HEAD tests                           ⏳ PENDING
Latest HEAD build                           ⏳ PENDING
package-lock.json                           ✅ PRESENT IN REPOSITORY / LATEST QUALITY PROVENANCE PENDING
T012 CI                                     ⏳ QUALITY/PIPELINE FOLLOW-UP
Production approval                         ⬜ NOT APPROVED
```

The active JavaScript baseline remains `Node.js >=25.9.0 <26` with `npm >=11.6.2 <12`, npm workspaces, Turborepo and the required Dotin Nexus registry. PostgreSQL 17.11 remains the active local baseline per ADR-0003.

---

# 2. Validated workstation/browser evidence

Validated on the workstation during the current M4 debugging/functional pass:

```text
API health
GET http://127.0.0.1:4100/health
→ status=ok, service=interview-api

Development context
GET http://127.0.0.1:4100/development/context
→ ready=true with organization/user/application/plan/consent fixtures

Same-origin proxy
GET /api/backend/development/context
→ HTTP 200

Controlled Interview Brain browser flow
→ synthetic interview session created
→ first Brain turn persisted
→ interviewer transcript persisted
→ candidate answer persisted
→ human-marked synthetic evidence persisted
→ Backend engineering evidence coverage became 1
→ Brain transitioned to System design
→ session remained In progress
```

The internal harness screenshot and runtime logs therefore validate the deterministic Brain vertical slice through the real API/database path. This does **not** validate realtime speech/media.

Candidate device check was previously validated in Firefox. Chrome-specific camera-start recovery diagnostics remain implemented.

Port `4000` is occupied on the workstation by `TPVCGateway`; the Interview API local baseline is now explicit `127.0.0.1:4100` to avoid protocol/port collision.

---

# 3. M1–M6 product implementation baseline

## M1 — Job → Candidate → Evidence

- tenant-safe jobs, requirements, rubrics, versions and criteria;
- organization-global Candidate + job-specific Application model;
- candidate identity/experience/skills;
- evidence, criterion evaluation, scorecard and human override foundations;
- deterministic evidence-backed scoring where missing evidence remains incomplete rather than being fabricated;
- Candidate Intelligence Workspace and Job Workspace UI baselines.

## M2 — Sourcing + Talent

- source-adapter contract and internal talent pool adapter;
- sourcing runs, discovered candidates and merge-review persistence;
- internal talent first;
- retrieval/search score kept distinct from Match Score and Hiring Score;
- ambiguous dedupe remains reviewable rather than silently merged.

## M3 — Outreach + Screening + Scheduling

- approved recruiting knowledge and grounded candidate communication foundation;
- deterministic hard-minimum screening with human review;
- scheduling request/confirmation/reminder foundation;
- no silent generative rejection path.

## M4 — AI Interview

Validated core:

- consent/release units/plans/sessions/turns/transcript/evidence/evaluation/recording foundations;
- lifecycle stages `DEV_ONLY → INTERNAL_TEST → SHADOW → SUPERVISED_PILOT → CONTROLLED_PRODUCTION → SCALED_PRODUCTION`, plus `SUSPENDED`;
- deterministic `deterministic-state-machine-v1` Interview Brain;
- structured actions `ask`, `probe`, `clarify`, `transition`, `close`, `escalate`;
- explicit candidate intents including answer, clarification, skip, interruption, silence, reconnect, candidate factual question and policy refusal;
- evidence-driven criterion movement;
- time-budget closure;
- reconnect/clarification/silence do not manufacture evidence;
- skip/refusal leaves visible evidence gaps;
- factual candidate questions route away from unsupported interviewer improvisation;
- real-customer candidate execution remains blocked on the development Brain endpoint;
- internal browser harness is now validated through persisted session/turn/transcript/evidence state.

Realtime foundation newly coded in v0.12.0 is detailed in section 4.

## M5 — Assessments

- assessment sessions/submissions/results/evidence foundation;
- core API does not execute candidate code;
- isolated-runner abstraction and result-ingestion boundary;
- real isolated execution worker still pending.

## M6 — Analytics + Enterprise hardening

- analytics/privacy/retention/event foundations;
- RBAC/audit/tenant boundaries materially advanced;
- production hardening, full action wiring and production approval remain incomplete.

---

# 4. Five-stage M4 realtime-media foundation advance

These five stages are **CODED** on the latest HEAD. Unless explicitly marked otherwise, their latest workstation lint/typecheck/test/build/runtime validation is pending.

## Stage 1 — Provider-neutral realtime contracts

Added a vendor-neutral contract for:

```text
Modes:       audio | avatar
Components:  transport | vad | stt | tts | avatar
State:       configured + reachable + ready
```

Audio mode requires transport + VAD + STT + TTS. Avatar mode additionally requires avatar health.

A provider cannot be marked ready merely because a URL or credential is configured. Readiness requires health success.

Hard privacy invariants are explicit in the readiness model:

```text
candidateVideoAnalysis      = none
biometricInferenceAllowed   = false
rawMediaPersistedByApi      = false
spokenTextOnlyToAvatar      = true
```

Contract tests are coded but latest execution is pending.

## Stage 2 — Realtime media persistence

Migration `0015_m4_realtime_media.sql` adds:

### `interview_media_sessions`

Persists only provider-neutral lifecycle metadata:

- interview session reference;
- audio/avatar mode;
- lifecycle status;
- transport provider;
- opaque room reference;
- provider/version snapshot;
- readiness snapshot;
- recording lifecycle state;
- heartbeat/connected/ended/error metadata.

### `interview_media_events`

Ordered operational journal for:

- preflight/provider health;
- connecting/connected/disconnected/reconnected/degraded;
- VAD boundaries;
- finalized STT event marker;
- Brain turn marker;
- TTS/avatar lifecycle markers;
- heartbeat/end/error.

The media tables intentionally do not store provider credentials, room access tokens or raw audio/video. Candidate transcript and evidence remain in their dedicated domain tables.

Migration 0015 is not yet claimed as applied until workstation `db:migrate` is rerun successfully.

## Stage 3 — Self-hosted provider boundary + health probes

Environment/config boundary added for:

```text
MEDIA_REALTIME_ENABLED
MEDIA_PROVIDER_TIMEOUT_MS
MEDIA_TRANSPORT_PROVIDER=disabled|livekit
LIVEKIT_URL / LIVEKIT_HEALTH_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET
TURN_URLS
VAD_PROVIDER=disabled|silero-http
VAD_BASE_URL
STT_PROVIDER=disabled|whisper-http
STT_BASE_URL
TTS_PROVIDER=disabled|local-http
TTS_BASE_URL
AVATAR_PROVIDER=disabled|musetalk-http
AVATAR_BASE_URL
```

Realtime defaults to disabled.

Provider status is generated without returning credentials. Disabled providers are not probed. Configured providers become `ready` only after their health endpoint returns success. Non-2xx means reachable but not ready. Probe timeout is bounded.

No new npm dependency was introduced, preserving the Dotin Nexus/lockfile discipline.

Actual LiveKit, coturn, Silero, Whisper, TTS and MuseTalk processes are **not** installed or claimed operational by this stage.

## Stage 4 — Media preflight and lifecycle API

New tenant/RBAC/audited media API boundary:

```text
GET  /v1/interviews/media/readiness?mode=audio|avatar
POST /v1/interviews/:sessionId/media/preflight
POST /v1/interviews/:sessionId/media/sessions
GET  /v1/interviews/:sessionId/media/sessions/latest
POST /v1/interviews/:sessionId/media/sessions/:mediaSessionId/events
```

`readiness` exposes provider health without credentials.

`preflight` combines:

- interview session state;
- release lifecycle;
- stored real/synthetic candidate release mode;
- active server-side consent;
- transcript permission;
- requested audio/avatar mode;
- provider health/readiness.

A real-customer session cannot pass realtime preflight unless its stored release mode is supervised/autonomous according to the release policy.

Media-session creation fails if preflight fails. It creates only lifecycle metadata and an opaque room reference; it deliberately returns `connectionCredentialsIssued=false`. LiveKit room/token issuance is a separate runtime transport step and is not fabricated.

Operational event payloads recursively reject fields suggestive of raw audio/video/frame/blob/base64, transcript/text or credentials/tokens/secrets. Finalized transcript must continue through the transcript API rather than the operational event journal.

## Stage 5 — Product readiness and candidate launch gating

Internal engineering route `/app/interviews/internal-test` now includes a realtime readiness panel above the validated Brain harness. It:

- reads the actual API provider status;
- switches between audio and avatar requirements;
- shows configured/reachable/ready separately;
- shows launch blockers;
- surfaces the privacy invariants;
- does not represent an unconfigured provider as connected.

The candidate surface gains an explicit realtime launch gate explaining that device readiness is insufficient: candidate auth/session isolation, server-side consent, release policy and the healthy self-hosted media pipeline must all pass before live interview launch.

The actual candidate Start AI Interview path remains disabled. This is intentional and correct until the runtime connection slice exists and passes release validation.

---

# 5. Realtime architecture boundary

Target architecture remains:

```text
Candidate browser WebRTC
  ↓
LiveKit OSS + coturn
  ↓
Self-hosted VAD
  ↓
Self-hosted STT
  ↓
Finalized transcript persistence
  ↓
Interview Brain
  ↓
Validated structured turn
  ↓ only spokenText
Self-hosted TTS
  ↓
Optional AvatarProvider / MuseTalk-class renderer
  ↓
LiveKit audio/video
  ↓
Candidate browser
```

Ownership is strict:

```text
Interview Brain      owns interview strategy and next-turn decision
Media worker         owns streaming/transport/speech/rendering mechanics
Avatar               renders approved spoken text; never owns interview intelligence
Evaluator            consumes persisted finalized evidence; never scores live video frames
Core API             owns tenant/release/consent/audit/domain state
```

No candidate face/body/accent analysis may be introduced for honesty, personality, emotion, confidence or suitability.

---

# 6. Release posture

```text
DEV_ONLY               engineering only
INTERNAL_TEST          internal validation
SHADOW                 compare without autonomous candidate consequence
SUPERVISED_PILOT       trained human supervisor required
CONTROLLED_PRODUCTION  explicit production approval required
SCALED_PRODUCTION      expanded approved deployment
SUSPENDED              execution blocked
```

The deterministic development Brain still refuses real-customer candidate sessions. Realtime foundation code does not change that release posture.

Final hiring/rejection authority remains human-controlled.

---

# 7. What is validated vs merely coded

## VALIDATED

- Node/npm/PostgreSQL local baseline;
- DB connectivity/auth;
- API on `127.0.0.1:4100`;
- CORS wildcard/list configuration path;
- same-origin Next API proxy;
- `/health`;
- `/development/context` ready state;
- candidate device check in Firefox;
- synthetic interview session creation;
- deterministic Brain first/next turn persistence;
- transcript persistence through browser harness;
- manual synthetic evidence persistence;
- evidence coverage update and rubric-criterion transition.

## CODED, LATEST VALIDATION PENDING

- realtime media contracts/tests;
- migration 0015;
- self-hosted provider descriptors/health probes/tests;
- realtime readiness/preflight/media-session/event APIs;
- media lifecycle tests/DTO validation tests;
- internal realtime readiness UI;
- candidate realtime launch-gate copy;
- latest OpenAPI/client regeneration;
- latest full lint/typecheck/test/build.

## NOT IMPLEMENTED / NOT CLAIMED CONNECTED

- running LiveKit OSS deployment in this repo slice;
- coturn runtime;
- browser LiveKit SDK connection;
- provider room/token issuance;
- media-worker executable process;
- streaming VAD adapter;
- streaming STT adapter;
- streaming TTS adapter;
- avatar runtime integration;
- live reconnect/checkpoint integration;
- recording runtime;
- real candidate authentication/session isolation sufficient for realtime launch;
- production calibration/approval.

---

# 8. Required latest validation sequence

From the repository root:

```powershell
cd D:\interview\interview
git pull
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

Then inspect:

```text
http://localhost:3000/app/interviews/internal-test
```

Expected default realtime state with `.env.example` semantics is **Launch blocked**, because realtime and all providers default to disabled. That is a successful safety behavior, not an error.

The deterministic Brain harness below the readiness panel must continue working after migration 0015.

Provider activation should be incremental. Configure and health-check each self-hosted provider; do not set the candidate surface live merely because environment values exist.

---

# 9. Next runtime implementation slice after validation

Once the latest quality gate and migration are green, continue in this order:

1. LiveKit OSS + coturn deployment/runbook and health integration.
2. Secure room/token issuance scoped to one interview/candidate session.
3. Browser transport connection with reconnect/checkpoint handling.
4. Media-worker VAD + STT streaming path producing finalized transcript only.
5. Brain transport adapter → TTS streaming response.
6. Optional licensed/disclosed avatar rendering from `spokenText` only.
7. Recording path only under explicit consent/policy.
8. latency/failure injection, Persian/code-switching, interruption and reconnect validation.
9. INTERNAL_TEST and SHADOW calibration before supervised real-candidate pilot consideration.

No autonomous real-candidate interview mode is production-approved at this stage.
