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

    # Ava 0.2.0 declares Python 3.11-3.13, but it pins numpy==1.26.4.
    # NumPy 1.26.4 has Windows binary wheels through CPython 3.12, not 3.13.
    # Requiring 3.11/3.12 keeps setup binary-only and avoids a fragile source build.
    $probe = "import struct,sys; bits=struct.calcsize('P')*8; ok=((3,11) <= sys.version_info[:2] < (3,13) and bits == 64); print(str(sys.version_info.major)+'.'+str(sys.version_info.minor)+'.'+str(sys.version_info.micro)+'|'+str(bits)); raise SystemExit(0 if ok else 2)"

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
    foreach ($version in @("3.12", "3.11")) {
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
    Write-Host "Ava setup requires 64-bit Python 3.11 or 3.12."
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
    Write-Host "winget install --id Python.Python.3.12 -e"
    throw "No compatible 64-bit Python 3.11-3.12 runtime was found. Python 3.13 is intentionally not used because Ava 0.2.0 pins numpy==1.26.4, which has no CPython 3.13 Windows wheel."
}

Write-Host "Using Python $($PythonRuntime.Description) via: $($PythonRuntime.Command) $($PythonRuntime.PrefixArgs -join ' ')"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found. Ava's pinned Kokoro dependency is installed from GitHub."
}

$VenvPython = Join-Path $Venv "Scripts\python.exe"
if (Test-Path -LiteralPath $VenvPython -PathType Leaf) {
    & $VenvPython -c "import sys; raise SystemExit(0 if (3,11) <= sys.version_info[:2] < (3,13) else 2)" 2>$null
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

# Ava 0.2.0 pins numpy==1.26.4. Install it as a binary wheel before Ava so pip
# never falls back to a source build (which fails on CPython 3.13 and is slow/
# brittle on managed Windows machines).
Write-Host "Installing NumPy 1.26.4 binary wheel..."
& $Python -m pip install --index-url $PyPiIndex --only-binary=:all: "numpy==1.26.4"
if ($LASTEXITCODE -ne 0) {
    throw "NumPy 1.26.4 binary wheel installation failed. Use Python 3.11 or 3.12 for Ava."
}

Write-Host "Installing Ava-82M and pinned Persian frontend dependencies..."
& $Python -m pip install --index-url $PyPiIndex $WheelUrl
if ($LASTEXITCODE -ne 0) { throw "Ava-82M installation failed." }

Write-Host "Verifying CPU runtime..."
& $Python -c "import torch, soundfile; from ava_tts import Ava; print('torch', torch.__version__, 'cuda-available', torch.cuda.is_available()); print('Ava import OK; worker forces device=cpu')"
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
Write-Host "The first worker start downloads the Ava model and Persian G2P files to the local Hugging Face cache."
