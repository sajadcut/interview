# Standalone Silero VAD Worker

This service owns only voice-activity detection. It is deliberately independent of the LLM, Whisper/STT, LiveKit transport, FFmpeg, and TTS workers.

## Contract

- `GET /health`
- `POST /analyze`
- contract version: `silero-vad.v1`
- input: WAV (`audio/wav` or `audio/x-wav`), at most 20 MiB / 300 seconds
- output: bounded structured speech segments, normalized to seconds
- authentication: `x-vad-secret` (the current deployment uses `MEDIA_WORKER_SHARED_SECRET`)
- redirects are not part of the contract

The worker loads Silero lazily and serializes model access. Raw audio is written only to an owned temporary directory for the duration of analysis and is removed afterward.

## Local runtime

```bash
python -m pip install -r services/vad-worker/requirements.txt
MEDIA_WORKER_SHARED_SECRET=local-secret npm run vad-worker:dev
```

Default address: `http://127.0.0.1:9030`.

## Validation without Silero

```bash
npm run vad:contract:check
npm run vad-worker:test
```

The repository tests use synthetic WAV bytes plus a fake engine. They validate HTTP/auth/versioning, input validation, output-schema fail-closed behavior, cleanup, retry semantics, and independence from LLM/Whisper/LiveKit/FFmpeg/TTS without importing or running Silero.

## Deferred runtime evidence

These tests are not acoustic-quality evidence. Representative speech/noise/silence fixtures, Persian/English false-positive/false-negative rates, threshold tuning, streaming chunk behavior, end-of-turn behavior, CPU/memory, and tail latency should be measured after the real media flow exists.
