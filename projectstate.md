# AI Recruiter Platform — PROJECT STATE

> **Status:** M1–M6 implementation baseline materially advanced. Deterministic M4 Interview Brain is browser-validated for a synthetic internal candidate. The next five M4 runtime stages are coded: local realtime toolchain/runbook, short-lived LiveKit credential issuance, internal browser LiveKit transport/reconnect lifecycle, executable local VAD/STT media-worker, and persisted Brain `spoken_text` → local TTS WAV bridge. Current workstation TypeScript typecheck, production build, and OpenAPI/typed-client regeneration are green. Realtime workstation checking is also validated and currently reports three missing required local tools: LiveKit Server, FFmpeg, and whisper.cpp CLI.  
> **Version:** 0.13.2  
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
Node.js 25.9 / npm 11.6                    ✅ VALIDATED ON WINDOWS
Dotin Nexus npm registry                    ✅ VERIFIED ON WORKSTATION
PostgreSQL 17.11                            ✅ CONNECTIVITY + AUTH VALIDATED
API bind 127.0.0.1:4100                    ✅ VALIDATED
Root monorepo .env                          ✅ API + Web shared local source-of-truth
CORS + same-origin Web→API proxy            ✅ BROWSER/API VALIDATED
Development context ready=true              ✅ VALIDATED
Deterministic Interview Brain               ✅ BROWSER VALIDATED
Transcript + manual evidence persistence    ✅ BROWSER VALIDATED
Evidence-driven criterion transition        ✅ BROWSER VALIDATED
Migration 0015 realtime media               🟡 CODED / WORKSTATION APPLY RESULT PENDING
Realtime provider readiness/preflight       🟡 CODED / RUNTIME PROVIDERS PENDING
LiveKit scoped token issuance               🟡 CODED / LIVEKIT RUNTIME VALIDATION PENDING
Browser LiveKit client transport            🟡 CODED / RUNTIME VALIDATION PENDING
Media-worker executable                     🟡 CODED / PYTHON+MODELS VALIDATION PENDING
Silero VAD HTTP adapter                     🟡 CODED / LOCAL PACKAGE+MODEL VALIDATION PENDING
whisper.cpp final STT adapter               🟡 CODED / CLI+MODEL VALIDATION PENDING
Persisted Brain turn → TTS WAV              🟡 CODED / LOCAL TTS ENGINE VALIDATION PENDING
Media-worker LiveKit room subscriber        ⏳ NOT IMPLEMENTED
Live audio chunk → VAD/STT transport        ⏳ NOT IMPLEMENTED
TTS audio publication back into LiveKit     ⏳ NOT IMPLEMENTED
Avatar runtime                              ⏳ NOT IMPLEMENTED
Candidate realtime auth/session isolation   ⏳ NOT IMPLEMENTED
Latest HEAD typecheck                       ✅ WORKSTATION GREEN
Latest HEAD build                           ✅ WORKSTATION GREEN
OpenAPI + typed client regeneration         ✅ WORKSTATION GREEN
Realtime workstation checker                ✅ EXECUTED / BLOCKERS IDENTIFIED
LiveKit Server executable                   ⏳ MISSING ON WORKSTATION
FFmpeg executable                           ⏳ MISSING ON WORKSTATION
whisper.cpp CLI executable                  ⏳ MISSING ON WORKSTATION
Python 3.14.6                               ✅ FOUND BY REALTIME CHECK
coturn                                      ◻ OPTIONAL FOR LOOPBACK / NOT INSTALLED
Latest HEAD lint                            ⏳ PENDING
Latest HEAD tests                           ⏳ PENDING
Production approval                         ⬜ NOT APPROVED
```

---

# 2. Validated evidence retained

```text
GET http://127.0.0.1:4100/health
→ status=ok, service=interview-api

GET http://127.0.0.1:4100/development/context
→ ready=true

GET /api/backend/development/context
→ HTTP 200 through Next same-origin proxy

Controlled Interview Brain browser flow
→ synthetic session created
→ Brain turn persisted
→ interviewer transcript persisted
→ candidate answer persisted
→ manual evidence persisted
→ evidence coverage updated
→ Brain transitioned to next rubric criterion

Current workstation quality evidence
→ npm run typecheck: green
→ npm run build: green
→ npm run api:sync: OpenAPI export + typed client generation green

