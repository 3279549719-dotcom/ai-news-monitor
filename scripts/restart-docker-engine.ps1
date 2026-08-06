#Requires -Version 5.1
<#
.SYNOPSIS
  Hard-restart Docker Desktop so the engine (dockerd in WSL) actually comes back.

.DESCRIPTION
  Symptom this fixes:
    - Docker Desktop UI shows "Engine running"
    - `docker ps` hangs / times out
    - http://127.0.0.1:11235/health fails
    - `wsl -l -v` shows docker-desktop Stopped (or Running with no dockerd)

  Root cause (observed 2026-08-05):
    `wsl --shutdown` alone kills the VM, but leaves a day-old com.docker.backend.exe
    alive. The GUI reconnects to that zombie backend, which still exposes named pipes
    and reports "Engine running" while dockerd is gone. CLI then hangs on the pipe.

  Correct recovery: kill ALL Docker processes → wsl --shutdown → start Desktop fresh →
  wait until `docker version` returns a Server version.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\restart-docker-engine.ps1
#>

$ErrorActionPreference = 'Continue'
$DesktopExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
$MaxWaitSec = 180

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

if (-not (Test-Path $DesktopExe)) {
  Write-Error "Docker Desktop not found at $DesktopExe"
  exit 1
}

Write-Step '1/5 Kill hung docker CLI + Docker Desktop processes'
Get-Process docker -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
try {
  Start-Process $DesktopExe -ArgumentList '-Quit' -Wait -ErrorAction SilentlyContinue
} catch {}
Start-Sleep -Seconds 2

Get-Process | Where-Object {
  $_.ProcessName -like 'com.docker*' -or
  $_.ProcessName -like 'Docker*' -or
  $_.ProcessName -eq 'docker'
} | ForEach-Object {
  Write-Host "  killing $($_.ProcessName) PID $($_.Id)"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$left = @(Get-Process | Where-Object { $_.ProcessName -match 'docker|Docker' })
if ($left.Count -gt 0) {
  Write-Host "  WARNING: still running: $($left.ProcessName -join ', ')" -ForegroundColor Yellow
} else {
  Write-Host '  all Docker processes gone'
}

Write-Step '2/5 wsl --shutdown'
wsl --shutdown | Out-Null
Start-Sleep -Seconds 5
$wsl = ((wsl -l -v 2>&1 | Out-String) -replace "`0", '').Trim()
Write-Host $wsl

Write-Step '3/5 Start Docker Desktop'
Start-Process $DesktopExe

Write-Step "4/5 Poll engine readiness (max ${MaxWaitSec}s)"
$deadline = (Get-Date).AddSeconds($MaxWaitSec)
$ready = $false
$serverVersion = $null

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $elapsed = [int]($MaxWaitSec - ($deadline - (Get-Date)).TotalSeconds)
  $pipe = Test-Path '\\.\pipe\dockerDesktopLinuxEngine'
  $job = Start-Job { docker version --format '{{.Server.Version}}' 2>&1 }
  $done = Wait-Job $job -Timeout 8
  if ($done) {
    $out = ((Receive-Job $job | Out-String)).Trim()
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  } else {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    $out = 'TIMEOUT'
  }
  Write-Host ("  t={0,3}s pipe={1} docker={2}" -f $elapsed, $pipe, $out)
  if ($out -and $out -ne 'TIMEOUT' -and $out -notmatch 'error|Error|failed|Cannot') {
    $ready = $true
    $serverVersion = $out
    break
  }
}

if (-not $ready) {
  Write-Host "`nENGINE NOT READY after ${MaxWaitSec}s" -ForegroundColor Red
  Write-Host 'Open Docker Desktop UI, check Notifications (bell), install any WSL update, then re-run this script.'
  exit 2
}

Write-Step "5/5 Engine ready (Docker $serverVersion) — ensure crawl4ai"
docker start crawl4ai 2>&1 | Out-Host
Start-Sleep -Seconds 3
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:11235/health' -TimeoutSec 15 -UseBasicParsing
  Write-Host "11235/health HTTP $($health.StatusCode) $($health.Content)" -ForegroundColor Green
} catch {
  Write-Host "11235/health not ready yet (container may still be warming): $_" -ForegroundColor Yellow
  Write-Host 'Wait ~30s then: curl http://127.0.0.1:11235/health'
}

Write-Host ''
docker ps --filter 'name=crawl4ai' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
Write-Host "`nDone." -ForegroundColor Green
exit 0
