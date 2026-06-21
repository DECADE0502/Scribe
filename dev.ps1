# Scribe one-click dev launcher
# Kills any stale server/client on the dev ports, then starts both.
# Usage:  .\dev.ps1
# Re-run anytime to restart cleanly.

$ErrorActionPreference = 'Stop'
$root        = $PSScriptRoot
$backendPort = 6789
$frontendPort = 5173

function Stop-PortListeners {
  param([int]$Port)
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    try {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction Stop
      Write-Host "  killing $($proc.ProcessName) PID=$($proc.Id) on port $Port"
      Stop-Process -Id $proc.Id -Force
    } catch { }
  }
}

Write-Host "== Scribe dev launcher ==" -ForegroundColor Cyan

# 1. Kill stale processes on both ports
Write-Host "[1/4] Cleaning up old processes..." -ForegroundColor Yellow
Stop-PortListeners -Port $backendPort
Stop-PortListeners -Port $frontendPort
Start-Sleep -Seconds 1

# 2. Start backend (non-blocking, minimized window)
Write-Host "[2/4] Starting backend (port $backendPort)..." -ForegroundColor Yellow
$be = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "pnpm --filter @scribe/server exec tsx src/main.ts" `
  -WorkingDirectory $root -WindowStyle Minimized -PassThru

# 3. Wait for backend health
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    (Invoke-WebRequest -Uri "http://127.0.0.1:$backendPort/api/health" -UseBasicParsing -TimeoutSec 2) | Out-Null
    $ok = $true; break
  } catch { }
}
if (-not $ok) {
  Write-Host "  backend failed to come up in 30s. Check the minimized cmd window." -ForegroundColor Red
  exit 1
}
Write-Host "  backend ready: http://127.0.0.1:$backendPort" -ForegroundColor Green

# 4. Start frontend (non-blocking, minimized window)
Write-Host "[3/4] Starting frontend (port $frontendPort)..." -ForegroundColor Yellow
$fe = Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "pnpm --filter @scribe/client dev" `
  -WorkingDirectory $root -WindowStyle Minimized -PassThru

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    (Invoke-WebRequest -Uri "http://localhost:$frontendPort" -UseBasicParsing -TimeoutSec 2) | Out-Null
    $ok = $true; break
  } catch { }
}
if (-not $ok) {
  Write-Host "  frontend failed to come up in 30s. Check the minimized cmd window." -ForegroundColor Red
  exit 1
}
Write-Host "  frontend ready: http://localhost:$frontendPort" -ForegroundColor Green

Write-Host "[4/4] Done." -ForegroundColor Green
Write-Host ""
Write-Host "  Open in browser: http://localhost:$frontendPort" -ForegroundColor Cyan
Write-Host "  Backend cmd PID: $($be.Id) | Frontend cmd PID: $($fe.Id)"
Write-Host "  Re-run .\dev.ps1 anytime to restart (old processes are killed automatically)."