Realtime workstation evidence
→ npm run realtime:check executed successfully as a checker
→ Python 3.14.6 found
→ LiveKit Server missing from PATH
→ FFmpeg missing from PATH
→ whisper.cpp CLI missing from PATH
→ coturn absent but optional for loopback
→ LiveKit HTTP and media-worker URLs not yet configured
```

Candidate camera/microphone device check was previously validated in Firefox. Port 4000 remains occupied by workstation process TPVCGateway; Interview API local baseline is 127.0.0.1:4100.

---

# 3. M1–M6 baseline

## M1 — Job → Candidate → Evidence

Tenant-safe jobs/requirements/rubrics/candidates/applications/evidence/scorecards exist. Candidate remains organization-global; Application remains job-specific. Missing evidence remains incomplete rather than fabricated.

## M2 — Sourcing + Talent

Internal-talent-first adapter architecture, sourcing runs, discovered candidates and merge review are persisted. Real semantic/pgvector retrieval and production external adapters remain incomplete.

## M3 — Outreach + Screening + Scheduling

Approved-knowledge grounding, persisted communications, deterministic hard-minimum screening with human review and provider-neutral scheduling lifecycle exist. Real outbound/calendar provider execution remains incomplete.

## M4 — AI Interview

Persisted release units/plans/sessions/turns/transcript/evidence, controlled candidate intents, deterministic Brain, release gating, consent/device UX, media readiness/persistence, and the runtime slices below are present. Real-candidate autonomous interview remains blocked.

## M5 — Assessments

Assessment persistence and isolated-runner boundary exist. Real isolated execution worker remains pending.

## M6 — Analytics + Enterprise hardening

Analytics/privacy/retention/event foundations, tenant isolation, RBAC and audit are materially advanced. Production identity, integrations, observability and operational hardening remain incomplete.

---

# 4. Realtime foundation already present

```text
provider-neutral transport/VAD/STT/TTS/avatar contracts
migration 0015 interview_media_sessions + interview_media_events
configured/reachable/ready provider health separation
consent/release/provider preflight
media lifecycle journal
candidate launch gate
internal readiness UI
privacy invariants:
  candidateVideoAnalysis = none
  biometricInferenceAllowed = false
  rawMediaPersistedByApi = false
  spokenTextOnlyToAvatar = true
