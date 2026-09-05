$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$WorkspaceRoot = Split-Path $RepoRoot -Parent
$DefaultMossRepo = Join-Path (Join-Path $WorkspaceRoot "models") "MOSS-TTS"
$Python = Join-Path $RepoRoot ".venv-moss-tts\Scripts\python.exe"
$Server = Join-Path $RepoRoot "services\moss-tts-worker\server.py"

if (-not (Test-Path $Python)) {
    throw "MOSS virtual environment is missing. Run scripts/setup-moss-tts-windows.ps1 first."
}

if (-not $env:MOSS_TTS_REPO_DIR) {
    $env:MOSS_TTS_REPO_DIR = $DefaultMossRepo
}
if (-not $env:MOSS_TTS_WORKER_HOST) {
    $env:MOSS_TTS_WORKER_HOST = "127.0.0.1"
}
if (-not $env:MOSS_TTS_WORKER_PORT) {
    $env:MOSS_TTS_WORKER_PORT = "9021"
}

Write-Host "Starting MOSS Persian TTS worker"
Write-Host "Repo: $env:MOSS_TTS_REPO_DIR"
Write-Host "URL:  http://$env:MOSS_TTS_WORKER_HOST`:$env:MOSS_TTS_WORKER_PORT"
Write-Host "The first start may download model weights from Hugging Face."

& $Python $Server
exit $LASTEXITCODE
