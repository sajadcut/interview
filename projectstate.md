# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced. The deterministic M4 Interview Brain is browser-validated end-to-end for a synthetic internal candidate. Five additional M4 realtime-media foundation stages are now coded: provider-neutral contracts, persistence, health-probed self-hosted provider boundary, preflight/lifecycle API, and product readiness/launch gating. The actual LiveKit/VAD/STT/TTS/avatar realtime loop is **not yet implemented or validated**.  
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
Migrations 0008–0011 M1–M4 core            ✅ REQUIRED TABLES ARE RUNTIME-USED; COMPLETE SUCCESS LOG NOT CAPTURED
Migrations 0012–0014                       🟡 CODED / COMPLETE EXECUTION LOG NOT CAPTURED
Migration 0015 realtime media              🟡 CODED / NOT YET APPLIED+VALIDATED ON WORKSTATION
Migration contract validator               🟡 CODED / LATEST EXECUTION PENDING
Development context                        ✅ /development/context READY=true VALIDATED
M4 development fixtures                    ✅ SUFFICIENT FOR VALIDATED INTERNAL BRAIN FLOW
OpenAPI + typed client                     🟡 REGENERATION REQUIRED AFTER NEW MEDIA ENDPOINTS
Last captured pre-Brain API suite           ✅ 27/27 PASS
Last captured pre-Brain production build    ✅ SUCCESS
Latest HEAD lint                            ⏳ PENDING
Latest HEAD typecheck                       ⏳ PENDING
Latest HEAD tests                           ⏳ PENDING
Latest HEAD build                           ⏳ PENDING
package-lock.json                           ✅ PRESENT / LATEST QUALITY PROVENANCE PENDING
Production approval                         ⬜ NOT APPROVED
```

Active JavaScript baseline: `Node.js >=25.9.0 <26`, `npm >=11.6.2 <12`, npm workspaces, Turborepo, mandatory Dotin Nexus. PostgreSQL 17.11 remains the local database baseline per ADR-0003.

---

# 2. Current validated evidence

```text
GET http://127.0.0.1:4100/health
→ status=ok, service=interview-api

GET http://127.0.0.1:4100/development/context
→ ready=true with development organization/user/application/plan/consent fixtures

GET /api/backend/development/context
→ HTTP 200 through the Next same-origin proxy

