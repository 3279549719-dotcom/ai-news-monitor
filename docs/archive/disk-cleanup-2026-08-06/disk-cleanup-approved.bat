@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  User-APPROVED cleanups only (2026-08-06)
REM  - Delete ProgramData\Package Cache (user confirmed)
REM  - Uninstall QQPCMgr 2.5G (user confirmed)
REM  - Uninstall VS Build Tools 2026 3.6G (user confirmed)
REM  - Uninstall Windows SDK components 1.8G (user confirmed)
REM  Run as ADMINISTRATOR. Log: logs\disk-cleanup-approved.log
REM ============================================================
set LOG=E:\claude\ai-news-monitor\logs\disk-cleanup-approved.log
echo === approved-cleanup start %date% %time% === > "%LOG%"

echo [1/4] Delete Package Cache (1.1G)...
echo === 1. rmdir Package Cache === >> "%LOG%"
rmdir /s /q "C:\ProgramData\Package Cache" >> "%LOG%" 2>&1

echo [2/4] Uninstall QQPCMgr (2.5G)...
echo === 2. QQPCMgr Uninst === >> "%LOG%"
start /wait "" "C:\Program Files (x86)\Tencent\QQPCMgr\18.1.30302.212\Uninst.exe" /S >> "%LOG%" 2>&1

echo [3/4] Uninstall VS Build Tools 2026 (3.6G)...
echo === 3. VS uninstall === >> "%LOG%"
start /wait "" "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" uninstall --installPath "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools" --quiet --norestart >> "%LOG%" 2>&1

echo [4/4] Uninstall Windows SDK components (1.8G)...
echo === 4. Windows SDK bulk === >> "%LOG%"
powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Windows SDK*' -and $_.UninstallString -like 'MsiExec.exe*' } | ForEach-Object { $code = $_.UninstallString -replace '.*\{(.*)\}','$1'; if ($code -match '^[0-9A-F-]{10,}$') { 'uninstalling: ' + $_.DisplayName + ' ' + $code | Add-Content 'E:\claude\ai-news-monitor\logs\disk-cleanup-approved.log'; Start-Process msiexec.exe -ArgumentList ('/x',$code,'/qn','/norestart') -Wait -NoNewWindow } }" >> "%LOG%" 2>&1

echo === done === >> "%LOG%"
echo.
echo === C: free space ===
powershell -NoProfile -Command "(Get-PSDrive C).Free/1GB" | ForEach-Object { "{0:N1} GB" -f $_ }
echo Log: %LOG%
