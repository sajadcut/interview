$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Venv = Join-Path $RepoRoot ".venv-ava-tts"
$WheelUrl = "https://huggingface.co/xmanii/Ava-82M/resolve/24160e40cf970dc1b3dc245184e45d48e0fe89a9/ava_tts-0.2.0-py3-none-any.whl#sha256=eabc71ee86f1ffc78b763708523842490746c7b712f690269f519adacd73aad0"
$PyPiIndex = "https://pypi.org/simple"

Write-Host "== Ava-82M Persian CPU TTS setup =="

function Test-AvaPythonRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$PrefixArgs = @()
    )

    # Ava declares Python 3.11-3.13. This Windows setup intentionally targets
    # CPython 3.13 and replaces two stale binary pins from Ava 0.2.0 with
    # CPython-3.13-compatible wheels while keeping the rest of the stack pinned.
    $probe = "import struct,sys; bits=struct.calcsize('P')*8; ok=(sys.version_info[:2] == (3,13) and bits == 64); print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'.'+str(sys.version_info.micro)+'|'+str(bits)); raise SystemExit(0 if ok else 2)"

    try {
        $result = & $Command @PrefixArgs -c $probe 2>$null
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0 -and $result) {
            return [PSCustomObject]@{
                Command = $Command
                PrefixArgs = $PrefixArgs
                Description = ([string]$result).Trim()
            }
        }
    } catch {
        return $null
    }
    return $null
}

$PythonRuntime = $null

if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($version in @("3.13")) {
        $candidate = Test-AvaPythonRuntime -Command "py" -PrefixArgs @("-$version")
        if ($candidate) {
            $PythonRuntime = $candidate
            break
        }
    }
}

if (-not $PythonRuntime -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $PythonRuntime = Test-AvaPythonRuntime -Command "python"
}

if (-not $PythonRuntime -and (Get-Command python3 -ErrorAction SilentlyContinue)) {
    $PythonRuntime = Test-AvaPythonRuntime -Command "python3"
}

if (-not $PythonRuntime) {
    Write-Host ""
    Write-Host "This Ava Windows setup requires 64-bit Python 3.13."
    if (Get-Command py -ErrorAction SilentlyContinue) {
        Write-Host "Detected Python Launcher environments:"
        & py -0p
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        Write-Host "python on PATH:"
        & python --version
    }
    Write-Host ""
    Write-Host "Recommended Windows install command:"
    Write-Host "winget install --id Python.Python.3.13 -e"
    throw "No compatible 64-bit Python 3.13 runtime was found."
}

Write-Host "Using Python $($PythonRuntime.Description) via: $($PythonRuntime.Command) $($PythonRuntime.PrefixArgs -join ' ')"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found. Ava's pinned Kokoro dependency is installed from GitHub."
}

$VenvPython = Join-Path $Venv "Scripts\python.exe"
if (Test-Path -LiteralPath $VenvPython -PathType Leaf) {
    & $VenvPython -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,13) else 2)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Existing Ava environment uses an incompatible Python. Recreating it with Python $($PythonRuntime.Description)..."
        Remove-Item -LiteralPath $Venv -Recurse -Force
    }
}

if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
    Write-Host "Creating isolated Python environment..."
    & $PythonRuntime.Command @($PythonRuntime.PrefixArgs) -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Ava virtual environment." }
}

$Python = $VenvPython
Write-Host "Installing PyTorch 2.6.0 for the CPU-forced Ava runtime..."
& $Python -m pip install --index-url $PyPiIndex --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }

# Corporate Windows networks often terminate TLS with an internal root CA. Keep
# verification enabled and bridge Python to the Windows certificate store.
& $Python -m pip install --index-url $PyPiIndex "pip-system-certs>=4,<6"
if ($LASTEXITCODE -ne 0) { throw "Windows certificate-store bridge installation failed." }

# Do not use download.pytorch.org here. Some managed networks allow PyPI but
# block PyTorch's R2 download host with HTTP 403. PyPI publishes the official
# CPython 3.13 Windows x64 torch==2.6.0 wheel required by Ava. The worker itself
# still forces device="cpu", so a CUDA-capable GPU is neither required nor used.
& $Python -m pip install --index-url $PyPiIndex --only-binary=:all: "torch==2.6.0"
if ($LASTEXITCODE -ne 0) { throw "PyTorch 2.6.0 installation from PyPI failed." }

