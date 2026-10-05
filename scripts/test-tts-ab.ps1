[CmdletBinding()]
param(
    [string]$Text = "اگر درباره تخصیص منابع در معماری سیستم توضیح دهید، چه روشی را انتخاب می‌کنید؟",
    [string]$AvaBaseUrl = "http://127.0.0.1:9022",
    [string]$EdgeVoice = "fa-IR-FaridNeural"
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = Join-Path $RepoRoot ".env"
$OutDir = Join-Path $RepoRoot ".local-data\tts-ab"
$AvaOutput = Join-Path $OutDir "ava-82m.wav"
$EdgeOutput = Join-Path $OutDir "edge-farid.mp3"
$EdgeTextFile = Join-Path $OutDir "edge-input.txt"

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw ".env was not found."
}

$values = @{}
Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
}

$secret = $values["TTS_SHARED_SECRET"]
if (-not $secret) { $secret = $values["MEDIA_WORKER_SHARED_SECRET"] }
if (-not $secret) {
    $secret = "local-interview-media-worker-dev-secret"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Checking Ava..."
$avaRoot = $AvaBaseUrl.TrimEnd("/")
$health = Invoke-RestMethod -Uri "$avaRoot/health" -Method GET -TimeoutSec 5
if (-not $health.ready -or $health.provider -ne "ava-82m-persian-cpu") {
    throw "Ava worker is not ready. Run .\start-all.ps1 first."
}

$requestId = "tts:ava-ab-$([Guid]::NewGuid().ToString('N'))"
$headers = @{
    "x-tts-secret" = $secret
    "x-tts-contract-version" = "tts-synthesis.v1"
    "x-request-id" = $requestId
}
$body = @{ spokenText = $Text } | ConvertTo-Json -Compress

$avaWatch = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-WebRequest -Uri "$avaRoot/synthesize" -Method POST -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -OutFile $AvaOutput
$avaWatch.Stop()

$edge = Get-Command edge-tts -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $edge) {
    throw "edge-tts was not found on PATH. Install it with: python -m pip install edge-tts"
}

[System.IO.File]::WriteAllText($EdgeTextFile, $Text, (New-Object System.Text.UTF8Encoding($false)))
$edgeWatch = [System.Diagnostics.Stopwatch]::StartNew()
& $edge.Source --voice $EdgeVoice --file $EdgeTextFile --write-media $EdgeOutput
if ($LASTEXITCODE -ne 0) {
    throw "Edge TTS A/B synthesis failed."
}
$edgeWatch.Stop()
Remove-Item -LiteralPath $EdgeTextFile -Force -ErrorAction SilentlyContinue

$avaFile = Get-Item -LiteralPath $AvaOutput
$edgeFile = Get-Item -LiteralPath $EdgeOutput

Write-Host ""
Write-Host "A/B files are ready:"
Write-Host "Ava-82M : $AvaOutput · $([math]::Round($avaWatch.Elapsed.TotalSeconds, 2))s · $($avaFile.Length) bytes"
Write-Host "Edge     : $EdgeOutput · $([math]::Round($edgeWatch.Elapsed.TotalSeconds, 2))s · $($edgeFile.Length) bytes"
Write-Host ""
Write-Host "Play Ava:"
Write-Host "Invoke-Item '$AvaOutput'"
Write-Host "Play Edge:"
Write-Host "Invoke-Item '$EdgeOutput'"
