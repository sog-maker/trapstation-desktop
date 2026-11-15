# Installs Trap Station from the release ZIP: unpacks it to %LOCALAPPDATA%\Programs\Trap Station
# and creates a Start menu and desktop shortcut.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Zip ".\Trap Station-0.1.0-win.zip"

param(
    [Parameter(Mandatory = $true)][string]$Zip
)

$ErrorActionPreference = "Stop"
$target = Join-Path $env:LOCALAPPDATA "Programs\Trap Station"
$exe = Join-Path $target "Trap Station.exe"

if (-not (Test-Path $Zip)) { throw "ZIP not found: $Zip" }

if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Expand-Archive -Path $Zip -DestinationPath $target -Force

# the ZIP may hold the program in a sub folder (win-unpacked): move it up
if (-not (Test-Path $exe)) {
    $inner = Get-ChildItem -Path $target -Recurse -Filter "Trap Station.exe" | Select-Object -First 1
    if (-not $inner) { throw "Trap Station.exe not found in the ZIP" }
    Get-ChildItem -Path $inner.DirectoryName | Move-Item -Destination $target -Force
}

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$path) {
    $s = $shell.CreateShortcut($path)
    $s.TargetPath = $exe
    $s.WorkingDirectory = $target
    $s.IconLocation = $exe
    $s.Save()
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
New-Shortcut (Join-Path $startMenu "Trap Station.lnk")
New-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Trap Station.lnk")

Write-Host "Trap Station installed to $target"
Write-Host "Start it from the Start menu or the desktop shortcut."
