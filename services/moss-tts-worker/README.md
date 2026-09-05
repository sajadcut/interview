# MOSS Persian TTS A/B worker

This service is an isolated evaluation worker for `MOSS-TTS-Realtime` + the Persian LoRA adapter. It implements the same `tts-synthesis.v1` HTTP contract as the existing local TTS worker so the API can synthesize the exact same persisted Interview Brain `spoken_text` against either engine.

It does **not** replace Piper. The existing Piper worker stays on port `9020`; this worker defaults to `9021`.

## Models

- Base: `OpenMOSS-Team/MOSS-TTS-Realtime`
- Persian adapter: `hamidfzm/MOSS-TTS-Realtime-Persian-lora`
- Codec: `OpenMOSS-Team/MOSS-Audio-Tokenizer`
- Default reference voice: `ref.wav` bundled with the Persian adapter

All model inference is local after the model files have been downloaded.

## Windows setup

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-moss-tts-windows.ps1
```

The setup script:

1. verifies an NVIDIA GPU through `nvidia-smi`;
2. creates `.venv-moss-tts` using Python 3.12;
3. installs CUDA PyTorch and the minimal realtime-demo dependencies;
4. clones `OpenMOSS/MOSS-TTS` into the workspace-level `models/MOSS-TTS` directory;
5. verifies that PyTorch can access CUDA.

The first worker startup downloads the model, codec and adapter weights. The Persian adapter demo documents roughly 11 GB of downloads and uses a T4 GPU.

## Start the isolated worker

The root `.env` must already contain either `TTS_SHARED_SECRET` or `MEDIA_WORKER_SHARED_SECRET`, matching the API.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-moss-tts-worker.ps1
```

Expected final output after model loading:

```text
MOSS Persian TTS ready
MOSS Persian TTS worker listening on http://127.0.0.1:9021
```

Check health from another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:9021/health
```

`ready` should be `True` and `provider` should be `moss-realtime-persian`.

## Run the A/B test through the real Interview Brain path

Do not post arbitrary interview text directly from the browser. Use the existing persisted Brain-turn validation path.

For MOSS, temporarily set in `.env`:

```env
TTS_PROVIDER=local-http
TTS_BASE_URL=http://127.0.0.1:9021
```

Restart only the API and use **Run Brain → TTS check** on the internal test page. The API will send the finalized persisted `spoken_text` to this worker.

To compare against Piper, switch only the URL back to:

```env
TTS_BASE_URL=http://127.0.0.1:9020
```

and restart the API again.

## Persian technical pronunciation

Before inference, this worker converts a conservative list of common English technical terms to Persian spoken forms. Examples include `backend → بک‌اند`, `API → اِی پی آی`, `PostgreSQL → پُستگرس`, `Kubernetes → کوبرنتیز`, `.NET → دات‌نِت` and `Node.js → نود جی‌اِس`.

This normalization affects only the TTS rendering. It does not mutate the rubric, evidence, transcript or persisted evaluator-facing labels.

## Optional reference voice

The model is reference-conditioned. To evaluate another Persian interviewer voice, set a clean 10–30 second Persian recording:

```env
MOSS_TTS_REFERENCE_AUDIO=D:\path\to\clean-persian-reference.wav
```

Use only a voice recording you have the right and consent to use.
