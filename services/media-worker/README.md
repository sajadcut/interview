# Media Worker

The media worker owns realtime speech/avatar/media workloads for M4. It is intentionally separate from the Interview Brain and evaluator.

## Target pipeline

```text
Candidate WebRTC
  -> LiveKit OSS + coturn
  -> self-hosted VAD
  -> self-hosted STT
  -> persisted finalized transcript
  -> Interview Brain
  -> spoken_text only
  -> self-hosted TTS
  -> optional avatar renderer
  -> LiveKit audio/video back to candidate
```

## Hard boundaries

- The Interview Brain owns interview strategy and structured turns; the avatar never owns intelligence.
- Only finalized transcript text reaches the Brain. Raw audio/video is not an evidence source by default.
- Only `spoken_text` from a finalized Brain turn reaches TTS/avatar.
- Candidate video must not be used to infer emotion, honesty, personality, confidence, suitability, race, health, disability or other sensitive traits.
- Provider credentials and room access tokens must not be persisted in interview media tables or committed to the repository.
- Recording is separate from transport and requires explicit consent/policy approval.
- The evaluator consumes persisted finalized evidence after the interview; it does not score live media frames.

## Provider readiness contract

The API exposes provider-neutral readiness for transport, VAD, STT, TTS and optional avatar. A provider is not `ready` merely because configuration exists: the configured health probe must succeed. Realtime remains disabled while `MEDIA_REALTIME_ENABLED=false` or any required component is not healthy.

No LiveKit/VAD/STT/TTS/avatar runtime dependency is installed by this repository stage. Adding runtime packages must go through the configured Dotin Nexus registry and a canonical workstation-generated `package-lock.json` update.