Controlled Interview Brain browser flow
→ synthetic interview session created
→ Brain interviewer turn persisted
→ interviewer transcript persisted
→ candidate answer persisted
→ human-marked synthetic evidence persisted
→ Backend engineering evidence coverage = 1
→ Brain transitioned to System design
→ session remained In progress
```

This validates the deterministic Brain vertical slice through browser → Next proxy → API → PostgreSQL. It does **not** validate realtime speech/media.

Candidate camera/microphone device check was previously validated in Firefox. Port `4000` is occupied by workstation process `TPVCGateway`, so the Interview API local baseline is explicit `127.0.0.1:4100`.

---

# 3. M1–M6 implementation baseline

## M1 — Job → Candidate → Evidence

Tenant-safe jobs/requirements/rubrics/candidates/applications/evidence/scorecards are implemented as the foundational vertical slice. Candidate remains organization-global; Application remains job-specific. Missing evidence remains incomplete rather than being fabricated.

## M2 — Sourcing + Talent

Internal-talent-first adapter architecture, sourcing runs, discovered candidates and merge review are persisted. Retrieval signals remain separate from pre-interview Match Score and evidence-backed Hiring Score. External sourcing remains lawful/approved-adapter based.

## M3 — Outreach + Screening + Scheduling

Approved-knowledge grounding, persisted candidate communications, deterministic hard-minimum screening with human review, and provider-neutral scheduling lifecycle are present. Generative output cannot silently reject candidates.

## M4 — AI Interview

Core foundations:

- consent, release units, plans, sessions, turns, transcript, evidence, evaluation and recording boundaries;
- lifecycle `DEV_ONLY → INTERNAL_TEST → SHADOW → SUPERVISED_PILOT → CONTROLLED_PRODUCTION → SCALED_PRODUCTION`, plus `SUSPENDED`;
- deterministic `deterministic-state-machine-v1` Brain;
- structured actions `ask`, `probe`, `clarify`, `transition`, `close`, `escalate`;
- explicit candidate intents including answer, clarification, skip, interruption, silence, reconnect, candidate question and policy refusal;
- evidence-driven criterion transition and time-budget closure;
- skip/refusal/silence/reconnect never manufacture positive evidence;
- candidate factual questions route away from unsupported interviewer improvisation;
- development Brain refuses real-customer candidate sessions;
- persisted internal browser harness is now runtime validated.

Realtime foundation is coded as described in section 4, but the actual media loop remains pending.

## M5 — Assessments

Assessment persistence and isolated-runner boundary exist. Candidate code is not executed inside the core API. A real isolated execution worker remains pending.

## M6 — Analytics + Enterprise hardening

Analytics/privacy/retention/event foundations, RBAC, audit and tenant boundaries are materially advanced. Full production hardening/action wiring remains incomplete.

---

# 4. Five-stage realtime-media foundation advance

The following stages are **CODED** on current `main`; their latest workstation quality/runtime validation is still pending.

## Stage 1 — Provider-neutral contracts

Modes:

```text
audio
avatar
```

Components:

```text
transport
vad
stt
tts
avatar
```

Audio requires transport + VAD + STT + TTS. Avatar mode additionally requires avatar health. `configured`, `reachable` and `ready` are distinct states.

Hard privacy invariants:

```text
candidateVideoAnalysis      = none
biometricInferenceAllowed   = false
rawMediaPersistedByApi      = false
spokenTextOnlyToAvatar      = true
```

## Stage 2 — Realtime persistence

Migration `0015_m4_realtime_media.sql` adds:

- `interview_media_sessions`: provider-neutral mode/status/provider/room-reference/version/readiness/recording/heartbeat lifecycle metadata;
- `interview_media_events`: ordered operational journal for transport/VAD/STT/Brain/TTS/avatar lifecycle markers.

The media tables do not store provider credentials, room access tokens or raw media. Transcript/evidence remain dedicated domain records.

Migration 0015 is not claimed as applied until `db:migrate` succeeds on the workstation.

## Stage 3 — Self-hosted provider boundary

New config boundary:

```text
MEDIA_REALTIME_ENABLED
MEDIA_PROVIDER_TIMEOUT_MS
MEDIA_TRANSPORT_PROVIDER=disabled|livekit
LIVEKIT_URL
LIVEKIT_HEALTH_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
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

Realtime defaults to disabled. Provider health is actively probed; configuration alone is never enough. Disabled providers are not probed. Credentials are not returned by readiness state. No new npm package was added, preserving Dotin Nexus/lockfile discipline.

Actual LiveKit/coturn/Silero/Whisper/TTS/MuseTalk runtimes are not claimed installed or connected.

## Stage 4 — Preflight and lifecycle API

```text
GET  /v1/interviews/media/readiness?mode=audio|avatar
POST /v1/interviews/:sessionId/media/preflight
POST /v1/interviews/:sessionId/media/sessions
GET  /v1/interviews/:sessionId/media/sessions/latest
POST /v1/interviews/:sessionId/media/sessions/:mediaSessionId/events
```

Preflight combines session state, release posture, real/synthetic candidate mode, server-side consent/transcript permission, requested mode and provider health.

Media-session creation refuses failed preflight and returns `connectionCredentialsIssued=false`; room/token issuance remains a separate runtime transport slice rather than fabricated behavior.

Operational event payloads reject raw media/transcript/credential-like keys. Finalized transcript continues through the transcript API; evidence continues through the evidence API.

## Stage 5 — Internal readiness UI + candidate launch gate

`/app/interviews/internal-test` now includes a realtime readiness panel above the validated Brain harness. It shows audio/avatar requirements, provider/configured/reachable/ready state, blockers and privacy invariants.

