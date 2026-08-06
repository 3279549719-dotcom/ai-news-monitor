@echo off
REM ============================================================
REM  C: system cleanup (run as ADMINISTRATOR)
REM  Log: E:\claude\ai-news-monitor\logs\disk-cleanup-admin.log
REM ============================================================
set LOG=E:\claude\ai-news-monitor\logs\disk-cleanup-admin.log
echo === sys-cleanup start %date% %time% === > "%LOG%"

echo [1/4] DISM WinSxS cleanup...
echo === 1. DISM StartComponentCleanup === >> "%LOG%"
DISM /Online /Cleanup-Image /StartComponentCleanup >> "%LOG%" 2>&1
echo === 1b. DISM ResetBase === >> "%LOG%"
DISM /Online /Cleanup-Image /StartComponentCleanup /ResetBase >> "%LOG%" 2>&1

echo [2/4] vssadmin shadow cleanup...
echo === 2. before === >> "%LOG%"
vssadmin list shadowstorage >> "%LOG%" 2>&1
echo === 2b. delete shadows === >> "%LOG%"
vssadmin delete shadows /all /quiet >> "%LOG%" 2>&1

echo [3/4] cleanmgr...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Temporary Files" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Update Cleanup" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Thumbnail Cache" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VolumeCaches\Recycle Bin" /v StateFlags0001 /d 2 /f >> "%LOG%" 2>&1
echo === 3. cleanmgr sagerun === >> "%LOG%"
cleanmgr /sagerun:1 >> "%LOG%" 2>&1

echo [4/4] delete Package Cache...
echo === 4. rm Package Cache === >> "%LOG%"
rmdir /s /q "C:\ProgramData\Package Cache" >> "%LOG%" 2>&1

echo === done === >> "%LOG%"
echo.
echo === C: free space ===
powershell -NoProfile -Command "(Get-PSDrive C).Free/1GB" | ForEach-Object { "{0:N1} GB" -f $_ }
echo Log: %LOG%
