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

Write-Host "Meetings Assistant Recorder - web mock runner" -ForegroundColor Cyan
Write-Host "This mode does not compile Rust/Tauri and is intended for UI/state development under WDAC." -ForegroundColor DarkGray

Assert-Command "node" "Install Node.js 20+ from https://nodejs.org/"
Assert-Command "npm" "Install Node.js 20+ from https://nodejs.org/; npm is bundled with it."

if (-not (Test-Path "node_modules")) {
  Write-Host ""
  Write-Host "Installing frontend dependencies..." -ForegroundColor Cyan
  npm install
}

Write-Host ""
Write-Host "Starting web mock app..." -ForegroundColor Cyan
npm run dev:web
