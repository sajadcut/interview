$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = Join-Path $RepoRoot ".env"
if (-not (Test-Path $EnvFile)) { throw ".env was not found." }

$values = @{}
Get-Content $EnvFile -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $parts = $line.Split("=", 2)
        $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
}
$secret = $values["TTS_SHARED_SECRET"]
if (-not $secret) { $secret = $values["MEDIA_WORKER_SHARED_SECRET"] }
if (-not $secret) { throw "TTS_SHARED_SECRET or MEDIA_WORKER_SHARED_SECRET must be configured in .env." }

$headers = @{
    "x-tts-secret" = $secret
    "x-tts-contract-version" = "tts-synthesis.v1"
}
$body = @{
    spokenText = "لطفاً یک نمونه واقعی و مشخص از تجربه کاری خود درباره Backend تعریف کنید. بگویید خودتان چه تصمیمی گرفتید، شرایط فنی چه بود، چه API هایی طراحی کردید و نتیجه چه شد."
} | ConvertTo-Json -Compress

$out = Join-Path $RepoRoot ".local-data\ava-ab-test.wav"
New-Item -ItemType Directory -Force -Path (Split-Path $out -Parent) | Out-Null

$watch = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-WebRequest -Uri "http://127.0.0.1:9022/synthesize" -Method POST -Headers $headers -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -OutFile $out
$watch.Stop()

Write-Host "Ava synthesis completed in $([math]::Round($watch.Elapsed.TotalSeconds, 2)) seconds"
Write-Host "Output: $out"
Start-Process $out
