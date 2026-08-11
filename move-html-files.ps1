# move-html-files.ps1
# Recursively move all .html files from all subfolders to ./flowchart folder
# Skip if file already exists in target

$ErrorActionPreference = "Continue"

$sourceDir = "E:\claude\ai-news-monitor"
$targetDir = "E:\claude\ai-news-monitor\flowchart"

$totalFiles = 0
$movedFiles = 0
$skippedFiles = 0
$failedFiles = 0

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "HTML File Mover (Recursive)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Source: $sourceDir (including subfolders)" -ForegroundColor Yellow
Write-Host "Target: $targetDir" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $sourceDir)) {
    Write-Host "ERROR: Source directory not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $targetDir)) {
    Write-Host "Creating target directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    Write-Host "Target directory created" -ForegroundColor Green
}

Write-Host "`nScanning for .html files..." -ForegroundColor Yellow
$htmlFiles = Get-ChildItem -Path $sourceDir -Filter "*.html" -File -Recurse | Where-Object {
    $_.Directory.FullName -ne $targetDir
}

$totalFiles = $htmlFiles.Count

if ($totalFiles -eq 0) {
    Write-Host "No .html files found in source directory or subfolders" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 0
}

Write-Host "Found $totalFiles HTML file(s) in all subfolders" -ForegroundColor Green
Write-Host "`nStarting to move files..." -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray

foreach ($file in $htmlFiles) {
    $destPath = Join-Path -Path $targetDir -ChildPath $file.Name
    $relativePath = $file.FullName.Replace($sourceDir, "").TrimStart("\")
    
    if (Test-Path $destPath) {
        Write-Host "[SKIP] $($file.Name) (from $relativePath) - Already exists in target" -ForegroundColor Gray
        $skippedFiles++
        continue
    }
    
    try {
        Move-Item -Path $file.FullName -Destination $destPath -Force
        Write-Host "[OK] $($file.Name) (from $relativePath) - Moved to flowchart" -ForegroundColor Green
        $movedFiles++
    } catch {
        Write-Host "[FAIL] $($file.Name) (from $relativePath) - Error: $($_.Exception.Message)" -ForegroundColor Red
        $failedFiles++
    }
}

Write-Host "----------------------------------------" -ForegroundColor Gray
Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "Total files found: $totalFiles" -ForegroundColor White
Write-Host "Successfully moved: $movedFiles" -ForegroundColor Green
Write-Host "Skipped (already exist): $skippedFiles" -ForegroundColor Gray
Write-Host "Failed: $failedFiles" -ForegroundColor Red

if ($movedFiles -gt 0) {
    Write-Host "`nAll files have been flattened to: $targetDir" -ForegroundColor Yellow
}

if ($failedFiles -gt 0) {
    Write-Host "`nSome files failed to move, please check errors above" -ForegroundColor Red
} else {
    Write-Host "`nAll operations completed!" -ForegroundColor Green
}

Write-Host "`n"
Read-Host "Press Enter to exit"