# Staging Runtime Preflight

This runbook is the first implementation step of the production-like staging / real-runtime closure work.

It does **not** declare the interview stack production-ready. It prevents false closure by requiring real production-mode configuration and live readiness evidence before realtime benchmarks, evaluator calibration, shadow testing, or supervised pilot work begins.

## Safety boundary

The preflight deliberately requires:

- `NODE_ENV=production` so production transport/secret policies are exercised;
- `SUPERVISED_PILOT_ENABLED=false` so staging validation cannot silently admit real pilot traffic;
- realtime media enabled with the self-hosted LiveKit transport;
- `wss://` LiveKit transport and `https://` LiveKit health transport;
- strong LiveKit, media-worker, and AI-worker shared secrets;
- at least one configured TURN endpoint;
- real Whisper, FFmpeg, VAD, TTS, and openai-compatible LLM providers;
- a configured Whisper model and local TTS command;
- runtime readiness from API, LiveKit, media/Whisper/FFmpeg, VAD, TTS, and the realtime AI interviewer.

The generated evidence contains pass/fail details only. Secret values are never copied into the evidence JSON.

## Environment file

Create a local ignored file named `.env.staging.local`. Start from the root `.env.example`, then set real staging values. Do not commit the file or paste credentials into issues, logs, or chat.

At minimum, the preflight expects the existing runtime variables plus:

```env
NODE_ENV=production
SUPERVISED_PILOT_ENABLED=false
STAGING_API_BASE_URL=https://api.staging.example.com

MEDIA_REALTIME_ENABLED=true
MEDIA_TRANSPORT_PROVIDER=livekit
LIVEKIT_URL=wss://rtc.staging.example.com
LIVEKIT_HEALTH_URL=https://rtc.staging.example.com
LIVEKIT_API_KEY=<real-staging-key>
LIVEKIT_API_SECRET=<at-least-32-byte-random-secret>
TURN_URLS=turn:turn.staging.example.com:3478,turns:turn.staging.example.com:5349

MEDIA_WORKER_SHARED_SECRET=<at-least-32-byte-random-secret>
MEDIA_WORKER_BASE_URL=https://media.staging.example.com
STT_PROVIDER=whisper-http
STT_BASE_URL=https://media.staging.example.com/stt
WHISPER_CLI=/absolute/path/to/whisper-cli
WHISPER_MODEL_PATH=/absolute/path/to/model.bin
FFMPEG_ENABLED=true

VAD_PROVIDER=silero-http
VAD_BASE_URL=https://vad.staging.example.com
TTS_PROVIDER=local-http
TTS_BASE_URL=https://tts.staging.example.com
TTS_COMMAND=<local-command-with-{text_file}-and-{output_wav}>

LLM_PROVIDER=openai-compatible
LLM_MODEL=<real-model-id>
LLM_API_KEY=<real-provider-key>
AI_WORKER_SHARED_SECRET=<at-least-32-byte-random-secret>
AI_INTERVIEWER_BASE_URL=https://ai-interviewer.staging.example.com
```

Use deployment-specific hosts, ports and credentials. These example values are not deployment configuration.

## Run configuration validation first

```bash
node scripts/staging-runtime-preflight.mjs --config-only
```

This must fail until every required real-runtime value is configured. A failure here is expected while staging is incomplete and must not be bypassed with placeholder secrets or disabled providers.

## Run live readiness validation

After the staging services are running:

```bash
node scripts/staging-runtime-preflight.mjs
```

The preflight probes:

```text
GET /health
GET /health/ready
GET /health/livekit
GET /health/whisper
LiveKit HTTP health
media-worker /health
media-worker /ffmpeg/health
media-worker /stt/health
VAD /health
TTS /health
AI interviewer /health
```

Every probe must return a ready state. An HTTP process being reachable is not sufficient when the service exposes `ready=false`.

## Evidence

By default the command writes:

```text
.local-data/evidence/staging-runtime-preflight.json
```

The `.local-data` directory is ignored by Git. Keep deployment evidence in the controlled release/evidence system used for the target environment; do not commit secrets or raw production credentials.

A passing preflight is only the entrance criterion for the next runtime-validation work. Phase 1 remains open until real end-to-end candidate audio reaches LiveKit/TURN, Whisper, Interview Brain/LLM, TTS and the browser with measured telemetry and recoverable failure behavior.

## Contract validation

The repository-level contract test is dependency-free:

```bash
node --check scripts/staging-runtime-preflight.mjs
node --test scripts/staging-runtime-preflight.test.mjs
```

CI runs those checks whenever the staging preflight or its runtime-contract dependencies change. CI validates the preflight logic only; it never fabricates real staging evidence.
