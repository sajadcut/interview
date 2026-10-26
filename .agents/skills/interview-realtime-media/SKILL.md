---
name: interview-realtime-media
description: Diagnose and implement candidate interview camera, microphone, permission checks, device preview, setup-to-room handoff, LiveKit/WebRTC, reconnect, VAD/STT/TTS and media latency. Use for stuck webcam, dropped media tracks, audio-only fallback, and realtime interview failures.
---

# Realtime media and candidate device reliability

Read `AGENTS.md`, `docs/operations/candidate-interview-ui.md`, `docs/operations/livekit-deployment.md` and `production-readiness.md` before touching the candidate realtime path.

## Real implementation

- Candidate setup: `apps/web/app/candidate/setup/page.tsx`.
- Room UI: `apps/web/components/candidate/candidate-interview-experience.tsx`.
- Track ownership/handoff: `apps/web/lib/candidate-device-preview.ts`, `candidate-realtime-runtime.ts`, `candidate-interview-state.ts`.
- Transport: `apps/api/src/interviews/livekit-transport.adapter.ts`, `apps/api/src/interviews/livekit-access-token.ts`.
- Worker and contracts: `services/media-worker/`, `services/vad-worker/`, `services/tts-worker/`, `contracts/` (verify current paths/versions before editing).
- Browser regressions: `e2e/candidate-interview-ui.spec.ts`, `e2e/candidate-critical.spec.ts`.

## Investigation protocol

1. Reproduce from candidate invitation -> consent -> setup -> explicit device test -> handoff -> candidate room -> Start interview. Record browser, OS, HTTPS/localhost origin, permission prompts and exact error/status transitions.
2. Distinguish four states: browser permission granted; `getUserMedia` succeeded; audio/video `MediaStreamTrack.readyState === "live"`; secure LiveKit room actually connected. Never report a live webcam/microphone from permission state alone.
3. Inspect ownership of each media track. Stop stale preview tracks on navigation/unmount and when async permission responses arrive after unmount; prevent React Strict Mode double acquisition and retry short-lived `NotReadableError`/device-busy handoff failures with bounded retries. Do not indefinitely recapture or leak tracks.
4. Keep microphone readiness separate from camera acquisition. Camera denial/unavailability can explicitly select audio-only; microphone failure must remain visible and cannot be bypassed by a silent synthetic stream.
5. Confirm expected state-machine transitions (`permissions`, `ready`, `connecting`, `live`, `reconnecting`, `offline`, `degraded`, `fatal`, `completed`). Only a real runtime CONNECTED event may report `live`; bound reconnect attempts.
6. Validate server-candidate boundary: cookie-backed session, consent, candidate-only same-origin proxy, short-lived LiveKit tokens, no organization headers or recruiter credentials in candidate requests, no fabricated video/audio. Interviewer TTS consumes a finalized persisted `turnId`, never arbitrary browser-supplied text.
7. For provider debugging separate contract success from actual TURN/RTP/packet-loss/latency, Whisper transcription quality (Persian + technical English), TTS playback and selected LLM responses. Use redacted trace IDs and measured evidence; no secrets or raw candidate audio in logs.

## Checks

```bash
npm run candidate-interview-ui:contract:check
npm run livekit:config:check
npm run vad:contract:check
npm run whisper:contract:check
npm run tts:contract:check
npm run e2e
```

Also run relevant unit/reducer tests and browser E2E with real camera/mic hardware when available; a fake `getUserMedia` Playwright test does not validate a physical device. Never weaken consent, permissions, TLS or media release gates to make a demo green.

## Done means

Report which of browser permission, live local track, LiveKit session, finalized STT, LLM turn and TTS were **observed**; attach reproduction/test evidence and mark all unmeasured runtime gates `VALIDATION_PENDING`. Do not equate `GET /health/livekit` with real realtime readiness.
