[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDirectory = Join-Path $repoRoot ".local-data"
$stateFile = Join-Path $stateDirectory "dev-stack-processes.json"
$shellPath = (Get-Process -Id $PID).Path

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found on PATH. Install the repository Node/npm toolchain first."
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".env"))) {
    Write-Warning "Root .env was not found. The services may fail until local environment variables are configured."
}

New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null

function Test-ProcessIsRunning {
    param([int]$ProcessId)

    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

$tracked = @()
if (Test-Path -LiteralPath $stateFile) {
    try {
        $loaded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        if ($null -ne $loaded) {
            $tracked = @($loaded) | Where-Object {
                $_.ProcessId -and (Test-ProcessIsRunning -ProcessId ([int]$_.ProcessId))
            }
        }
    }
    catch {
        Write-Warning "Ignoring an unreadable stale process-state file: $stateFile"
        $tracked = @()
    }
}

$services = @(
    [pscustomobject]@{ Name = "app";   NpmScript = "dev";              Title = "Interview - Web + API" },
    [pscustomobject]@{ Name = "media"; NpmScript = "media-worker:dev"; Title = "Interview - Media / Whisper" },
    [pscustomobject]@{ Name = "vad";   NpmScript = "vad-worker:dev";   Title = "Interview - Silero VAD" },
    [pscustomobject]@{ Name = "tts";   NpmScript = "tts-worker:dev";   Title = "Interview - Piper TTS" }
)

$nextState = @($tracked)
$startedCount = 0

foreach ($service in $services) {
    $alreadyRunning = @($tracked | Where-Object { $_.Name -eq $service.Name }).Count -gt 0
    if ($alreadyRunning) {
        $existing = $tracked | Where-Object { $_.Name -eq $service.Name } | Select-Object -First 1
        Write-Host "[running] $($service.Name) (PID $($existing.ProcessId))"
        continue
    }

    $escapedRoot = $repoRoot.Replace("'", "''")
    $escapedTitle = $service.Title.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$escapedRoot'; `$Host.UI.RawUI.WindowTitle = '$escapedTitle'; npm run $($service.NpmScript)"

    $process = Start-Process `
        -FilePath $shellPath `
        -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $repoRoot `
        -PassThru

    $nextState += [pscustomobject]@{
        Name       = $service.Name
        NpmScript  = $service.NpmScript
        ProcessId  = $process.Id
        StartedAt  = (Get-Date).ToString("o")
    }

    $startedCount++
    Write-Host "[started] $($service.Name) -> npm run $($service.NpmScript) (PID $($process.Id))"
    Start-Sleep -Milliseconds 200
}

$nextState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ""
if ($startedCount -eq 0) {
    Write-Host "Interview development stack is already running."
}
else {
    Write-Host "Interview development stack started."
}
Write-Host "Web: http://localhost:3000"
Write-Host "Stop tracked services with: .\stop-all.ps1"
Write-Host ""
Write-Host "Note: LiveKit is intentionally not managed here because it is an external realtime service, not an npm worker."
