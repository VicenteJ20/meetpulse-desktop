param(
  [string]$CargoTargetDir = "",
  [switch]$MockAudio
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

if (-not $MockAudio) {
  $cmakeBin = "C:\Program Files\CMake\bin"
  if ((-not (Get-Command "cmake" -ErrorAction SilentlyContinue)) -and (Test-Path (Join-Path $cmakeBin "cmake.exe"))) {
    $env:PATH = "$cmakeBin;$env:PATH"
  }
  Assert-Command "cmake" "Install CMake from https://cmake.org/download/ and add it to PATH."
  if (-not $env:CMAKE_POLICY_VERSION_MINIMUM) {
    $env:CMAKE_POLICY_VERSION_MINIMUM = "3.5"
  }
}

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

if (-not $env:RUST_LOG) {
  $env:RUST_LOG = "warn"
}

New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null

Write-Host ""
Write-Host "Cargo target dir: $env:CARGO_TARGET_DIR" -ForegroundColor DarkGray
Write-Host "Rust log level: $env:RUST_LOG" -ForegroundColor DarkGray
if ($MockAudio) {
  Write-Host "Audio mode: mock-audio (development fallback)" -ForegroundColor DarkGray
} else {
  Write-Host "Audio mode: native-audio (WASAPI + Opus in Rust)" -ForegroundColor DarkGray
  Write-Host "CMake policy minimum: $env:CMAKE_POLICY_VERSION_MINIMUM" -ForegroundColor DarkGray
}
Write-Host "If Windows Application Control still blocks Rust build scripts, use WSL or allow this folder in your security policy." -ForegroundColor DarkGray

Write-Host ""
Write-Host "Starting Tauri development app..." -ForegroundColor Cyan
if ($MockAudio) {
  npm run tauri:dev -- --features mock-audio
} else {
  npm run tauri:dev -- --features native-audio
}

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Development runner failed with exit code $LASTEXITCODE." -ForegroundColor Red
  Write-Host "If the error says os error 4551, Windows Application Control blocked a Cargo-generated build script." -ForegroundColor Yellow
  Write-Host "If the error says cmake was not found, install CMake or run .\dev.ps1 -MockAudio for UI-only development." -ForegroundColor Yellow
  Write-Host "Current Cargo target folder:" -ForegroundColor Yellow
  Write-Host "  $env:CARGO_TARGET_DIR" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Example:" -ForegroundColor Yellow
  Write-Host '  $env:CARGO_TARGET_DIR="C:\tmp\meetings-recorder-cargo-target"' -ForegroundColor Yellow
  Write-Host "  .\dev.ps1" -ForegroundColor Yellow
  exit $LASTEXITCODE
}
