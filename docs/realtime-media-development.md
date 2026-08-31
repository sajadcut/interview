# M4 Realtime Interview Media — Development Boundary

## Status

This repository contains the **provider-neutral realtime media boundary**, persistence model, health/readiness probes and lifecycle API. It does **not** yet contain a validated end-to-end LiveKit/VAD/STT/TTS/avatar runtime loop.

The currently validated interview path remains the persisted deterministic Interview Brain through the internal browser harness. Realtime candidate launch stays blocked until transport and speech providers are actually installed, configured, healthy and exercised on the workstation.

## Architecture

```text
Candidate browser
  -> WebRTC
  -> LiveKit OSS
  -> coturn when required
  -> VAD
  -> STT
  -> finalized transcript segment
  -> deterministic Interview Brain
  -> structured turn
  -> spoken_text
  -> TTS
  -> optional avatar renderer
  -> LiveKit audio/video
  -> Candidate browser
```

The Interview Brain is independent from transport and avatar rendering. The evaluator remains independent from both and consumes persisted finalized evidence after the interview.

## Privacy and evidence invariants

- Candidate video is not analyzed for emotion, honesty, personality, confidence, suitability or other biometric/behavioral hiring inference.
- Raw media is not persisted by the core API media lifecycle tables.
- Operational media events cannot contain raw audio/video/frame/blob/base64, transcript text or credentials/tokens/secrets.
- Finalized transcript text is persisted through the dedicated transcript endpoint and is the textual input to the Brain.
- Only finalized Brain `spokenText` is intended to reach TTS/avatar.
- Recording is independent from transport and requires applicable policy plus consent.
- Provider credentials and room access tokens are never returned by the readiness API and are never committed to the repository.

## Persistence

Migration `0015_m4_realtime_media.sql` adds:

- `interview_media_sessions` — provider-neutral realtime session lifecycle, readiness snapshot, pipeline versions, room reference and recording state.
- `interview_media_events` — ordered operational event journal for transport/VAD/STT/Brain/TTS/avatar lifecycle metadata.

Run migrations before testing media-session creation or event persistence:

```powershell
cd D:\interview\interview
npm run db:validate
npm run db:migrate
```

## Configuration

Realtime is disabled by default:

```env
MEDIA_REALTIME_ENABLED=false
MEDIA_PROVIDER_TIMEOUT_MS=2500

MEDIA_TRANSPORT_PROVIDER=disabled
LIVEKIT_URL=
LIVEKIT_HEALTH_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
TURN_URLS=

VAD_PROVIDER=disabled
VAD_BASE_URL=
STT_PROVIDER=disabled
STT_BASE_URL=
TTS_PROVIDER=disabled
TTS_BASE_URL=
AVATAR_PROVIDER=disabled
AVATAR_BASE_URL=
```

A provider is **not ready merely because these values exist**. Required health probes must succeed.

For audio mode, required components are transport + VAD + STT + TTS. Avatar mode additionally requires the avatar provider.

Expected provider boundary examples:

```env
MEDIA_REALTIME_ENABLED=true
MEDIA_TRANSPORT_PROVIDER=livekit
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_HEALTH_URL=http://127.0.0.1:7880

VAD_PROVIDER=silero-http
VAD_BASE_URL=http://127.0.0.1:9010

STT_PROVIDER=whisper-http
STT_BASE_URL=http://127.0.0.1:9020

TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9030

# Optional unless avatar mode is requested.
AVATAR_PROVIDER=musetalk-http
AVATAR_BASE_URL=http://127.0.0.1:9040
```

Do not commit real LiveKit credentials or any provider secret. Runtime dependencies must be installed through the configured Dotin Nexus registry and reflected in the canonical workstation-generated lockfile.

## API surface

Internal tenant/RBAC-protected endpoints:

```text
GET  /v1/interviews/media/readiness?mode=audio|avatar
POST /v1/interviews/:sessionId/media/preflight
POST /v1/interviews/:sessionId/media/sessions
GET  /v1/interviews/:sessionId/media/sessions/latest
POST /v1/interviews/:sessionId/media/sessions/:mediaSessionId/events
```

`readiness` performs provider health checks and returns no credentials.

`preflight` combines:

- session lifecycle state;
- stored interview release decision;
- active consent and transcript permission;
- provider health/readiness;
- requested audio/avatar mode.

`media/sessions` refuses creation when preflight fails. It intentionally does **not** fabricate or issue provider connection credentials. Actual LiveKit room/token issuance belongs to the runtime transport integration slice.

`events` persists operational lifecycle metadata only. Transcript text continues to use the transcript endpoint; Brain turns continue to use the Brain endpoint; evidence continues to use the evidence endpoint.

## Internal browser readiness panel

Open:

```text
http://localhost:3000/app/interviews/internal-test
```

The page now contains a realtime readiness panel above the validated deterministic Brain harness. It can switch between audio/avatar readiness and exposes per-component configured/reachable/ready state, blockers and privacy invariants.

With the default configuration, the correct state is **Launch blocked**, not a fake connected state.

## Validation sequence for this slice

After pulling the latest code:

```powershell
cd D:\interview\interview
npm run db:validate
npm run db:migrate
npm run api:sync
npm run lint
npm run typecheck
npm run test
npm run build
npm run dev
```

Then verify:

1. `/app/interviews/internal-test` still runs the persisted deterministic Brain harness.
2. Realtime readiness shows disabled/unconfigured providers by default without secrets.
3. Configure one provider at a time and verify health status changes only when the probe succeeds.
4. Do not enable candidate realtime launch yet. The connection/token/worker loop is the next runtime implementation slice after this boundary is green.

## What remains after this boundary

- self-hosted LiveKit deployment/runtime integration;
- coturn/STUN/TURN configuration and browser connectivity validation;
- media-worker process implementation;
- VAD streaming adapter;
- STT streaming/finalization adapter;
- Brain transport adapter that forwards finalized transcript only;
- TTS streaming adapter;
- optional avatar renderer integration and licensed actor/voice asset governance;
- room/token issuance with candidate-facing authentication and session isolation;
- reconnect/checkpoint behavior over live media;
- recording implementation under explicit consent/policy;
- latency, failure-injection, Persian/code-switching and calibration validation;
- staged release through INTERNAL_TEST → SHADOW → SUPERVISED_PILOT before any controlled production consideration.
