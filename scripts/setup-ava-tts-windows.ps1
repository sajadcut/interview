$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Venv = Join-Path $RepoRoot ".venv-ava-tts"
$WheelUrl = "https://huggingface.co/xmanii/Ava-82M/resolve/main/ava_tts-0.2.0-py3-none-any.whl"

Write-Host "== Ava-82M Persian CPU TTS setup =="

function Test-AvaPythonRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string[]]$PrefixArgs = @()
    )

    try {
        $result = & $Command @PrefixArgs -c "import struct,sys; ok=(sys.version_info[:2] >= (3,11) and sys.version_info[:2] < (3,14) and struct.calcsize('P')*8 == 64); print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}|{struct.calcsize(\"P\")*8}'); raise SystemExit(0 if ok else 2)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $result) {
            return [PSCustomObject]@{
                Command = $Command
                PrefixArgs = $PrefixArgs
                Description = $result.Trim()
            }
        }
    } catch {
        return $null
    }
    return $null
}

$PythonRuntime = $null

if (Get-Command py -ErrorAction SilentlyContinue) {
    foreach ($version in @("3.13", "3.12", "3.11")) {
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
    Write-Host "Ava requires a 64-bit Python version from 3.11 through 3.13."
    if (Get-Command py -ErrorAction SilentlyContinue) {
        Write-Host "Detected Python Launcher environments:"
        & py -0p
    }
    if (Get-Command python -ErrorAction SilentlyContinue) {
        Write-Host "python on PATH:"
        & python --version
    }
    throw "No compatible 64-bit Python 3.11-3.13 runtime was found."
}

Write-Host "Using Python $($PythonRuntime.Description) via: $($PythonRuntime.Command) $($PythonRuntime.PrefixArgs -join ' ')"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found. Ava's pinned Kokoro dependency is installed from GitHub."
}

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
    Write-Host "Creating isolated Python environment..."
    & $PythonRuntime.Command @($PythonRuntime.PrefixArgs) -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create Ava virtual environment." }
}

$Python = Join-Path $Venv "Scripts\python.exe"
Write-Host "Installing CPU-only PyTorch..."
& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $Python -m pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.6.0"
if ($LASTEXITCODE -ne 0) { throw "CPU PyTorch installation failed." }

Write-Host "Installing Ava-82M and pinned Persian frontend dependencies..."
& $Python -m pip install $WheelUrl
if ($LASTEXITCODE -ne 0) { throw "Ava-82M installation failed." }

Write-Host "Verifying CPU runtime..."
& $Python -c "import torch; from ava_tts import Ava; print('torch', torch.__version__, 'cuda', torch.cuda.is_available()); assert not torch.cuda.is_available(); print('Ava import OK')"
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
