# Realtime runtime runbook

This runbook moves M4 from provider-neutral readiness into a real local transport/speech runtime without introducing Docker as a workstation prerequisite.

## Local target

```text
Browser (Next.js)
  -> LiveKit OSS on 127.0.0.1:7880
  -> media-worker on 127.0.0.1:9010
       -> Silero VAD
       -> whisper.cpp
       -> local TTS command/provider
  -> Interview API on 127.0.0.1:4100
```

The candidate video track is transport/presentation only. It is not analyzed for personality, honesty, emotion, confidence, or suitability.

## 1. LiveKit on Windows

Install a current LiveKit Server Windows release and put `livekit-server` on PATH. For loopback development, start it with:

```powershell
livekit-server --dev
```

Keep the corresponding development API key and secret only in the local root `.env`; never commit them. The API uses them only to sign short-lived room-scoped access tokens.

Suggested local environment:

```env
MEDIA_REALTIME_ENABLED=true
MEDIA_TRANSPORT_PROVIDER=livekit
LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_HEALTH_URL=http://127.0.0.1:7880
LIVEKIT_API_KEY=<local-only>
LIVEKIT_API_SECRET=<local-only>
LIVEKIT_TOKEN_TTL_SECONDS=300
```

For localhost testing, TURN is not required. Production/corporate-network deployment still requires an explicitly validated TURN path and TLS.

## 2. coturn boundary

`infra/realtime/turnserver.example.conf` is a deployment template only. Do not copy credentials into source control. For a production-facing deployment, configure a dedicated TURN host/domain, TLS, firewall rules, relay port range, and external/private address mapping according to the target network.

## 3. Speech toolchain

The next media-worker slice expects:

```text
Python 3
FFmpeg
whisper.cpp / whisper-cli
Silero VAD Python package/runtime
local TTS executable or HTTP runtime
```

The worker can start in diagnostic mode before all model runtimes are installed, but readiness remains blocked until required providers report healthy.

Set the local whisper model and executable in `.env` or worker environment:

```env
WHISPER_CLI=whisper-cli
WHISPER_MODEL_PATH=D:\models\whisper\ggml-medium.bin
MEDIA_WORKER_BASE_URL=http://127.0.0.1:9010
VAD_BASE_URL=http://127.0.0.1:9010
STT_BASE_URL=http://127.0.0.1:9010
TTS_BASE_URL=http://127.0.0.1:9010
```

Persian and Persian-English code-switching must be benchmarked before any real-candidate release stage.

## 4. Workstation check

From the repository root:

```powershell
npm run realtime:check
```

The command checks executables and, when URLs are configured, health endpoints. `coturn` is optional for loopback development but required before non-loopback production validation.

## 5. Release boundary

A working LiveKit room is not production approval. Real-candidate execution still requires server-side candidate authentication, active consent, release-unit approval, reconnect/failure testing, evaluator calibration, and production-readiness gates.
