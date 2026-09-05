$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Venv = Join-Path $RepoRoot ".venv-ava-tts"
$WheelUrl = "https://huggingface.co/xmanii/Ava-82M/resolve/main/ava_tts-0.2.0-py3-none-any.whl"

Write-Host "== Ava-82M Persian CPU TTS setup =="

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Windows Python launcher 'py' was not found. Install Python 3.12 x64 first."
}

& py -3.12 --version
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.12 x64 is required for the isolated Ava environment."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found. Ava's pinned Kokoro dependency is installed from GitHub."
}

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
    Write-Host "Creating isolated Python environment..."
    & py -3.12 -m venv $Venv
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
