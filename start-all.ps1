[CmdletBinding()]
param(
    [string]$LiveKitCommand = "livekit-server",
    [string[]]$LiveKitArgs = @("--dev")
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDirectory = Join-Path $repoRoot ".local-data"
$stateFile = Join-Path $stateDirectory "dev-stack-processes.json"
$shellPath = (Get-Process -Id $PID).Path

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found on PATH. Install the repository Node/npm toolchain first."
}

$liveKitExecutable = $null
if (Test-Path -LiteralPath $LiveKitCommand -PathType Leaf) {
    $liveKitExecutable = (Resolve-Path -LiteralPath $LiveKitCommand).Path
}
else {
    $liveKitApplication = Get-Command $LiveKitCommand -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $liveKitApplication) {
        $liveKitExecutable = $liveKitApplication.Source
    }
}

if (-not $liveKitExecutable) {
    throw "LiveKit server executable '$LiveKitCommand' was not found. Install livekit-server or pass -LiveKitCommand with the full executable path."
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

function ConvertTo-SingleQuotedPowerShellArgument {
    param([string]$Value)

    return "'" + $Value.Replace("'", "''") + "'"
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

# Start realtime dependencies before the Web/API process so local candidate interviews
# can connect immediately when the application becomes available.
$services = @(
    [pscustomobject]@{
        Name       = "livekit"
        Kind       = "external"
        Executable = $liveKitExecutable
        Arguments  = @($LiveKitArgs)
        Title      = "Interview - LiveKit"
        Display    = "$LiveKitCommand $($LiveKitArgs -join ' ')".Trim()
    },
    [pscustomobject]@{
        Name      = "media"
        Kind      = "npm"
        NpmScript = "media-worker:dev"
        Title     = "Interview - Media / Whisper"
        Display   = "npm run media-worker:dev"
    },
    [pscustomobject]@{
        Name      = "vad"
        Kind      = "npm"
        NpmScript = "vad-worker:dev"
        Title     = "Interview - Silero VAD"
        Display   = "npm run vad-worker:dev"
    },
    [pscustomobject]@{
        Name      = "tts"
        Kind      = "npm"
        NpmScript = "tts-worker:dev"
        Title     = "Interview - Piper TTS"
        Display   = "npm run tts-worker:dev"
    },
    [pscustomobject]@{
        Name      = "app"
        Kind      = "npm"
        NpmScript = "dev"
        Title     = "Interview - Web + API"
        Display   = "npm run dev"
    }
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

    if ($service.Kind -eq "npm") {
        $command = "Set-Location -LiteralPath '$escapedRoot'; `$Host.UI.RawUI.WindowTitle = '$escapedTitle'; npm run $($service.NpmScript)"
    }
    else {
        $quotedExecutable = ConvertTo-SingleQuotedPowerShellArgument -Value ([string]$service.Executable)
        $quotedArguments = @($service.Arguments | ForEach-Object {
            ConvertTo-SingleQuotedPowerShellArgument -Value ([string]$_)
        }) -join " "
        $command = "Set-Location -LiteralPath '$escapedRoot'; `$Host.UI.RawUI.WindowTitle = '$escapedTitle'; & $quotedExecutable $quotedArguments"
    }

    $process = Start-Process `
        -FilePath $shellPath `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
        -WorkingDirectory $repoRoot `
        -PassThru

    $nextState += [pscustomobject]@{
        Name       = $service.Name
        Kind       = $service.Kind
        Command    = $service.Display
        ProcessId  = $process.Id
        StartedAt  = (Get-Date).ToString("o")
    }

    $startedCount++
    Write-Host "[started] $($service.Name) -> $($service.Display) (PID $($process.Id))"
    Start-Sleep -Milliseconds 300
}

$nextState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ""
if ($startedCount -eq 0) {
    Write-Host "Interview development stack is already running."
}
else {
    Write-Host "Interview development stack started."
}
Write-Host "LiveKit: ws://127.0.0.1:7880 (default --dev mode)"
Write-Host "Web:     http://localhost:3000"
Write-Host "Stop the complete tracked stack with: .\stop-all.ps1"
Write-Host ""
Write-Host "If your LiveKit installation is not on PATH, run for example:"
Write-Host '.\start-all.ps1 -LiveKitCommand "D:\path\to\livekit-server.exe"'
