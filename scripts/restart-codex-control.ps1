param(
  [string]$TaskName = $env:CODEX_CONTROL_RESTART_TASK,
  [string]$HealthUrl = 'http://127.0.0.1:4567/api/health',
  [int]$WaitSeconds = 3,
  [string]$StartCommand = 'node',
  [string[]]$StartArgs = @('src/server.mjs')
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$serverPattern = '(?i)(?:node(?:\.exe)?["'']?\s+src[\\/]+server\.mjs|src[\\/]+server\.mjs)'

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
