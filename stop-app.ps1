$ports = @(3001, 8082)
$stopped = @()

foreach ($port in $ports) {
  $listeners = netstat -ano | Select-String ":$port" | Select-String "LISTENING"
  foreach ($line in $listeners) {
    $parts = ($line.ToString() -split "\s+") | Where-Object { $_ }
    if ($parts.Count -ge 5 -and $parts[-1] -match "^\d+$") {
      $pidValue = [int]$parts[-1]
      $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
        $stopped += "$($proc.ProcessName) pid=$pidValue port=$port"
      }
    }
  }
}

Start-Sleep -Seconds 1
foreach ($item in $stopped) { Write-Host "Stopped $item" }
if (-not $stopped.Count) { Write-Host "No app listeners were running on ports 3001 or 8082." }