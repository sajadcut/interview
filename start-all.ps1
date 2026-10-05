[CmdletBinding()]
param(
    [string]$LiveKitCommand = "livekit-server",
    [string[]]$LiveKitArgs = @("--dev"),
    [string]$LiveKitUrl = "ws://127.0.0.1:7880",
    [string]$LiveKitHealthUrl = "http://127.0.0.1:7880",
    [string]$ApiReadyUrl = "http://127.0.0.1:4100/health/ready",
    [int]$ApiReadyTimeoutSeconds = 90,
    [ValidateSet("edge-tts", "local-command")]
    [string]$TtsEngine = "edge-tts",
    [string]$TtsVoice = "fa-IR-FaridNeural",
    [string]$TtsHost = "127.0.0.1",
    [int]$TtsPort = 9020,
    [int]$TtsReadyTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDirectory = Join-Path $repoRoot ".local-data"
$stateFile = Join-Path $stateDirectory "dev-stack-processes.json"
$envFile = Join-Path $repoRoot ".env"
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

function Import-RootEnvironment {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        Write-Warning "Root .env was not found. The services may fail until local environment variables are configured."
        return
    }

    # start-all.ps1 is the local development entrypoint, so the repository .env is the
    # source of truth for every child process. Overwrite stale machine/user variables here
    # before starting workers and Turbo; otherwise a directly spawned Python worker can
    # inherit a different shared secret/provider URL than the API process.
    foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
            continue
        }

        $parts = $line.Split("=", 2)
        $name = $parts[0].Trim()
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
            continue
        }

        $value = $parts[1].Trim()
        if ($value.Length -ge 2) {
            $doubleQuoted = $value.StartsWith('"') -and $value.EndsWith('"')
            $singleQuoted = $value.StartsWith("'") -and $value.EndsWith("'")
            if ($doubleQuoted -or $singleQuoted) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        [Environment]::SetEnvironmentVariable(
            $name,
            $value,
            [System.EnvironmentVariableTarget]::Process
        )
    }
}

Import-RootEnvironment -Path $envFile

# The realtime interviewer is a local sidecar. Keep a development-only shared secret in
# this parent process when the developer has not configured one, so both the sidecar and
# the API child receive the same value without committing a credential.
if ([string]::IsNullOrWhiteSpace($env:AI_WORKER_SHARED_SECRET)) {
    $env:AI_WORKER_SHARED_SECRET = "local-interview-ai-worker-dev-secret"
}
if ([string]::IsNullOrWhiteSpace($env:AI_INTERVIEWER_BASE_URL)) {
    $env:AI_INTERVIEWER_BASE_URL = "http://127.0.0.1:9040"
}
if ([string]::IsNullOrWhiteSpace($env:AI_INTERVIEWER_HOST)) {
    $env:AI_INTERVIEWER_HOST = "127.0.0.1"
}
if ([string]::IsNullOrWhiteSpace($env:AI_INTERVIEWER_PORT)) {
    $env:AI_INTERVIEWER_PORT = "9040"
}
if ([string]::IsNullOrWhiteSpace($env:AI_WORKER_API_BASE_URL)) {
    $env:AI_WORKER_API_BASE_URL = "http://127.0.0.1:4100"
}

# start-all.ps1 owns the local realtime speech stack. Keep the local worker contract
# stable even when .env still contains an older Piper/MOSS experiment.
if ([string]::IsNullOrWhiteSpace($env:MEDIA_WORKER_SHARED_SECRET)) {
    $env:MEDIA_WORKER_SHARED_SECRET = "local-interview-media-worker-dev-secret"
}

$env:TTS_PROVIDER = "local-http"
$env:TTS_ENGINE = $TtsEngine
$env:TTS_WORKER_HOST = $TtsHost
$env:TTS_WORKER_PORT = [string]$TtsPort
$env:TTS_BASE_URL = "http://${TtsHost}:$TtsPort"
$env:TTS_EDGE_VOICE = $TtsVoice

if ($TtsEngine -eq "edge-tts") {
    $edgeCommand = if ([string]::IsNullOrWhiteSpace($env:TTS_EDGE_EXECUTABLE)) {
        "edge-tts"
    }
    else {
        $env:TTS_EDGE_EXECUTABLE
    }

    $edgeExecutable = $null
    if (Test-Path -LiteralPath $edgeCommand -PathType Leaf) {
        $edgeExecutable = (Resolve-Path -LiteralPath $edgeCommand).Path
    }
    else {
        $edgeApplication = Get-Command $edgeCommand -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $edgeApplication) {
            $edgeExecutable = $edgeApplication.Source
        }
    }

    if (-not $edgeExecutable) {
        throw "Edge TTS executable '$edgeCommand' was not found. Run: python -m pip install -r services\tts-worker\requirements.txt"
    }

    # Store the resolved path so the Python worker does not depend on a different PATH.
    $env:TTS_EDGE_EXECUTABLE = $edgeExecutable
}

