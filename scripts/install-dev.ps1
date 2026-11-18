<#
.SYNOPSIS
  Install Lumen AI Studio as an UNSIGNED development extension on Windows.
.DESCRIPTION
  1. Copies the extension into %APPDATA%\Adobe\CEP\extensions\lumen-ai-studio
  2. Sets PlayerDebugMode=1 for CSXS 10/11/12 (per-user, HKCU) so unsigned CEP
     panels load. No admin rights required.
     Mapping: IL 2021 v25.0 -> CEP 10, v25.3..v28 -> CEP 11, 2025 v29 -> CEP 12.
  3. Close and reopen Illustrator afterwards, then
     Window -> Extensions -> Lumen AI Studio.
.NOTES
  To remove: delete the folder from %APPDATA%\Adobe\CEP\extensions and set the
  PlayerDebugMode values to "0" (or delete them).
#>
$ErrorActionPreference = 'Stop'

$src  = Split-Path -Parent $PSScriptRoot          # repo root (this script lives in scripts/)
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\lumen-ai-studio'

Write-Host "== Lumen AI Studio - unsigned dev install (Windows) ==" -ForegroundColor Cyan
Write-Host "Source : $src"
Write-Host "Target : $dest"

# 1) Clean copy (delete-then-copy, like a fresh install)
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$src\*" $dest -Recurse -Force -Exclude @('build', '.git', 'node_modules', '.gitignore')

# 2) PlayerDebugMode for the CEP majors Illustrator v25..v29 may use
$majors = 10, 11, 12
foreach ($m in $majors) {
  $key = "HKCU:\Software\Adobe\CSXS.$m"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
  Write-Host "PlayerDebugMode=1  -> HKCU:\Software\Adobe\CSXS.$m"
}

# 3) Reminder: Illustrator reads PlayerDebugMode at startup
Write-Host ""
Write-Host "Done. Restart Illustrator, then: Window -> Extensions -> Lumen AI Studio" -ForegroundColor Green
Write-Host "If the panel does not appear, confirm PlayerDebugMode='1' under HKCU:\Software\Adobe\CSXS.<n>"
