param(
  [string]$CargoTargetDir = ""
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$InstallHint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Missing required command: $Name" -ForegroundColor Red
    Write-Host $InstallHint -ForegroundColor Yellow
    exit 1
  }
}

Set-Location $PSScriptRoot

Write-Host "Meetings Assistant Recorder - dev runner" -ForegroundColor Cyan

Assert-Command "node" "Install Node.js 20+ from https://nodejs.org/"
Assert-Command "npm" "Install Node.js 20+ from https://nodejs.org/; npm is bundled with it."
Assert-Command "cargo" "Install Rust from https://rustup.rs/"
Assert-Command "rustc" "Install Rust from https://rustup.rs/"

if (-not (Test-Path "node_modules")) {
  Write-Host ""
  Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
  npm install
}

$preferredCargoTarget = "C:\tmp\meetings-recorder-cargo-target"
$fallbackCargoTarget = Join-Path $env:TEMP "meetings-recorder-cargo-target"
$defaultCargoTarget = if (Test-Path "C:\tmp") { $preferredCargoTarget } else { $fallbackCargoTarget }

if ($CargoTargetDir) {
  $env:CARGO_TARGET_DIR = $CargoTargetDir
} elseif ((Test-Path "C:\tmp") -and ((-not $env:CARGO_TARGET_DIR) -or ($env:CARGO_TARGET_DIR -eq $fallbackCargoTarget))) {
  $env:CARGO_TARGET_DIR = $preferredCargoTarget
} elseif (-not $env:CARGO_TARGET_DIR) {
  $env:CARGO_TARGET_DIR = $defaultCargoTarget
}

New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null

Write-Host ""
Write-Host "Cargo target dir: $env:CARGO_TARGET_DIR" -ForegroundColor DarkGray
Write-Host "If Windows Application Control still blocks Rust build scripts, use WSL or allow this folder in your security policy." -ForegroundColor DarkGray

Write-Host ""
Write-Host "Starting Tauri development app..." -ForegroundColor Cyan
npm run tauri:dev

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Development runner failed with exit code $LASTEXITCODE." -ForegroundColor Red
  Write-Host "If the error says os error 4551, Windows Application Control blocked a Cargo-generated build script." -ForegroundColor Yellow
  Write-Host "If the error says cmake was not found, install CMake or keep using the default mock-audio feature." -ForegroundColor Yellow
  Write-Host "Current Cargo target folder:" -ForegroundColor Yellow
  Write-Host "  $env:CARGO_TARGET_DIR" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Example:" -ForegroundColor Yellow
  Write-Host '  $env:CARGO_TARGET_DIR="C:\tmp\meetings-recorder-cargo-target"' -ForegroundColor Yellow
  Write-Host "  .\dev.ps1" -ForegroundColor Yellow
  exit $LASTEXITCODE
}