& $Python -c "import torch; x=torch.ones(1, device='cpu'); print('torch', torch.__version__, 'device', x.device, 'cuda-available', torch.cuda.is_available()); assert x.device.type == 'cpu'"
if ($LASTEXITCODE -ne 0) { throw "PyTorch CPU execution verification failed." }

# Ava 0.2.0 declares Python 3.13 support but pins numpy==1.26.4 and
# sentencepiece==0.2.0, neither of which ships a CPython 3.13 Windows wheel.
# Earlier Ava metadata used the compatible ranges numpy>=1.26,<3 and
# sentencepiece>=0.2,<1. Use modern wheels inside those original ranges, then
# install the reviewed Ava wheel with --no-deps so pip does not force the stale
# binary pins back in.
Write-Host "Installing CPython 3.13 compatibility overrides..."
& $Python -m pip install --index-url $PyPiIndex --only-binary=:all: `
    "numpy==2.1.3" `
    "sentencepiece==0.2.2"
if ($LASTEXITCODE -ne 0) {
    throw "Ava Python 3.13 compatibility wheels failed to install."
}

Write-Host "Installing Ava's validated runtime versions..."
& $Python -m pip install --index-url $PyPiIndex `
    "click==8.2.1" `
    "huggingface-hub==0.34.4" `
    "soundfile==0.13.1" `
    "transformers==4.51.3"
if ($LASTEXITCODE -ne 0) { throw "Ava runtime dependency installation failed." }

# PyPI misaki 0.9.4 declares Python <3.13, while the upstream Misaki
# repository contains a verified Python 3.13 enablement commit. Install that
# exact revision with English extras because Kokoro imports misaki.en/espeak
# at module import time even though Ava uses its own Persian frontend.
Write-Host "Installing Python 3.13-enabled Misaki runtime..."
& $Python -m pip install --index-url $PyPiIndex `
    "misaki[en] @ git+https://github.com/hexgrad/misaki.git@fba1236595f2d2bf21d414ba6e57d25256afada3"
if ($LASTEXITCODE -ne 0) { throw "Python 3.13 Misaki installation failed." }

# Install Ava's exact Kokoro revision without dependency resolution. Its
# metadata asks pip for misaki>=0.9.4 from PyPI, whose published 0.9.4 metadata
# rejects Python 3.13. The pinned Git revision above is still version 0.9.4 and
# is the upstream fix that explicitly enables Python 3.13.
Write-Host "Installing Ava's pinned Kokoro runtime..."
& $Python -m pip install --no-deps `
    "git+https://github.com/semidark/kokoro.git@b96fef95e6a746495f92443fac7c688f90fc57fc"
if ($LASTEXITCODE -ne 0) { throw "Pinned Kokoro runtime installation failed." }

Write-Host "Installing Ava-82M package without stale binary pins..."
& $Python -m pip install --no-deps $WheelUrl
if ($LASTEXITCODE -ne 0) { throw "Ava-82M installation failed." }

Write-Host "Verifying CPU runtime..."
& $Python -c "import importlib.metadata as m, numpy, sentencepiece, torch, soundfile, misaki, kokoro; from ava_tts import Ava; print('python-compat override: numpy', numpy.__version__, 'sentencepiece', sentencepiece.__version__, 'misaki', m.version('misaki'), 'kokoro', m.version('kokoro')); print('torch', torch.__version__, 'cuda-available', torch.cuda.is_available()); print('Ava', m.version('ava-tts'), 'import OK; worker forces device=cpu')"
if ($LASTEXITCODE -ne 0) {
    throw "Ava CPU runtime verification failed."
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Python: $Python"
Write-Host ""
Write-Host "Next command:"
Write-Host "powershell -ExecutionPolicy Bypass -File scripts/start-ava-tts-worker.ps1"
Write-Host ""
Write-Host "Python 3.13 compatibility override: numpy 2.1.3 + sentencepiece 0.2.2 + Misaki fba1236."
Write-Host "The first worker start downloads the Ava model and Persian G2P files to the local Hugging Face cache."