# livekit-server --dev binds locally and uses the documented development credentials.
# Override only the LiveKit development values after importing .env so the server, API and
# browser token response all point at the same local instance.
$liveKitDevMode = @($LiveKitArgs) -contains "--dev"
if ($liveKitDevMode) {
    $env:MEDIA_REALTIME_ENABLED = "true"
    $env:MEDIA_TRANSPORT_PROVIDER = "livekit"
    $env:LIVEKIT_URL = $LiveKitUrl
    $env:LIVEKIT_HEALTH_URL = $LiveKitHealthUrl
    $env:LIVEKIT_API_KEY = "devkey"
    $env:LIVEKIT_API_SECRET = "secret"
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

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,

        [int]$TimeoutSeconds = 90
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
    $lastError = $null

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest `
                -Uri $Url `
                -UseBasicParsing `
                -TimeoutSec 3 `
                -ErrorAction Stop

            if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
                return $true
            }
        }
        catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Milliseconds 500
    }

    if ($lastError) {
        Write-Warning "HTTP readiness did not succeed at $Url within $TimeoutSeconds seconds. Last error: $lastError"
    }
    else {
        Write-Warning "HTTP readiness did not succeed at $Url within $TimeoutSeconds seconds."
    }

    return $false
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

# Start background/realtime dependencies before the Web/API process so AI jobs and
# local candidate interviews can run immediately when the application becomes available.
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
        Title     = if ($TtsEngine -eq "edge-tts") { "Interview - Edge TTS ($TtsVoice)" } else { "Interview - Local TTS" }
        Display   = "npm run tts-worker:dev [$TtsEngine]"
        ReadyUrl  = "$env:TTS_BASE_URL/health"
        ReadyTimeoutSeconds = $TtsReadyTimeoutSeconds
    },
    [pscustomobject]@{
        Name      = "ai-interviewer"
        Kind      = "npm"
        NpmScript = "ai-interviewer:dev"
        Title     = "Interview - LLM Interviewer"
        Display   = "npm run ai-interviewer:dev"
    },
    [pscustomobject]@{
        Name      = "app"
        Kind      = "npm"
        NpmScript = "dev"
        Title     = "Interview - Web + API"
        Display   = "npm run dev"
    },
    [pscustomobject]@{
        Name      = "ai-worker"
        Kind      = "npm"
        NpmScript = "ai-worker:dev"
        Title     = "Interview - AI Worker"
        Display   = "npm run ai-worker:dev"
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

    if ($service.Name -eq "ai-worker") {
        Write-Host "[waiting] API readiness: $ApiReadyUrl"
        if (-not (Wait-HttpReady -Url $ApiReadyUrl -TimeoutSeconds $ApiReadyTimeoutSeconds)) {
            Write-Warning "AI Worker was not started because the API is not ready. Fix the API and re-run .\start-all.ps1."
            continue
        }
        Write-Host "[ready] API is ready; starting AI Worker."
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

    try {
        $startedAt = (Get-Process -Id $process.Id -ErrorAction Stop).StartTime.ToUniversalTime().ToString("o")
    }
    catch {
        $startedAt = (Get-Date).ToUniversalTime().ToString("o")
    }

    $nextState += [pscustomobject]@{
        Name       = $service.Name
        Kind       = $service.Kind
        Command    = $service.Display
        ProcessId  = $process.Id
        StartedAt  = $startedAt
    }

    $startedCount++
    Write-Host "[started] $($service.Name) -> $($service.Display) (PID $($process.Id))"

    @($nextState) |
        ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $stateFile -Encoding UTF8

    Start-Sleep -Milliseconds 300

    if ($service.PSObject.Properties.Name -contains "ReadyUrl" -and $service.ReadyUrl) {
        Write-Host "[waiting] $($service.Name) readiness: $($service.ReadyUrl)"
        $readyTimeout = if (
            $service.PSObject.Properties.Name -contains "ReadyTimeoutSeconds" -and
            $service.ReadyTimeoutSeconds
        ) {
            [int]$service.ReadyTimeoutSeconds
        }
        else {
            30
        }

        if (Wait-HttpReady -Url ([string]$service.ReadyUrl) -TimeoutSeconds $readyTimeout) {
            Write-Host "[ready] $($service.Name) is ready."
        }
        else {
            Write-Warning "$($service.Name) started but is not ready yet. Check its worker window before starting an interview."
        }
    }
}

$nextState | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

Write-Host ""
if ($startedCount -eq 0) {
    Write-Host "Interview development stack is already running."
}
else {
    Write-Host "Interview development stack started."
}
if ($liveKitDevMode) {
    Write-Host "LiveKit: $LiveKitUrl (local --dev mode)"
}
else {
    Write-Host "LiveKit: managed with custom arguments; application connection settings come from the configured environment."
}
Write-Host "AI Worker:       $env:AI_WORKER_API_BASE_URL (starts only after API readiness)"
Write-Host "LLM Interviewer: $env:AI_INTERVIEWER_BASE_URL (deterministic fallback remains available)"
if ($TtsEngine -eq "edge-tts") {
    Write-Host "TTS:             $env:TTS_BASE_URL · Edge neural · $env:TTS_EDGE_VOICE · no local GPU"
}
else {
    Write-Host "TTS:             $env:TTS_BASE_URL · local-command fallback"
}
Write-Host "Web:             http://localhost:3000"
Write-Host "Stop the complete tracked stack with: .\stop-all.ps1"
Write-Host ""
Write-Host "If your LiveKit installation is not on PATH, run for example:"
Write-Host '.\start-all.ps1 -LiveKitCommand "D:\path\to\livekit-server.exe"'
