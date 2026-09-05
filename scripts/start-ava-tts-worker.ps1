$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Python = Join-Path $RepoRoot ".venv-ava-tts\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    throw "Ava virtual environment is missing. Run scripts/setup-ava-tts-windows.ps1 first."
}

Set-Location $RepoRoot
$env:AVA_TTS_WORKER_HOST = "127.0.0.1"
$env:AVA_TTS_WORKER_PORT = "9022"
& $Python "services/ava-tts-worker/server.py"
