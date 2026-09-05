$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkspaceRoot = Split-Path $RepoRoot -Parent
$ModelsRoot = Join-Path $WorkspaceRoot "models"
$MossRepo = Join-Path $ModelsRoot "MOSS-TTS"
$Venv = Join-Path $RepoRoot ".venv-moss-tts"

Write-Host "== MOSS Persian TTS preflight =="

if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    throw "nvidia-smi was not found. This A/B test requires an NVIDIA CUDA GPU."
}

$gpuLine = (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits | Select-Object -First 1)
if (-not $gpuLine) {
    throw "No NVIDIA GPU was reported by nvidia-smi."
}
$gpuParts = $gpuLine -split ","
$gpuName = $gpuParts[0].Trim()
$gpuMemoryMb = [int]$gpuParts[1].Trim()
Write-Host "GPU: $gpuName ($gpuMemoryMb MB VRAM)"
if ($gpuMemoryMb -lt 10000) {
    Write-Warning "Less than 10 GB VRAM detected. MOSS-TTS-Realtime Persian may run out of GPU memory; the known demo target is a 16 GB T4 and the adapter was trained on a 12 GB 4070 Ti."
}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw "Windows Python launcher 'py' was not found. Install Python 3.12 x64 first."
}

& py -3.12 --version
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.12 x64 is required for the isolated MOSS environment."
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git was not found."
}

New-Item -ItemType Directory -Force -Path $ModelsRoot | Out-Null

if (-not (Test-Path $MossRepo)) {
    Write-Host "Cloning OpenMOSS/MOSS-TTS..."
    & git clone --depth 1 https://github.com/OpenMOSS/MOSS-TTS.git $MossRepo
    if ($LASTEXITCODE -ne 0) { throw "Failed to clone OpenMOSS/MOSS-TTS." }
} else {
    Write-Host "MOSS-TTS repository already exists: $MossRepo"
}

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
    Write-Host "Creating isolated Python environment..."
    & py -3.12 -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create MOSS virtual environment." }
}

$Python = Join-Path $Venv "Scripts\python.exe"
Write-Host "Installing CUDA PyTorch and MOSS Persian dependencies..."
& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& $Python -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 torch
if ($LASTEXITCODE -ne 0) { throw "CUDA PyTorch installation failed." }
& $Python -m pip install "transformers==5.0.0" peft accelerate soundfile huggingface_hub
if ($LASTEXITCODE -ne 0) { throw "MOSS dependency installation failed." }

Write-Host "Verifying CUDA from the isolated environment..."
& $Python -c "import torch; assert torch.cuda.is_available(), 'PyTorch cannot access CUDA'; print('CUDA OK:', torch.cuda.get_device_name(0), 'torch', torch.__version__)"
if ($LASTEXITCODE -ne 0) {
    throw "PyTorch installed, but CUDA is unavailable in the MOSS environment."
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "MOSS repo: $MossRepo"
Write-Host "Python:    $Python"
Write-Host ""
Write-Host "Next command:"
Write-Host "powershell -ExecutionPolicy Bypass -File scripts/start-moss-tts-worker.ps1"
Write-Host ""
Write-Host "The first worker start downloads the base model, audio tokenizer and Persian LoRA (~11 GB total according to the adapter demo)."
