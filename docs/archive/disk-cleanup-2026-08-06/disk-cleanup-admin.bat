@echo off
setlocal enabledelayedexpansion
REM ============================================================
REM  C: drive admin cleanup (2026-08-06). RUN AS ADMINISTRATOR.
REM  Docs: docs/DISK-CLEANUP-2026-08-06.md
REM  Log:  logs\disk-cleanup-admin.log
REM ============================================================

set LOG=E:\claude\ai-news-monitor\logs\disk-cleanup-admin.log
echo === disk-cleanup-admin start %date% %time% === > "%LOG%"

REM ---------- 1. WinSxS cleanup (est +5~15G) ----------
echo [1/6] WinSxS component cleanup (DISM)...
echo === 1. DISM StartComponentCleanup === >> "%LOG%"
DISM /Online /Cleanup-Image /StartComponentCleanup >> "%LOG%" 2>&1
echo === 1b. DISM ResetBase (irreversible) === >> "%LOG%"
DISM /Online /Cleanup-Image /StartComponentCleanup /ResetBase >> "%LOG%" 2>&1

REM ---------- 2. Shadow copies / restore points ----------
echo [2/6] System Restore shadow storage...
echo === 2. shadowstorage before === >> "%LOG%"
vssadmin list shadowstorage >> "%LOG%" 2>&1
echo === 2b. delete all shadows === >> "%LOG%"
vssadmin delete shadows /all /quiet >> "%LOG%" 2>&1

REM ---------- 3. cleanmgr system files ----------
echo [3/6] cleanmgr...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Temporary Files" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Update Cleanup" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Thumbnail Cache" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Recycle Bin" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
echo === 3. cleanmgr sagerun === >> "%LOG%"
cleanmgr /sagerun:1 >> "%LOG%" 2>&1

REM ---------- 4. Delete Package Cache (installer cache, 1.1G) ----------
echo [4/6] Delete ProgramData\Package Cache...
echo === 4. rmdir Package Cache === >> "%LOG%"
rmdir /s /q "C:\ProgramData\Package Cache" >> "%LOG%" 2>&1

REM ---------- 5. Uninstall QQPCMgr (2.5G) + VS Build Tools 2026 (3.6G) ----------
echo [5/6] Uninstall QQPCMgr + VS Build Tools 2026...
echo === 5a. QQPCMgr uninstall === >> "%LOG%"
start /wait "" "C:\Program Files (x86)\Tencent\QQPCMgr\18.1.30302.212\Uninst.exe" /S >> "%LOG%" 2>&1
echo === 5b. VS Build Tools uninstall (quiet) === >> "%LOG%"
start /wait "" "C:\Program Files (x86)\Microsoft Visual Studio\Installer\setup.exe" uninstall --installPath "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools" --quiet --norestart >> "%LOG%" 2>&1

REM ---------- 6. Windows SDK components bulk uninstall (Windows Kits 1.8G) ----------
echo [6/6] Windows SDK components bulk uninstall...
echo === 6. Windows SDK msiexec uninstall === >> "%LOG%"
powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Windows SDK*' -and $_.UninstallString -like 'MsiExec.exe*' } | ForEach-Object { $code = $_.UninstallString -replace '.*\{(.*)\}','$1'; if ($code -match '^[0-9A-F-]{10,}$') { 'uninstalling: ' + $_.DisplayName + ' ' + $code | Add-Content 'E:\claude\ai-news-monitor\logs\disk-cleanup-admin.log'; Start-Process msiexec.exe -ArgumentList ('/x',$code,'/qn','/norestart') -Wait -NoNewWindow } }" >> "%LOG%" 2>&1

REM ---------- Notes ----------
echo === eSupport (2.5G): no standard uninstaller, remove via Settings>Apps === >> "%LOG%"
echo === WeChat (850M): in use, NOT uninstalled by this script === >> "%LOG%"

REM ---------- Result ----------
echo.
echo === done. Current C: free space: ===
powershell -NoProfile -Command "(Get-PSDrive C).Free/1GB" | ForEach-Object { "{0:N1} GB" -f $_ }
echo Log: %LOG%
pause
