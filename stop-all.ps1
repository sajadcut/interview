[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $repoRoot ".local-data\dev-stack-processes.json"

if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host "No tracked Interview development stack was found."
    exit 0
}

try {
    $loaded = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $tracked = @($loaded)
}
catch {
    Write-Warning "Could not read process state: $stateFile"
    Write-Warning "No processes were stopped automatically."
    exit 1
}

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

$failed = @()

# Stop in reverse startup order so the Web/API process goes down before its realtime dependencies.
foreach ($entry in @($tracked)[($tracked.Count - 1)..0]) {
    if (-not $entry.ProcessId) {
        continue
    }

    $processId = [int]$entry.ProcessId
    $name = if ($entry.Name) { [string]$entry.Name } else { "unknown" }

    if (-not (Test-ProcessIsRunning -ProcessId $processId)) {
        Write-Host "[stopped] $name (PID $processId was already gone)"
        continue
    }

    try {
        if (Get-Command taskkill.exe -ErrorAction SilentlyContinue) {
            & taskkill.exe /PID $processId /T /F | Out-Null
            if ($LASTEXITCODE -ne 0 -and (Test-ProcessIsRunning -ProcessId $processId)) {
                throw "taskkill exited with code $LASTEXITCODE"
            }
        }
        else {
            Stop-Process -Id $processId -Force -ErrorAction Stop
        }

        Write-Host "[stopped] $name (PID $processId)"
    }
    catch {
        $failed += $entry
        Write-Warning "Could not stop $name (PID $processId): $($_.Exception.Message)"
    }
}

if ($failed.Count -eq 0) {
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Interview development stack stopped, including tracked LiveKit."
    exit 0
}

$failed | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Warning "Some tracked services are still running. Re-run .\stop-all.ps1 after resolving the errors above."
exit 1
