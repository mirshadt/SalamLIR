$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$BackendPort = 3001
$FrontendPort = 8082

function Stop-PortListener($Port) {
  $listeners = netstat -ano | Select-String ":$Port" | Select-String "LISTENING"
  foreach ($line in $listeners) {
    $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
    if ($parts.Count -ge 5 -and $parts[-1] -match "^\d+$") {
      Stop-Process -Id ([int]$parts[-1]) -Force -ErrorAction SilentlyContinue
    }
  }
}

Stop-PortListener $BackendPort
Stop-PortListener $FrontendPort
Start-Sleep -Seconds 1

Start-Process -FilePath "$Root\backend\.venv\Scripts\python.exe" `
  -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$Root\api.log" `
  -RedirectStandardError "$Root\api.err.log"

Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput "$Root\web.log" `
  -RedirectStandardError "$Root\web.err.log"

Start-Sleep -Seconds 6
Write-Host "Backend:  http://127.0.0.1:$BackendPort/health"
Write-Host "Frontend: http://127.0.0.1:$FrontendPort"