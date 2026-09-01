# Media Worker

The media worker owns realtime speech/media mechanics for M4. It is separate from the Interview Brain and evaluator.

## Implemented executable boundary

`server.py` is a local-native HTTP worker that can start without Docker. It loads the repository root `.env`, exposes component-specific health, accepts WAV audio for VAD/STT, and never logs request bodies/transcript text.

```text
GET  /health
GET  /vad/health
GET  /stt/health
GET  /tts/health
POST /vad/analyze      Content-Type: audio/wav
POST /stt/finalize     Content-Type: audio/wav
```

The STT endpoint invokes local `whisper-cli` and requires an actual output file; exit code 0 alone is not considered success. Only finalized transcript text is returned to the caller. Raw audio is held in a temporary directory and deleted after the request.

## Local runtime

Install Python dependencies into a local virtual environment:

```powershell
python -m venv .venv-media
.\.venv-media\Scripts\Activate.ps1
python -m pip install -r services/media-worker/requirements.txt
```

Install/build `whisper.cpp`, ensure `whisper-cli` is on PATH (or set `WHISPER_CLI`), and configure a local model path:

```env
MEDIA_WORKER_HOST=127.0.0.1
MEDIA_WORKER_PORT=9010
WHISPER_CLI=whisper-cli
WHISPER_MODEL_PATH=D:\models\whisper\ggml-medium.bin
WHISPER_LANGUAGE=auto
WHISPER_TIMEOUT_SECONDS=120

VAD_PROVIDER=silero-http
VAD_BASE_URL=http://127.0.0.1:9010/vad
STT_PROVIDER=whisper-http
STT_BASE_URL=http://127.0.0.1:9010/stt
TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9010/tts
```

Start:

```powershell
npm run media-worker:dev
```

Silero's Python runtime/model and whisper.cpp/model files are workstation dependencies; they are not committed to this repository.

## Target pipeline

```text
Candidate WebRTC
  -> LiveKit OSS + TURN where required
  -> self-hosted VAD
  -> self-hosted STT
  -> finalized transcript persistence
  -> Interview Brain
  -> spoken_text only
  -> self-hosted TTS
  -> optional avatar renderer
  -> LiveKit audio/video back to candidate
```

## Hard boundaries

- The Interview Brain owns interview strategy and structured turns; the avatar never owns intelligence.
- Only finalized transcript text reaches the Brain.
- Raw audio/video is not persisted by the core API or media-worker.
- Only `spoken_text` from a finalized Brain turn reaches TTS/avatar.
- Candidate video must not be used to infer emotion, honesty, personality, confidence or suitability.
- Provider credentials and room access tokens are not persisted in interview media tables or committed.
- Recording is separate from transport and requires explicit consent/policy approval.
- The evaluator consumes persisted finalized evidence after the interview; it does not score live media frames.
