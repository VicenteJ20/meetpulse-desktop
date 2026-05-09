import { invoke } from "@tauri-apps/api/core";

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "stopping"
  | "completed"
  | "recovering"
  | "error";

export type TrackHealth = {
  status: "ready" | "recording" | "paused" | "silent" | "error" | "unavailable";
  rms: number;
  clipping: boolean;
  message?: string | null;
};

export type RecorderSnapshot = {
  status: RecordingStatus;
  recording_id?: string | null;
  started_at?: string | null;
  duration_ms: number;
  segments_written: number;
  disk_bytes: number;
  mic: TrackHealth;
  system: TrackHealth;
  last_error?: string | null;
};

export type RecordingSummary = {
  id: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  duration_ms: number;
  folder_path: string;
  final_audio_path?: string | null;
  segments: number;
  size_bytes: number;
};

export type AudioDevice = {
  id: string;
  name: string;
  kind: "input" | "output";
  is_default: boolean;
};

let mockSnapshot: RecorderSnapshot = {
  status: "idle",
  recording_id: null,
  started_at: null,
  duration_ms: 0,
  segments_written: 0,
  disk_bytes: 0,
  mic: {
    status: "ready",
    rms: 0,
    clipping: false,
    message: "Web mock",
  },
  system: {
    status: "ready",
    rms: 0,
    clipping: false,
    message: "Web mock",
  },
  last_error: null,
};

let mockStartedAt = 0;
let mockPausedAt = 0;
let mockPausedMs = 0;
let mockRecordings: RecordingSummary[] = [];

export function getRecorderSnapshot(): Promise<RecorderSnapshot> {
  if (!isTauriRuntime) return Promise.resolve(updateMockDuration());
  return invoke("get_recorder_snapshot");
}

export function startRecording(): Promise<RecorderSnapshot> {
  if (!isTauriRuntime) {
    const id = `rec_web_${new Date().toISOString().replace(/:/g, "-").slice(0, 19)}`;
    mockStartedAt = Date.now();
    mockPausedAt = 0;
    mockPausedMs = 0;
    mockSnapshot = {
      ...mockSnapshot,
      status: "recording",
      recording_id: id,
      started_at: new Date().toISOString(),
      duration_ms: 0,
      segments_written: 0,
      disk_bytes: 0,
      mic: { status: "recording", rms: 0.28, clipping: false, message: null },
      system: { status: "recording", rms: 0.18, clipping: false, message: null },
      last_error: null,
    };
    return Promise.resolve(mockSnapshot);
  }
  return invoke("start_recording");
}

export function pauseRecording(): Promise<RecorderSnapshot> {
  if (!isTauriRuntime) {
    mockSnapshot = updateMockDuration();
    mockPausedAt = Date.now();
    mockSnapshot = {
      ...mockSnapshot,
      status: "paused",
      mic: { status: "paused", rms: 0, clipping: false, message: "Pausado" },
      system: { status: "paused", rms: 0, clipping: false, message: "Pausado" },
    };
    return Promise.resolve(mockSnapshot);
  }
  return invoke("pause_recording");
}

export function resumeRecording(): Promise<RecorderSnapshot> {
  if (!isTauriRuntime) {
    if (mockPausedAt) {
      mockPausedMs += Date.now() - mockPausedAt;
      mockPausedAt = 0;
    }
    mockSnapshot = {
      ...mockSnapshot,
      status: "recording",
      mic: { status: "recording", rms: 0.31, clipping: false, message: null },
      system: { status: "recording", rms: 0.2, clipping: false, message: null },
    };
    return Promise.resolve(updateMockDuration());
  }
  return invoke("resume_recording");
}

export function stopRecording(): Promise<RecorderSnapshot> {
  if (!isTauriRuntime) {
    mockSnapshot = updateMockDuration();
    const completed: RecordingSummary = {
      id: mockSnapshot.recording_id ?? "rec_web_unknown",
      status: "completed",
      started_at: mockSnapshot.started_at ?? new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: mockSnapshot.duration_ms,
      folder_path: "web-mock",
      final_audio_path: "web-mock/final",
      segments: Math.max(1, Math.floor(mockSnapshot.duration_ms / 10_000) * 2),
      size_bytes: Math.max(4096, Math.floor(mockSnapshot.duration_ms / 1000) * 14000),
    };
    mockRecordings = [completed, ...mockRecordings].slice(0, 10);
    mockSnapshot = {
      ...mockSnapshot,
      status: "completed",
      segments_written: completed.segments,
      disk_bytes: completed.size_bytes,
      mic: { status: "ready", rms: 0, clipping: false, message: "Finalizado" },
      system: { status: "ready", rms: 0, clipping: false, message: "Finalizado" },
    };
    return Promise.resolve(mockSnapshot);
  }
  return invoke("stop_recording");
}

export function listRecordings(): Promise<RecordingSummary[]> {
  if (!isTauriRuntime) return Promise.resolve(mockRecordings);
  return invoke("list_recordings");
}

export function openRecordingFolder(recordingId: string): Promise<void> {
  if (!isTauriRuntime) {
    console.info(`Web mock cannot open folder for ${recordingId}`);
    return Promise.resolve();
  }
  return invoke("open_recording_folder", { recordingId });
}

export function getAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauriRuntime) {
    return Promise.resolve([
      { id: "web-input", name: "Web mock microphone", kind: "input", is_default: true },
      { id: "web-output", name: "Web mock system audio", kind: "output", is_default: true },
    ]);
  }
  return invoke("get_audio_devices");
}

function updateMockDuration(): RecorderSnapshot {
  if (mockSnapshot.status !== "recording") return mockSnapshot;

  const elapsed = Date.now() - mockStartedAt - mockPausedMs;
  const segments = Math.floor(elapsed / 10_000) * 2;
  mockSnapshot = {
    ...mockSnapshot,
    duration_ms: elapsed,
    segments_written: segments,
    disk_bytes: segments * 2200,
    mic: { status: "recording", rms: 0.2 + Math.random() * 0.18, clipping: false, message: null },
    system: { status: "recording", rms: 0.12 + Math.random() * 0.16, clipping: false, message: null },
  };
  return mockSnapshot;
}
