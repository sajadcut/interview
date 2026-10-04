[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $repoRoot ".local-data\dev-stack-processes.json"

if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
    Write-Host "No tracked Interview development stack was found."
    exit 0
}

try {
    $loaded = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $tracked = @($loaded)
}
catch {
    Write-Warning "Could not read process state: $stateFile"
    Write-Warning "Nothing was killed automatically."
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

function Get-ProtectedProcessIds {
    $protected = @{}
    $cursor = [int]$PID
    $guard = 0
    while ($cursor -gt 0 -and $guard -lt 64) {
        $protected[$cursor] = $true
        $guard++
        try {
            $row = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction Stop
            if ($null -eq $row -or [int]$row.ParentProcessId -le 0) { break }
            $cursor = [int]$row.ParentProcessId
        }
        catch { break }
    }
    return $protected
}

function Test-TrackedIdentity {
    param($Entry, $ProtectedIds)
    if (-not $Entry.ProcessId) { return $false }
    $processId = [int]$Entry.ProcessId
    if ($ProtectedIds.ContainsKey($processId)) {
        Write-Warning "Refusing to stop PID $processId because it is this PowerShell process or one of its parents."
        return $false
    }
    try {
        $process = Get-Process -Id $processId -ErrorAction Stop
    }
    catch {
        return $false
    }
    if ($Entry.StartedAt) {
        try {
            $recorded = [DateTimeOffset]::Parse([string]$Entry.StartedAt).UtcDateTime
            $actual = $process.StartTime.ToUniversalTime()
            if ([Math]::Abs(($actual - $recorded).TotalSeconds) -gt 5) {
                Write-Warning "Refusing to stop PID $processId because the PID appears to have been reused."
                return $false
            }
        }
        catch {
            Write-Warning "Could not verify start time for PID $processId; refusing to stop it automatically."
            return $false
        }
    }
    return $true
}

function Get-Descendants {
    param([int]$RootProcessId, $ProtectedIds)
    try {
        $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    }
    catch {
        Write-Warning "Could not enumerate child processes: $($_.Exception.Message)"
        return @()
    }
    $byParent = @{}
    foreach ($row in $rows) {
        $parentId = [int]$row.ParentProcessId
        if (-not $byParent.ContainsKey($parentId)) { $byParent[$parentId] = @() }
        $byParent[$parentId] += [int]$row.ProcessId
    }
    $result = @()
    $queue = @([pscustomobject]@{ ProcessId = $RootProcessId; Depth = 0 })
    while ($queue.Count -gt 0) {
        $current = $queue[0]
        if ($queue.Count -eq 1) { $queue = @() } else { $queue = @($queue[1..($queue.Count - 1)]) }
        $children = if ($byParent.ContainsKey([int]$current.ProcessId)) { @($byParent[[int]$current.ProcessId]) } else { @() }
        foreach ($childId in $children) {
            if ($ProtectedIds.ContainsKey([int]$childId)) { continue }
            $item = [pscustomobject]@{ ProcessId = [int]$childId; Depth = [int]$current.Depth + 1 }
            $result += $item
            $queue += $item
        }
    }
    return @($result | Sort-Object Depth -Descending)
}

function Stop-OneProcess {
    param([int]$ProcessId, [string]$Label, $ProtectedIds)
    if ($ProtectedIds.ContainsKey($ProcessId)) {
        Write-Warning "Refusing to stop protected $Label PID $ProcessId."
        return $false
    }
    if (-not (Test-ProcessIsRunning -ProcessId $ProcessId)) { return $true }
    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        return $true
    }
    catch {
        if (-not (Test-ProcessIsRunning -ProcessId $ProcessId)) { return $true }
        Write-Warning "Could not stop $Label PID $ProcessId. $($_.Exception.Message)"
        return $false
    }
}

$protectedIds = Get-ProtectedProcessIds
$failed = @()
$reverse = @($tracked)
if ($reverse.Count -gt 1) { [Array]::Reverse($reverse) }

foreach ($entry in $reverse) {
    if ($null -eq $entry -or -not $entry.ProcessId) { continue }
    $processId = [int]$entry.ProcessId
    $name = if ($entry.Name) { [string]$entry.Name } else { "unknown" }

    if (-not (Test-ProcessIsRunning -ProcessId $processId)) {
        Write-Host "[stopped] $name (PID $processId was already gone)"
        continue
    }

    if (-not (Test-TrackedIdentity -Entry $entry -ProtectedIds $protectedIds)) {
        Write-Host "[stale] $name (PID $processId) was not killed."
        continue
    }

    foreach ($child in @(Get-Descendants -RootProcessId $processId -ProtectedIds $protectedIds)) {
        $null = Stop-OneProcess -ProcessId ([int]$child.ProcessId) -Label "$name child" -ProtectedIds $protectedIds
    }

    $rootStopped = Stop-OneProcess -ProcessId $processId -Label $name -ProtectedIds $protectedIds
    Start-Sleep -Milliseconds 150

    if ($rootStopped -and -not (Test-ProcessIsRunning -ProcessId $processId)) {
        Write-Host "[stopped] $name (PID $processId)"
    }
    else {
        $failed += $entry
        Write-Warning "Could not fully stop $name (PID $processId)."
    }
}

if ($failed.Count -eq 0) {
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "Interview development stack stopped."
    Write-Host "The current PowerShell process and all parent processes were protected from termination."
    exit 0
}

@($failed) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Warning "Some verified tracked services are still running. Their entries remain in $stateFile."
exit 1