The candidate surface explicitly states that device readiness alone cannot unlock realtime interviewing. Candidate auth/session isolation, server-side consent, release policy and healthy self-hosted transport/speech providers must all pass runtime preflight.

Candidate realtime launch remains disabled. This is intentional until the connection/token/worker slice is implemented and validated.

---

# 5. Target realtime architecture and ownership

```text
Candidate WebRTC
  → LiveKit OSS + coturn
  → self-hosted VAD
  → self-hosted STT
  → finalized transcript persistence
  → Interview Brain
  → validated structured turn
  → spokenText only
  → self-hosted TTS
  → optional AvatarProvider
  → LiveKit audio/video
  → Candidate
```

Ownership:

```text
Interview Brain   interview strategy and next-turn decision
Media worker      streaming/transport/speech/rendering mechanics
Avatar            renders approved spoken text only; never owns intelligence
Evaluator         consumes persisted finalized evidence; never scores live frames
Core API          tenant/release/consent/audit/domain state
```

Unsupported face/body/accent inference for honesty, personality, emotion, confidence or suitability remains prohibited.

---

# 6. Release posture

```text
DEV_ONLY               engineering only
INTERNAL_TEST          internal validation
SHADOW                 compare without autonomous consequence
SUPERVISED_PILOT       trained human supervisor required
CONTROLLED_PRODUCTION  explicit production approval required
SCALED_PRODUCTION      expanded approved deployment
SUSPENDED              execution blocked
```

The realtime foundation does not weaken existing release gates. Final hiring/rejection remains human-controlled.

---

# 7. VALIDATED vs CODED vs NOT IMPLEMENTED

## VALIDATED

- Node/npm/PostgreSQL local baseline;
- DB connectivity/auth;
- API `127.0.0.1:4100`;
- CORS configuration path;
- same-origin Next proxy;
- `/health`;
- `/development/context` ready state;
- candidate device check in Firefox;
- synthetic interview session creation;
- deterministic Brain turn persistence;
- transcript persistence through browser harness;
- manual synthetic evidence persistence;
- evidence coverage update and criterion transition.

## CODED — latest quality/runtime validation pending

- realtime media contracts and tests;
- migration 0015;
- provider descriptors/health probes and tests;
- readiness/preflight/media-session/event APIs;
- media DTO/lifecycle tests;
- internal readiness panel;
- candidate realtime launch gate;
- latest OpenAPI/client regeneration;
- latest lint/typecheck/test/build.

## NOT IMPLEMENTED / NOT CLAIMED CONNECTED

- LiveKit OSS deployment/runtime integration;
- coturn runtime;
- browser LiveKit connection;
- secure room/token issuance;
- media-worker executable process;
- streaming VAD adapter;
- streaming STT adapter;
- streaming TTS adapter;
- avatar runtime integration;
- live reconnect/checkpoint integration;
- recording runtime;
- candidate realtime auth/session isolation;
- production calibration/approval.

---

# 8. Latest validation sequence

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

Then open:

```text
http://localhost:3000/app/interviews/internal-test
```

Expected default media state is **Launch blocked** because realtime/providers default to disabled. That is correct safety behavior. The deterministic Brain harness must continue to work below the new readiness panel after migration 0015.

Detailed development boundary/runbook: `docs/realtime-media-development.md`.

---

# 9. Next runtime slice after this foundation is green

1. LiveKit OSS + coturn deployment/runbook and health validation.
2. Secure room/token issuance scoped to one interview/candidate session.
3. Browser transport with reconnect/checkpoint handling.
4. Media-worker VAD + STT streaming producing finalized transcript only.
5. Brain transport adapter → TTS streaming response.
6. Optional licensed/disclosed avatar rendering from `spokenText` only.
7. Recording only under explicit consent/policy.
8. Latency/failure injection, interruption/reconnect, Persian/code-switching validation.
9. INTERNAL_TEST then SHADOW calibration before supervised real-candidate pilot consideration.

No autonomous real-candidate interview mode is production-approved at this stage.
