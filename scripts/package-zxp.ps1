<#
.SYNOPSIS
  Package Lumen AI Studio v1.0.0 as a signed .zxp (installable via Creative Cloud desktop).
.DESCRIPTION
  Stages a CLEAN payload first — only the files Illustrator needs — then signs it with
  ZXPSignCmd. Dev-only files (.debug, docs/, tests/, scripts/, build/, .gitignore, README.md)
  are NEVER packaged.

  Requires ZXPSignCmd (Adobe's free signer, shipped in the Adobe-CEP repo under ZXPSignCMD/).
  Pass -CertPfx and -CertPassword for a real certificate. For local testing any self-signed
  .pfx works, but Illustrator will only load self-signed zxp with PlayerDebugMode=1 set anyway.

  Example:
    .\package-zxp.ps1 -ZxpSignCmd "C:\tools\ZXPSignCmd.exe" `
                      -CertPfx "C:\cert.pfx" -CertPassword "secret"
.NOTES
  Always timestamp the signature (-tsa) or the package stops loading once the cert expires.
  No npm dependencies exist in this project, so the Known-2024-Issue (symlinks -> blank panel)
  does not apply. Output lands in .\build\LumenAIStudio-v1.0.0.zxp
#>
param(
  [Parameter(Mandatory=$true)]  [string]$ZxpSignCmd,
  [Parameter(Mandatory=$true)]  [string]$CertPfx,
  [Parameter(Mandatory=$true)]  [string]$CertPassword,
  [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'build')
)
$ErrorActionPreference = 'Stop'
$src  = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zxp  = Join-Path $OutDir 'LumenAIStudio-v1.0.0.zxp'
if (Test-Path $zxp) { Remove-Item $zxp -Force }

# ---- stage only shipping files in a fresh temp folder ----
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("lumen-zxp-stage-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($item in 'index.html', 'CSXS', 'css', 'js', 'jsx', 'icons') {
  Copy-Item (Join-Path $src $item) $stage -Recurse -Force
}
Write-Host "Staged $(Get-ChildItem $stage -Recurse -File | Measure-Object | Select-Object -ExpandProperty Count) shipping files at $stage"

# ---- sign the staged folder ----
& $ZxpSignCmd -sign "$stage" "$zxp" "$CertPfx" "$CertPassword" -tsa http://timestamp.digicert.com
$code = $LASTEXITCODE

# ---- cleanup staging regardless of outcome ----
Remove-Item $stage -Recurse -Force
if ($code -ne 0) { throw "ZXPSignCmd failed with exit code $code" }
Write-Host "Wrote $zxp" -ForegroundColor Green
Write-Host "Install by double-clicking the .zxp with Creative Cloud desktop installed, or extract the v1.0.0 zip manually (see docs/LUMEN-AI-STUDIO-GUIDE.txt)."
