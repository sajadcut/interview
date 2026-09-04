# Media Worker

The media worker owns realtime speech/media mechanics for M4. It is separate from the Interview Brain and evaluator.

## Executable boundary

`server.py` is a local-native HTTP worker. It loads the repository root `.env`, exposes component-specific health, accepts WAV audio for VAD/STT, and synthesizes WAV from server-approved `spokenText` through a configured local TTS command.

```text
GET  /health
GET  /vad/health
GET  /stt/health
GET  /tts/health
GET  /ffmpeg/health
GET  /metrics
POST /vad/analyze      Content-Type: audio/wav
POST /stt/finalize     Content-Type: audio/wav
POST /tts/synthesize   Content-Type: application/json
```

All POST endpoints require `x-media-worker-secret`, matching local `MEDIA_WORKER_SHARED_SECRET`. Health endpoints never expose that secret. Request bodies, transcript text, spoken text and credentials are not logged.

The STT endpoint invokes local `whisper-cli` and requires an actual output file; exit code 0 alone is not considered success. Raw audio and TTS text/output files live only in temporary directories and are deleted after the request.

FFmpeg process execution is isolated in `ffmpeg_layer.py`. The layer owns fixed command profiles, workspace-scoped paths, shell-free spawning, process-group timeout/cancellation, terminate→kill escalation, output validation, bounded diagnostics, cleanup and existing Realtime Metrics v1 instrumentation. `FFMPEG_ENABLED=false` is fail-closed; `/ffmpeg/health` reports the versioned readiness contract without requiring FFmpeg on development or CI machines.

## Local runtime

```powershell
python -m venv .venv-media
.\.venv-media\Scripts\Activate.ps1
python -m pip install -r services/media-worker/requirements.txt
```

Install/build `whisper.cpp`, ensure `whisper-cli` is on PATH (or set `WHISPER_CLI`), and configure a local multilingual model when validating real STT runtime behavior.

FFmpeg is not required for contract/unit tests. Install a pinned FFmpeg build only when validating real media execution, codecs, quality and performance, then explicitly enable it:

```env
FFMPEG_ENABLED=true
FFMPEG_CLI=ffmpeg
FFMPEG_TIMEOUT_SECONDS=120
FFMPEG_TERMINATION_GRACE_SECONDS=2
```

Example media-worker configuration:

```env
MEDIA_WORKER_HOST=127.0.0.1
MEDIA_WORKER_PORT=9010
MEDIA_WORKER_SHARED_SECRET=<local-random-secret>
WHISPER_CLI=whisper-cli
WHISPER_MODEL_PATH=D:\models\whisper\ggml-medium.bin
WHISPER_LANGUAGE=auto

VAD_PROVIDER=silero-http
VAD_BASE_URL=http://127.0.0.1:9010/vad
STT_PROVIDER=whisper-http
STT_BASE_URL=http://127.0.0.1:9010/stt
TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9010/tts
```

TTS is intentionally command-adapter based so a self-hosted engine can be benchmarked without coupling domain code to one vendor. `TTS_COMMAND` must contain `{text_file}` and `{output_wav}` placeholders. Example shape only:

```text
<tts-executable> ... --input {text_file} ... --output {output_wav}
```

Do not commit model files, voices, actor assets, FFmpeg binaries or local secrets.

Start:

```powershell
npm run media-worker:dev
```

Contract checks:

```powershell
npm run whisper:contract:check
npm run ffmpeg:contract:check
npm run media-worker:test
```

The FFmpeg tests use the current Python interpreter as a controlled fake child process. They cover command construction, success, non-zero exit, timeout, cancellation, output validation, diagnostics and cleanup without invoking or installing FFmpeg. These tests do not count as real FFmpeg runtime/Gate F evidence.

## Brain → TTS rule

The core API TTS endpoint does not accept arbitrary client text. It takes only session/media-session/turn IDs, loads a finalized persisted `interview_turns.spoken_text`, then calls `/tts/synthesize`. This preserves the Master invariant that only approved Interview Brain speech reaches TTS/avatar.

## Hard boundaries

- Interview Brain owns interview strategy; avatar/rendering never owns intelligence.
- Only finalized transcript text reaches the Brain.
- Raw candidate audio/video is not persisted by the core API or worker.
- Candidate video is not used for emotion, honesty, personality, confidence or suitability inference.
- Provider credentials and LiveKit access tokens are not persisted.
- Recording is separate from transport and requires explicit consent/policy approval.
- Evaluator consumes persisted finalized evidence; it never scores live media frames.
- Fake-process FFmpeg tests prove integration semantics only; real codec/runtime quality, resource usage and failure evidence remain deployment-specific.