```

---

# 5. Five new runtime stages coded

## Stage 1 — Local-native toolchain/runbook

Added:

```text
scripts/check-realtime-tools.mjs
docs/realtime-runtime-runbook.md
infra/realtime/turnserver.example.conf
npm run realtime:check
```

Required local executable checks: LiveKit Server, Python, FFmpeg and whisper-cli. coturn is optional for localhost but required for non-loopback/corporate-network production validation.

## Stage 2 — Secure LiveKit connection credential

New server-side token signer creates HS256 LiveKit JWTs with:

```text
opaque participant identity
opaque room reference
roomJoin=true
canPublish=true
canSubscribe=true
canPublishData=false
publish sources = camera + microphone
TTL bounded to 60..900 seconds
```

Endpoint:

```text
POST /v1/interviews/:sessionId/media/sessions/:mediaSessionId/connection
```

The endpoint refuses real-customer sessions in the development/internal path. API key/secret and access token are never persisted. Browser identity/room names contain no candidate PII.

## Stage 3 — Internal browser LiveKit transport

`livekit-client@2.21.0` is declared in the Web workspace. A synthetic transport harness now performs:

```text
preflight
→ media-session persistence
→ short-lived credential issuance
→ Room.connect()
→ microphone/camera publication
→ connected/degraded/reconnected/disconnected lifecycle events
→ 15s heartbeat
→ explicit end
```

The lockfile must be generated by a real workstation `npm install` through Dotin Nexus; it was not fabricated in repository edits.

## Stage 4 — Executable local VAD/STT media-worker

`services/media-worker/server.py` now provides:

```text
GET  /health
GET  /vad/health
GET  /stt/health
GET  /tts/health
POST /vad/analyze
POST /stt/finalize
POST /tts/synthesize
```

POST endpoints require a local shared secret. VAD uses optional installed `silero-vad`. STT invokes local `whisper-cli`, writes only temporary WAV/output files, requires the expected output file to exist, returns only finalized text, and deletes temporary data after the request.

This is an executable provider process, but it is not yet a LiveKit room subscriber. Live audio → worker streaming is the next transport integration slice.

## Stage 5 — Persisted Brain spoken_text → TTS WAV

New API service/controller path accepts no arbitrary text from the browser. It takes only session/media-session/turn IDs, loads a finalized persisted `interview_turns.spoken_text`, checks synthetic/internal scope and TTS readiness, then calls the authenticated worker TTS endpoint.

```text
POST /v1/interviews/:sessionId/media/sessions/:mediaSessionId/turns/:turnId/audio
```

The WAV response is streamed for internal validation and is not persisted. `tts_started` and `tts_ended` operational events store only identifiers/size metadata. An internal Brain→TTS harness can create a synthetic Brain turn and play the returned WAV when the local TTS engine is configured.

---

# 6. Tooling required on workstation for these five stages

```text
LiveKit Server Windows binary
livekit-client npm dependency from Dotin Nexus
Python 3
Python virtual environment
silero-vad Python package/runtime
FFmpeg
whisper.cpp build / whisper-cli
multilingual whisper ggml model
one local TTS executable/runtime capable of UTF-8 Persian/English input and WAV output
```

For localhost transport, coturn is not required. Before network/production validation, TURN/TLS/firewall behavior must be validated.

Local secret/model/voice files must never be committed.

---

# 7. VALIDATED vs CODED vs NOT IMPLEMENTED

## VALIDATED

- Node/npm/PostgreSQL/API local baseline;
- same-origin Web→API path;
- development fixtures;
- candidate Firefox device check;
- synthetic Interview Brain session/turn/transcript/evidence flow;
- evidence coverage and criterion transition;
- current HEAD TypeScript typecheck;
- current HEAD production build;
- current OpenAPI export and typed API-client regeneration;
- realtime workstation checker execution and blocker detection.

## CODED — workstation runtime validation pending

- migration 0015;
- realtime provider health/preflight/lifecycle;
- LiveKit JWT signer and scoped connection endpoint;
- browser LiveKit transport/reconnect/heartbeat harness;
- Python media-worker process;
- Silero VAD endpoint;
- whisper.cpp final STT endpoint;
- authenticated local TTS command adapter;
- persisted Brain turn → WAV endpoint/UI;
- latest lint/test result.

## NOT IMPLEMENTED / NOT CLAIMED CONNECTED

- media-worker subscribing to LiveKit candidate audio tracks;
- continuous audio frame/chunk streaming into VAD;
- automatic VAD speech-end → STT finalize → transcript persistence;
- transcript → Brain automatic realtime turn trigger;
- TTS WAV publication back to LiveKit room;
- interruption/barge-in audio cancellation;
- avatar runtime/MuseTalk integration;
- recording runtime;
- candidate magic-link/OTP realtime auth isolation;
- Persian/code-switching accuracy/latency benchmark;
- failure injection/SLO/calibration;
- SHADOW/SUPERVISED_PILOT/production approval.

---

# 8. Workstation validation sequence

After pulling current main, install/update JavaScript dependencies through the configured Dotin Nexus and keep the canonical lockfile workstation-generated:

```powershell
cd D:\interview\interview
git pull
npm install
```

Apply/validate domain state and generated API artifacts:

```powershell
npm run db:validate
npm run db:migrate
npm run dev:bootstrap
npm run api:sync
```

Install/start local media tools as described in `docs/realtime-runtime-runbook.md` and `services/media-worker/README.md`.

Quality/runtime gates:

```powershell
npm run realtime:check
npm run lint
npm run test
npm run typecheck
npm run build
npm run dev
```

Open:

```text
http://localhost:3000/app/interviews/internal-test
```

Do not enable real-customer autonomous execution from this engineering harness.

---

# 9. Next runtime work after validation

```text
LiveKit worker subscriber
→ continuous audio frames
→ streaming Silero state
→ speech-end segmentation
→ whisper final transcript
→ transcript persistence
→ Interview Brain next turn
→ local TTS
→ publish audio to LiveKit
→ interruption/reconnect handling
→ optional licensed avatar
```

Then: Persian/code-switching benchmarks, latency/failure injection, evaluator calibration, INTERNAL_TEST → SHADOW → SUPERVISED_PILOT. No autonomous real-candidate mode is production-approved.
