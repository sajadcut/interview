# Silero VAD Integration Contract v1

`silero-vad.v1` freezes the boundary between the interview platform and a standalone Silero VAD worker.

## Independence boundary

The VAD worker has no runtime dependency on the LLM provider, Whisper, LiveKit, FFmpeg, or TTS. Its `/health` endpoint loads/checks only the Silero engine and shared-secret configuration. The API-side `SileroVadHttpClient` probes only `VAD_BASE_URL`.

This is intentionally different from full realtime preflight: a complete interview media session may require several components, but VAD itself can be developed, deployed, and tested independently.

## HTTP contract

`GET /health` returns JSON with:

- `contractVersion = silero-vad.v1`
- `provider = silero-vad`
- readiness state
- target sample rate and bounded input limits
- the explicit `independentOf` list

`POST /analyze` accepts only WAV bytes with a bounded request id and shared-secret authentication. A successful response contains only derived data: `speechDetected`, normalized `segments`, target sample rate, and input duration. Raw audio is not returned or persisted.

## Validation and failure semantics

The worker rejects malformed WAVs, compressed WAV, invalid channel/sample-width/sample-rate values, oversized payloads, overlong audio, overlapping/out-of-range segments, and excessive segment counts. Provider exceptions are mapped to stable safe errors; raw engine traces are not returned.

The API client uses bounded retries only for transient network/5xx/429 failures, preserves the same request id across retries, disables redirects, validates the versioned structured response, and fails closed on malformed segment output.

Production client configuration requires HTTPS and a strong shared secret.

## What CI proves

CI does not install or invoke Silero. Python tests use synthetic WAV data and a fake engine, while TypeScript tests use scripted HTTP responses. This proves the contract, input/output validation, cleanup, error mapping, retry/timeout policy, and standalone dependency boundary.

## What remains for the media-flow phase

Real audio testing is deliberately deferred until the media pipeline is available. That phase must add representative silence, music/noise, overlapping speech, Persian and English speech, microphone/device variation, chunk boundaries, end-of-turn behavior, threshold tuning, false-positive/false-negative measurements, latency, CPU/memory, and sustained-load evidence.
