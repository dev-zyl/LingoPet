$ErrorActionPreference = "Stop"

Write-Host "Closing Codex processes..."
Get-Process -Name Codex,codex -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

$pkg = Get-AppxPackage -Name OpenAI.Codex
if (-not $pkg) {
  throw "OpenAI.Codex package was not found. Reinstall Codex from its official installer or Microsoft Store source."
}

$manifest = Join-Path $pkg.InstallLocation "AppxManifest.xml"
if (-not (Test-Path -LiteralPath $manifest)) {
  throw "AppxManifest.xml was not found at $manifest"
}

Write-Host "Registering $($pkg.PackageFullName)..."
Add-AppxPackage -DisableDevelopmentMode -Register $manifest

Write-Host ""
Write-Host "Codex package after repair:"
Get-AppxPackage -Name OpenAI.Codex |
  Select-Object Name,PackageFullName,Version,InstallLocation,Status |
  Format-List

Write-Host "Done. Start Codex again from the Start menu."
