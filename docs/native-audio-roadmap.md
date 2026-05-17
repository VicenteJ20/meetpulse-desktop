# Native Audio Roadmap

## Phase 1: Microphone with CPAL

- [x] Enumerate input devices
- [x] Use default microphone if no selection
- [x] Open input stream with supported config
- [x] Convert sample format to `f32`
- [x] Mix channels to mono
- [x] Send 20 ms frames to the encoder

### Pending

- [ ] Defensive resampling to 48 kHz for devices that don't support it natively

## Phase 2: System audio with WASAPI loopback

- [x] Get default render endpoint
- [x] Initialize `IAudioClient` in loopback mode
- [x] Capture buffer per packet
- [x] Handle silence without emitting errors
- [x] Maintain stereo in MVP
- [x] Retry if default device changes

## Phase 3: Ogg Opus encoder

- [x] Create encoder per track
- [x] Use 48 kHz
- [x] Mic mono at 48 kbps
- [x] System stereo at 64 kbps
- [x] Close Ogg page on each segment finalization
- [x] Write minimal metadata for traceability

## Phase 4: Final mixing

- [x] Decode `mic/*.opus` and `system/*.opus` segments
- [x] Align by segment timestamps
- [x] Apply headroom to avoid clipping
- [x] Encode `final/mixed.opus`

## Risks

- WASAPI loopback may deliver different formats per device
- Windows suspend/resume can invalidate audio clients
- Some Bluetooth devices change sample rate dynamically
- Final mixing requires real temporal synchronization, not just concatenation
