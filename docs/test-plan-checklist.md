# Test Plan Checklist

## Base app

- [x] Window opens as floating widget
- [x] Buttons change state correctly
- [x] App creates `AppData\Local\MeetingsAssistant`
- [x] SQLite creates and migrates without errors

## Segmentation

- [x] Each segment is first written as `.tmp`
- [x] Confirmed segment becomes `.opus` Ogg Opus
- [x] `manifest.json` updates atomically
- [x] SQLite registers confirmed segments
- [x] RAM usage remains stable

## Recovery

- [x] On startup, removes old `.tmp` files
- [x] On startup, removes stale locks
- [x] A `recording` session becomes `interrupted_recovered`
- [x] Confirmed segments re-registered in SQLite

## Safe stop

- [x] Stop transitions to `stopping`
- [x] Last segment is confirmed
- [x] Manifest becomes `completed`
- [x] Only `final/mixed.opus` is generated
- [x] UI lists the recording

## Native audio

- [x] Microphone recording for 5+ minutes
- [x] PC audio recording from browser playback
- [x] Dual-track simultaneous recording
- [x] Pause/resume without loss of control
- [ ] Microphone disconnect reports recoverable error

## Cloud sync

- [x] OAuth2 Google login flow
- [x] Recording upload to backend
- [x] Transcription request via AI pipeline
- [ ] Calendar meeting matching
