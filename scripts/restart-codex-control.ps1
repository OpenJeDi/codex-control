param(
  [string]$TaskName = 'codex-control',
  [string]$HealthUrl = 'http://127.0.0.1:4567/api/health',
  [int]$WaitSeconds = 3
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$serverPattern = 'node\s+src\\server\.mjs|node\s+src/server\.mjs'

Write-Host "Stopping existing Codex Control node processes..."
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match $serverPattern } |
  ForEach-Object {
    Write-Host "Stopping PID $($_.ProcessId): $($_.CommandLine)"
    Stop-Process -Id $_.ProcessId -Force
  }

Write-Host "Starting scheduled task '$TaskName'..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds $WaitSeconds

Write-Host "Checking health: $HealthUrl"
$response = Invoke-WebRequest -UseBasicParsing $HealthUrl
if ($response.StatusCode -ne 200) {
  throw "Health check failed with status $($response.StatusCode)."
}

Write-Host "Codex Control restarted successfully ($($response.StatusCode))."