# MeetPulse

A lightweight Windows desktop app for recording meetings locally with resilience, low memory usage, and native audio capture.

![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Rust](https://img.shields.io/badge/Rust-1.78+-black?logo=rust)
![License](https://img.shields.io/badge/license-Private-blue)

## Features

- **Native audio capture** — Microphone and desktop audio via WASAPI loopback (Rust + CPAL)
- **Resilient recording** — Atomic segment writes, crash recovery, and session restoration
- **Local-first** — Recordings stored in `AppData\Local\MeetingsAssistant` with SQLite metadata
- **Floating widget** — Minimal always-on-top control bar for start/pause/stop
- **Opus encoding** — Ogg Opus output with segment-level manifest tracking
- **Google Calendar integration** — OAuth2 authentication for meeting context (planned)

## Architecture

MeetPulse follows a strict separation between UI and audio core:

```
React/TypeScript (UI)  ←Tauri IPC→  Rust (audio, storage, recovery)
```

The Rust backend handles all native operations: WASAPI capture, Opus encoding, SQLite persistence, atomic segment writes, and crash recovery. The frontend is a thin control plane that sends commands and receives events.

See [docs/architecture.md](docs/architecture.md) for the full technical breakdown.

## Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| UI          | React 18 + TypeScript + Zustand     |
| Styling     | Tailwind CSS + Lucide Icons         |
| Build       | Vite 5                              |
| Desktop     | Tauri 2                             |
| Audio core  | Rust, CPAL, WASAPI, Opus            |
| Storage     | SQLite (rusqlite bundled)           |
| Auth        | OAuth2 (Google Calendar, planned)   |

## Quick Start

### Prerequisites

- **Node.js** 20+ and npm 10+
- **Rust** stable (1.78+) via [rustup](https://rustup.rs/)
- **Microsoft C++ Build Tools** (for native dependencies)
- **WebView2 Runtime** (preinstalled on Windows 10/11)

### Setup

1. Clone the repository
2. Copy and configure environment variables:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` with your backend URL and optional Google OAuth credentials:

   ```env
   MEETPULSE_BACKEND_URL=http://localhost:8000
   VITE_MEETPULSE_BACKEND_URL=http://localhost:8000
   GOOGLE_CLIENT_ID=your_google_client_id_here
   GOOGLE_CLIENT_SECRET=your_google_client_secret_here
   ```

### Development

**Recommended** — use the dev runner (validates prerequisites, installs deps, handles Cargo target dir):

```powershell
.\dev.ps1
```

**Alternative** — manual commands:

```powershell
npm install
npm run tauri:dev
```

**Web mock mode** — if Windows Application Control blocks Cargo executables (`os error 4551`):

```powershell
.\dev-web.ps1
```

This runs Vite in the browser with mocked Tauri commands. No audio capture or AppData writes.

### Build

```powershell
$env:MEETPULSE_BACKEND_URL="https://your-api.com"
$env:VITE_MEETPULSE_BACKEND_URL="https://your-api.com"
npm run tauri:build
```

Output installers (`.msi` / `.exe`) will be in `src-tauri/target/release/bundle/`.

## Recording Storage

Recordings are stored locally at:

```
C:\Users\<user>\AppData\Local\MeetingsAssistant\
```

Each recording follows this structure:

```
recordings/
  rec_yyyy-mm-dd_hh-mm-ss_xxxxxx/
    manifest.json      # segment metadata and status
    lock               # active recording lock file
    mic/               # microphone Opus segments
    system/            # desktop audio Opus segments
    final/
      mixed.opus       # final mixed output
```

## Project Structure

```
src/                          # Frontend (React + TypeScript)
  lib/                        # Shared utilities
  hooks/                      # React custom hooks
  store/                      # Zustand state management
  tauri/                      # Tauri command bindings
  ui/                         # Components and views

src-tauri/                    # Backend (Rust + Tauri)
  src/
    commands.rs               # Tauri command handlers
    recorder.rs               # Recording lifecycle manager
    audio.rs                  # Device enumeration and capture
    finalizer.rs              # Final audio mixing and output
    manifest.rs               # Atomic manifest writer
    recovery.rs               # Crash recovery and cleanup
    storage.rs                # SQLite database and queries
    paths.rs                  # AppData path resolution
    app_state.rs              # Shared application state

docs/                         # Technical documentation
```

## Troubleshooting

### Windows Application Control blocks Cargo (`os error 4551`)

Redirect the Cargo target directory to an allowed path:

```powershell
.\dev.ps1 -CargoTargetDir "C:\tmp\meetings-recorder-cargo-target"
```

Or set it manually:

```powershell
$env:CARGO_TARGET_DIR="C:\tmp\meetings-recorder-cargo-target"
.\dev.ps1
```

See [docs/windows-application-control.md](docs/windows-application-control.md) for details.

### Native audio feature requires CMake

The `native-audio` feature compiles `opus` via `audiopus_sys`, which may need CMake. Install it via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) or [chocolatey](https://chocolatey.org/):

```powershell
winget install Kitware.CMake
```

Use `mock-audio` feature for UI development without native dependencies:

```powershell
.\dev.ps1 -MockAudio
```

## Roadmap

- [ ] Defensive resampling for devices that don't support 48 kHz
- [ ] Unit tests for recovery, segment writer, and final mixing
- [ ] Device health metrics in `device_history` table
- [ ] Google Calendar integration for automatic meeting detection
- [ ] Cloud sync and AI transcription pipeline

## License

Private — All rights reserved. © 2026 Vicente Jorquera.
