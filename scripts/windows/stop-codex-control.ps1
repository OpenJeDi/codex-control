param(
  [string]$TaskName = $env:CODEX_CONTROL_RESTART_TASK,
  [string]$HealthUrl = 'http://127.0.0.1:4567/api/health',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$serverPattern = '(?i)(?:node(?:\.exe)?["'']?\s+src[\\/]+server\.mjs|src[\\/]+server\.mjs)'
$threadsUrl = $HealthUrl -replace '/api/health(?:\?.*)?$', '/api/threads?limit=200'
$activeStatuses = @('active', 'running', 'inprogress', 'externalactive')

try {
  $healthUri = [Uri]$HealthUrl
  $port = $healthUri.Port
} catch {
  $port = 4567
}

if (-not $Force) {
  try {
    $threadsResponse = Invoke-WebRequest -UseBasicParsing $threadsUrl -TimeoutSec 5
    $threadsPayload = $threadsResponse.Content | ConvertFrom-Json
    $activeThreads = @($threadsPayload.data | Where-Object {
      $status = ''
      if ($_.status -and $_.status.type) { $status = [string]$_.status.type }
      elseif ($_.status) { $status = [string]$_.status }
      $activeStatuses -contains $status.ToLowerInvariant()
    })
    if ($activeThreads.Count -gt 0) {
      $names = $activeThreads |
        Select-Object -First 5 |
        ForEach-Object { if ($_.name) { $_.name } elseif ($_.preview) { $_.preview } else { $_.id } }
      throw "Refusing to stop while $($activeThreads.Count) session(s) are active: $($names -join '; '). Re-run with -Force if interruption is intentional."
    }
  } catch {
    if ($_.Exception.Message -like 'Refusing to stop*') { throw }
    Write-Warning "Could not check active sessions before stop: $($_.Exception.Message)"
  }
}

if ($TaskName) {
  Write-Host "Stopping scheduled task '$TaskName'..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

Write-Host "Stopping Codex Control node processes..."
$processIds = @()
$processIds += Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match $serverPattern } |
  ForEach-Object { $_.ProcessId }
$processIds += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { $_.OwningProcess }

$processIds = @($processIds | Where-Object { $_ } | Select-Object -Unique)
if ($processIds.Count -eq 0) {
  Write-Host 'No Codex Control process found.'
  exit 0
}

$processIds |
  ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
    Write-Host "Stopping PID ${_}: $($process.CommandLine)"
    Stop-Process -Id $_ -Force
  }

Write-Host 'Codex Control stopped.'
