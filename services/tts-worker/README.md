# Standalone TTS Worker

`services/tts-worker` is the provider-neutral local command boundary for text-to-speech. It is intentionally a separate process from the media worker so TTS can be developed, deployed, benchmarked and replaced without waiting for LLM, whisper.cpp, LiveKit or FFmpeg.

The worker exposes:

```text
GET  /health
POST /synthesize
```

The versioned contract is `contracts/tts-synthesis.v1.json`. `POST /synthesize` requires `x-tts-contract-version`, `x-request-id` and the shared secret. The worker accepts UTF-8 `spokenText`, writes it only to an owned temporary file, invokes the configured engine with `shell=false`, validates non-empty WAV output, then removes both text and audio workspace files.

## Configuration

The command template must contain exactly `{text_file}` and `{output_wav}`. The engine must read UTF-8 text from the first path and write WAV to the second path.

```env
TTS_COMMAND=<tts-executable> ... --input {text_file} ... --output {output_wav}
TTS_TIMEOUT_SECONDS=60
TTS_TERMINATION_GRACE_SECONDS=2
TTS_WORK_ROOT=
TTS_WORKER_HOST=127.0.0.1
TTS_WORKER_PORT=9020
MEDIA_WORKER_SHARED_SECRET=<local-secret>
```

The standalone worker currently reuses `MEDIA_WORKER_SHARED_SECRET` as the API/worker shared-secret source so existing secret management remains compatible. This is only a credential name; the worker has no runtime dependency on the media worker. It also accepts `TTS_SHARED_SECRET` as an override when launched independently.

Point the API at the standalone service:

```env
TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9020
```

Production deployments should terminate TLS in front of the worker and use HTTPS plus a strong shared secret. The API adapter fails closed on insecure production TTS configuration.

## Tests without a TTS engine

```bash
npm run tts:contract:check
npm run tts-worker:test
```

Tests use the current Python interpreter as a scripted fake engine. They cover shell-free command construction, text-via-file transport, timeout/terminate/kill, cleanup, WAV validation, HTTP authentication/versioning and standalone readiness. No model, voice package, API key, FFmpeg, Whisper, LiveKit or LLM is required.
