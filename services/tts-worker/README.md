# Standalone TTS Worker

`services/tts-worker` is the provider-neutral text-to-speech boundary used by the interview runtime. The default engine is now Microsoft Edge neural TTS with the Persian male voice `fa-IR-FaridNeural`. It requires network access but no local GPU. The previous local command/Piper path remains available only as an explicit fallback.

The worker exposes:

```text
GET  /health
POST /synthesize
```

The versioned contract is `contracts/tts-synthesis.v1.json`. `POST /synthesize` requires `x-tts-contract-version`, `x-request-id` and the shared secret. The worker accepts only the finalized server-side interview `spokenText`; browser-supplied arbitrary TTS text is not accepted by the core interview flow.

## Default Edge neural engine

Install the worker dependency:

```powershell
python -m pip install -r services/tts-worker/requirements.txt
```

On managed Windows networks that use a corporate TLS interception/root CA, Python may also need the Windows certificate store bridge:

```powershell
python -m pip install pip-system-certs
```

The worker now uses the installed `edge-tts` Python module directly in-process rather than spawning the CLI executable. This avoids Windows child-process/socket failures while keeping the same Persian neural voice.

Configuration:

```env
TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9020

TTS_ENGINE=edge-tts
TTS_EDGE_VOICE=fa-IR-FaridNeural
TTS_EDGE_RATE=+0%
TTS_EDGE_VOLUME=+0%
TTS_EDGE_PITCH=+0Hz
TTS_EDGE_PROXY=

TTS_TIMEOUT_SECONDS=60
TTS_TERMINATION_GRACE_SECONDS=2
TTS_WORK_ROOT=
MEDIA_WORKER_SHARED_SECRET=<local-secret>
```

Start it with:

```powershell
npm run tts-worker:dev
```

Expected health metadata includes:

```text
provider: edge-tts
contentType: audio/mpeg
voice: fa-IR-FaridNeural
ready: true
```

Edge TTS outputs MP3. The worker collects the module's audio stream in-process, validates the MP3 signature and size, and the API streams `audio/mpeg` directly to the browser. No local FFmpeg conversion is required.

## Legacy local/Piper fallback

The old command adapter is still available for offline fallback:

```env
TTS_ENGINE=local-command
TTS_COMMAND=<tts-executable> ... --input {text_file} ... --output {output_wav}
```

The command template must contain exactly `{text_file}` and `{output_wav}`; the engine must read UTF-8 text from the first path and produce WAV in the second path. The process is still launched with `shell=false`, bounded timeouts and owned temporary workspaces.

## Privacy boundary

The worker does not persist text or audio. With `edge-tts`, the synthesized interviewer text is sent to Microsoft's online Edge speech service, so this engine is not an offline/private-local provider. Keep Piper/local-command available for deployments whose policy prohibits sending synthesized interviewer text to an external speech service.

## Tests

```bash
npm run tts:contract:check
npm run tts-worker:test
```

Contract tests do not call the real Edge service. They exercise local command safety, media validation and API compatibility without requiring a GPU or external network.
