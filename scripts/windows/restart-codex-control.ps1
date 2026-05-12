param(
  [string]$TaskName = $env:CODEX_CONTROL_RESTART_TASK,
  [string]$HealthUrl = 'http://127.0.0.1:4567/api/health',
  [int]$WaitSeconds = 3,
  [string]$StartCommand = 'node',
  [string[]]$StartArgs = @('src/server.mjs'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$serverPattern = '(?i)(?:node(?:\.exe)?["'']?\s+src[\\/]+server\.mjs|src[\\/]+server\.mjs)'
$threadsUrl = $HealthUrl -replace '/api/health(?:\?.*)?$', '/api/threads?limit=200'
$activeStatuses = @('active', 'running', 'inprogress', 'externalactive')

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
      throw "Refusing to restart while $($activeThreads.Count) session(s) are active: $($names -join '; '). Re-run with -Force if interruption is intentional."
    }
  } catch {
    if ($_.Exception.Message -like 'Refusing to restart*') { throw }
    Write-Warning "Could not check active sessions before restart: $($_.Exception.Message)"
  }
}

Write-Host "Stopping existing Codex Control node processes..."
$processIds = @()
$processIds += Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match $serverPattern } |
  ForEach-Object { $_.ProcessId }
$processIds += Get-NetTCPConnection -LocalPort 4567 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { $_.OwningProcess }

$processIds |
  Where-Object { $_ } |
  Select-Object -Unique |
  ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$_" -ErrorAction SilentlyContinue
    Write-Host "Stopping PID ${_}: $($process.CommandLine)"
    Stop-Process -Id $_ -Force
  }

if ($TaskName) {
  Write-Host "Starting scheduled task '$TaskName'..."
  Start-ScheduledTask -TaskName $TaskName
} else {
  Write-Host "Starting Codex Control directly..."
  Start-Process -FilePath $StartCommand -ArgumentList $StartArgs -WorkingDirectory $root -WindowStyle Hidden
}
Start-Sleep -Seconds $WaitSeconds

Write-Host "Checking health: $HealthUrl"
$response = Invoke-WebRequest -UseBasicParsing $HealthUrl
if ($response.StatusCode -ne 200) {
  throw "Health check failed with status $($response.StatusCode)."
}

Write-Host "Codex Control restarted successfully ($($response.StatusCode))."
