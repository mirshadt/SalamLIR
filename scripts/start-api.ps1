$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot "backend\.venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  throw "Python virtual environment not found at $python. Run the backend setup before starting the API."
}

Set-Location $projectRoot
Write-Host "Starting NetAtlas IPAM FastAPI on http://127.0.0.1:3001"
Write-Host "Keep this PowerShell window open while using the GUI."
& $python -m uvicorn backend.main:app --host 127.0.0.1 --port 3001
