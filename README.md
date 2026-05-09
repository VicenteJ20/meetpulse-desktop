# Meetings Assistant Recorder

Aplicacion desktop ligera para Windows orientada a grabar reuniones de forma local, resiliente y con bajo uso de memoria.

## Stack

- Tauri 2
- React + TypeScript + Vite
- Tailwind CSS
- Rust
- SQLite local
- Arquitectura preparada para CPAL y WASAPI loopback

## Estado actual

Esta base implementa el control plane completo del MVP:

- widget flotante
- comandos Tauri para iniciar, pausar, reanudar y detener
- estructura de AppData en `AppData\\Local\\MeetingsAssistant`
- SQLite con `recordings`, `segments`, `app_events` y `device_history`
- `manifest.json` por grabacion
- segmentos resilientes con escritura temporal y rename atomico
- recovery de sesiones interrumpidas
- finalizacion local valida con originales Ogg Opus en `final/mic.opus` y `final/system.opus`

El flujo real vive en Rust: `native-audio` captura microfono y audio del escritorio con WASAPI, codifica Opus y deja Tauri/React solo como UI.

## Requisitos de desarrollo

- Node.js 20+
- npm 10+
- Rust estable
- Microsoft C++ Build Tools
- WebView2 Runtime

## Comandos

Entry point recomendado en desarrollo:

```powershell
.\dev.ps1
```

Tambien puedes usar:

```bat
dev.cmd
```

Ese runner valida Node/npm/Rust, instala dependencias si falta `node_modules` y levanta Tauri.
Tambien redirige `CARGO_TARGET_DIR` a `C:\tmp\meetings-recorder-cargo-target` cuando existe esa carpeta, para evitar que Windows Application Control bloquee ejecutables generados dentro de `Documents` o `%TEMP%`.

Si tu Windows bloquea Cargo con `os error 4551`, usa el modo web mock para avanzar UI/estado sin compilar Rust:

```powershell
.\dev-web.ps1
```

Este modo corre Vite en navegador y simula los comandos Tauri. No graba audio ni escribe en AppData.

Comandos manuales equivalentes:

```bash
npm install
npm run tauri:dev
```

Si Windows muestra `os error 4551`, una politica de Application Control bloqueo un ejecutable generado por Cargo. En ese caso:

```powershell
$env:CARGO_TARGET_DIR="C:\tmp\meetings-recorder-cargo-target"
.\dev.ps1
```

O pasalo como parametro, que es mas explicito:

```powershell
.\dev.ps1 -CargoTargetDir "C:\tmp\meetings-recorder-cargo-target"
```

Si aun ocurre, la politica de seguridad debe permitir Rust build scripts o debes ejecutar el desarrollo desde WSL.

Mas detalle: [docs/windows-application-control.md](docs/windows-application-control.md)

Build:

```bash
npm run tauri:build
```

Activar captura nativa cuando los workers esten implementados:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --features native-audio
```

Nota: `native-audio` activa dependencias como CPAL, WASAPI y Opus. En Windows, `opus` puede requerir CMake porque compila `audiopus_sys`. Usa `.\dev.ps1 -MockAudio` para desarrollo de UI sin dependencias nativas.

## Estructura

```text
src/
  lib/
  store/
  tauri/
  ui/

src-tauri/
  src/
    audio.rs
    app_state.rs
    commands.rs
    finalizer.rs
    manifest.rs
    paths.rs
    recorder.rs
    recovery.rs
    storage.rs
```

## Persistencia local

La app escribe en:

```text
C:\\Users\\<usuario>\\AppData\\Local\\MeetingsAssistant
```

Cada grabacion queda con esta forma:

```text
recordings/
  rec_yyyy-mm-dd_hh-mm-ss_xxxxxx/
    manifest.json
    lock
    mic/
    system/
    final/
```

## Roadmap tecnico inmediato

1. Implementar `MicCaptureWorker` con CPAL.
2. Implementar `SystemAudioCaptureWorker` con WASAPI loopback.
3. Reemplazar payload mock por Ogg Opus real.
4. Agregar resampling a 48 kHz con `rubato`.
5. Reemplazar mezcla placeholder por decode/mix/encode con headroom.
6. Agregar pruebas de recovery y segment writer.
