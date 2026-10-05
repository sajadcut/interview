# Ava-82M Persian CPU TTS Worker

This worker is the preferred local Persian TTS runtime for the Interview project. It wraps [xmanii/Ava-82M](https://huggingface.co/xmanii/Ava-82M) behind the existing `tts-synthesis.v1` HTTP contract.

Ava-82M v0.2.0 is an Apache-2.0 Persian Kokoro fine-tune with a contextual Persian G2P frontend, pronunciation overrides, number/date normalization and 24 kHz mono output. The project forces the runtime to CPU so a GPU is not required and developer machines behave consistently.

## Windows setup

Ava 0.2.0 officially declares Python 3.11–3.13. This project intentionally runs the Windows worker on 64-bit Python 3.13. Ava 0.2.0 pins `numpy==1.26.4` and `sentencepiece==0.2.0`; those two releases do not provide CPython 3.13 Windows wheels, so the setup uses `numpy==2.1.3` and `sentencepiece==0.2.2`. There is a second packaging mismatch: the published PyPI `misaki==0.9.4` metadata requires Python <3.13, while upstream Misaki commit `fba1236595f2d2bf21d414ba6e57d25256afada3` is specifically the Python 3.13 enablement commit and was tested with Kokoro. The setup installs that Misaki revision without the heavy `[en]` extra. Kokoro imports `misaki.en` and `misaki.espeak` at module import time, so the setup separately pins only their required runtime imports: `spacy==3.8.16`, `num2words==0.5.14`, `phonemizer-fork==3.3.2`, and `espeakng-loader==0.2.4`. It intentionally omits `spacy-curated-transformers`, because Ava uses its own Persian frontend and never enables Misaki's transformer English G2P path. Ava's exact Kokoro revision is then installed with `--no-deps`. These are explicit compatibility overrides and should be treated as experimental until representative synthesis tests pass.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-ava-tts-windows.ps1
```

Python 3.13 is the expected Windows runtime:

```powershell
py -3.13 --version
```

If it is not installed:

```powershell
winget install --id Python.Python.3.13 -e
```

If `.venv-ava-tts` was previously created with another Python version, the setup script recreates only that isolated Ava environment with Python 3.13.

The setup script deliberately downloads PyTorch from PyPI instead of `download.pytorch.org`, because managed corporate networks can return HTTP 403 from PyTorch's R2 download host. The Windows PyPI wheel is the exact `torch==2.6.0` version pinned by Ava, and the worker explicitly loads Ava with `device="cpu"`.

The setup script:

- creates `.venv-ava-tts`;
- installs the official Windows `torch==2.6.0` wheel from PyPI and forces Ava inference to CPU;
- installs CPython 3.13 binary wheels `numpy==2.1.3` and `sentencepiece==0.2.2` as compatibility overrides;
- installs upstream Misaki commit `fba1236`, which explicitly enables Python 3.13, without the `[en]` transformer extra;
- pins the minimal Kokoro import dependencies to CPython-3.13-compatible wheels and intentionally excludes `spacy-curated-transformers`;
- installs Ava's pinned Kokoro revision with `--no-deps` to avoid PyPI's Python<3.13 Misaki resolver;
- keeps Click, Hugging Face Hub, SoundFile, Transformers, Torch, and the Kokoro revision aligned with Ava v0.2.0;
- installs the pinned Ava-82M v0.2.0 wheel with `--no-deps` so its stale native pins do not force source builds;
- installs the Windows certificate-store bridge for managed/corporate TLS networks;
- verifies that Ava imports correctly;
- by default loads the real Ava model on CPU and synthesizes a short Persian sentence; setup fails if the model cannot generate non-empty 24 kHz audio.

The setup script now performs the first real model/G2P download itself as part of an end-to-end Persian synthesis smoke test. Later worker starts use the local cache. Import success alone is not treated as proof that the runtime works. For troubleshooting only, the real synthesis check can be skipped with `-SkipRuntimeSmokeTest`; that mode does not provide runtime assurance.

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
