# Ava-82M Persian CPU TTS Worker

This worker is the preferred local Persian TTS runtime for the Interview project. It wraps [xmanii/Ava-82M](https://huggingface.co/xmanii/Ava-82M) behind the existing `tts-synthesis.v1` HTTP contract.

Ava-82M v0.2.0 is an Apache-2.0 Persian Kokoro fine-tune with a contextual Persian G2P frontend, pronunciation overrides, number/date normalization and 24 kHz mono output. The project forces the runtime to CPU so a GPU is not required and developer machines behave consistently.

## Windows setup

The Ava 0.2.0 package declares Python 3.11–3.13, but it pins `numpy==1.26.4`. On Windows, NumPy 1.26.4 has binary wheels for Python 3.11/3.12 but not 3.13, so this project intentionally uses 64-bit Python 3.11 or 3.12 for a reproducible binary-only setup. The rest of the repository may use a newer Python because Ava runs in its own isolated environment.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-ava-tts-windows.ps1
```

Install Python 3.12 if it is not already present:

```powershell
winget install --id Python.Python.3.12 -e
```

If `.venv-ava-tts` was previously created with Python 3.13, the setup script detects that and recreates only the Ava virtual environment with Python 3.12.

The setup script deliberately downloads PyTorch from PyPI instead of `download.pytorch.org`, because managed corporate networks can return HTTP 403 from PyTorch's R2 download host. The Windows PyPI wheel is the exact `torch==2.6.0` version pinned by Ava, and the worker explicitly loads Ava with `device="cpu"`.

The setup script:

- creates `.venv-ava-tts`;
- installs the official Windows `torch==2.6.0` wheel from PyPI and forces Ava inference to CPU;
- preinstalls the `numpy==1.26.4` Windows binary wheel so pip never attempts a source build;
- installs a pinned Ava-82M v0.2.0 wheel;
- installs the Windows certificate-store bridge for managed/corporate TLS networks;
- verifies that Ava imports correctly.

The first worker start downloads the Ava acoustic model and pinned Persian G2P artifacts into the user cache. Later starts use the local cache.

## Run

Normally use the project orchestrator:

```powershell
.\start-all.ps1
```

Ava is now the default TTS selection. To run only this worker:

```powershell
npm run ava-tts-worker:dev
```

Default endpoint:

```text
http://127.0.0.1:9022
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:9022/health | Format-List
```

Expected fields include:

```text
provider    : ava-82m-persian-cpu
device      : cpu
model       : xmanii/Ava-82M
modelVersion: 0.2.0
contentType : audio/wav
sampleRate  : 24000
ready       : True
```

## Pronunciation path

When the API detects `ava-82m-persian-cpu` in TTS readiness, it sends the canonical finalized Persian interview text directly to Ava instead of running the separate LLM diacritization pass. Ava already contains a contextual Persian G2P and pronunciation-correction frontend; keeping the canonical text avoids redundant diacritics and removes an extra LLM request from the speech latency path.

Technical terms such as `.NET`, `API`, `Docker`, `Redis` and common English engineering vocabulary receive a speech-only normalization in `fa_tech_normalizer.py` before entering Ava.

## Fallback

Edge TTS remains available for comparison or fallback:

```powershell
.\stop-all.ps1
.\start-all.ps1 -TtsEngine edge-tts
```

The older local-command/Piper adapter also remains available explicitly:

```powershell
.\start-all.ps1 -TtsEngine local-command
```

## Privacy and licensing

Ava code and weights are Apache-2.0. Its documented upstreams include Kokoro-82M (Apache-2.0), Mana-TTS (CC0-1.0) and Homo-GE2PE-Persian (MIT).

After the model and G2P artifacts have been cached, inference is local. The worker does not persist synthesized interview text or audio. It logs request IDs, output byte counts and timing, but not spoken text.
