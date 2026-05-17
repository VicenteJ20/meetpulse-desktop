import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export const isTauriRuntime = "__TAURI_INTERNALS__" in window;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const delays = [120, 240, 480, 960];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await tauriInvoke<T>(command, args);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("state not managed") || attempt === delays.length) break;
      await sleep(delays[attempt]);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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
  audio_url?: string | null;
  source_duration_ms?: number | null;
  segments: number;
  size_bytes: number;
};

export type AudioDevice = {
  id: string;
  name: string;
  kind: "input" | "output";
  is_default: boolean;
};

export type AudioDeviceSelection = {
  input_device_id?: string | null;
  output_device_id?: string | null;
};

export type SavedAudio = {
  path: string;
};

export type TranscriptionRequestResult = {
  status: number;
  body: string;
};

export type CloudDashboard = {
  clients: unknown;
  projects: unknown;
  jobs: unknown;
};

export type CloudJobArtifacts = {
  transcription?: string | null;
  analysis?: string | null;
};

export type AnalysisRetryResult = {
  accepted: boolean;
  message: string;
  job_id: string;
  status: string;
};

export type AuthState = {
  is_authenticated: boolean;
  email: string | null;
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
      final_audio_path: "web-mock/final/mixed.opus",
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

export function cleanupLocalRecording(recordingId: string): Promise<void> {
  if (!isTauriRuntime) {
    mockRecordings = mockRecordings.filter((recording) => recording.id !== recordingId);
    return Promise.resolve();
  }
  return invoke("cleanup_local_recording", { recordingId });
}

export function openExternalUrl(url: string): Promise<void> {
  if (!isTauriRuntime) {
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  }
  return invoke("open_external_url", { url });
}

export function saveRecordingToLibrary({
  recordingId,
  client,
  project,
  fileName,
  draft,
}: {
  recordingId: string;
  client?: string;
  project?: string;
  fileName?: string;
  draft: boolean;
}): Promise<SavedAudio> {
  if (!isTauriRuntime) {
    const normalizedName = fileName?.trim() || defaultRecordingFileName(new Date());
    const path = draft
      ? `Music/MeetPulse/drafts/${normalizedName}.opus`
      : `Music/MeetPulse/${client || "Cliente"}/${project || "Proyecto"}/${normalizedName}.opus`;
    mockRecordings = mockRecordings.map((recording) =>
      recording.id === recordingId ? { ...recording, final_audio_path: path } : recording,
    );
    return Promise.resolve({ path });
  }
  return invoke("save_recording_to_library", { recordingId, client, project, fileName, draft });
}

export function requestTranscription({
  recordingId,
  client,
  project,
  fileName,
  durationMs,
}: {
  recordingId: string;
  client?: string;
  project?: string;
  fileName?: string;
  durationMs?: number;
}): Promise<TranscriptionRequestResult> {
  if (!isTauriRuntime) {
    return Promise.resolve({ status: 202, body: "{}" });
  }

  return invoke("request_transcription", { recordingId, client, project, fileName, durationMs });
}

export async function requestAnalysisRetry({
  jobId,
}: {
  jobId: string;
}): Promise<AnalysisRetryResult> {
  if (!isTauriRuntime) {
    throw new Error("Mock analysis retry not supported without tauri");
  }

  return invoke("request_analysis_retry", { jobId });
}

export async function archiveCloudJob(jobId: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("archive_cloud_job", { jobId });
}

export async function unarchiveCloudJob(jobId: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("unarchive_cloud_job", { jobId });
}

export async function deleteCloudJob(jobId: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("delete_cloud_job", { jobId });
}

export async function archiveCloudClient(clientSlug: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("archive_cloud_client", { clientSlug });
}

export async function deleteCloudClient(clientSlug: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("delete_cloud_client", { clientSlug });
}

export async function archiveCloudProject(clientSlug: string, projectSlug: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("archive_cloud_project", { clientSlug, projectSlug });
}

export async function deleteCloudProject(clientSlug: string, projectSlug: string): Promise<void> {
  if (!isTauriRuntime) return Promise.resolve();
  return invoke("delete_cloud_project", { clientSlug, projectSlug });
}

export async function syncCloudDashboard(): Promise<CloudDashboard> {
  if (!isTauriRuntime) {
    return { clients: [], projects: [], jobs: { items: [], total: 0 } };
  }

  return invoke("sync_cloud_dashboard");
}

export async function listArchivedCloudJobs(): Promise<unknown> {
  if (!isTauriRuntime) {
    return [];
  }

  return invoke("list_archived_cloud_jobs");
}

export async function getCloudJobArtifacts({
  jobId,
  includeTranscription,
  includeAnalysis,
}: {
  jobId: string;
  includeTranscription: boolean;
  includeAnalysis: boolean;
}): Promise<CloudJobArtifacts> {
  if (!isTauriRuntime) {
    return { transcription: null, analysis: null };
  }

  return invoke("get_cloud_job_artifacts", { jobId, includeTranscription, includeAnalysis });
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

async function fetchJsonWithApiKey(url: string, apiKey: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`El backend respondio ${response.status}.`);
  }

  return response.json();
}

async function fetchResponseErrorMessage(response: Response): Promise<string> {
  const fallback = `El backend respondio ${response.status}.`;
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
    if (typeof payload?.message === "string") return payload.message;
    return fallback;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim() || fallback;
  }
}

async function fetchJobArtifactContent(
  baseUrl: string,
  apiKey: string,
  jobId: string,
  artifactType: "transcription_md" | "analysis_md",
): Promise<string | null> {
  const payload = await fetchJsonWithApiKey(
    `${baseUrl.replace(/\/+$/, "")}/v1/jobs/${jobId}/artifacts/${artifactType}/content`,
    apiKey,
  );
  if (!payload || typeof payload !== "object" || !("content" in payload)) return null;
  const content = (payload as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

export function getSelectedAudioDevices(): Promise<AudioDeviceSelection> {
  if (!isTauriRuntime) {
    return Promise.resolve({
      input_device_id: localStorage.getItem("mock-input-device") ?? "web-input",
      output_device_id: localStorage.getItem("mock-output-device") ?? "web-output",
    });
  }
  return invoke("get_selected_audio_devices");
}

export function selectAudioDevice(kind: "input" | "output", deviceId: string): Promise<AudioDeviceSelection> {
  if (!isTauriRuntime) {
    localStorage.setItem(kind === "input" ? "mock-input-device" : "mock-output-device", deviceId);
    return getSelectedAudioDevices();
  }
  return invoke("select_audio_device", { kind, deviceId });
}

export function defaultRecordingFileName(date: Date): string {
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return `grabacion_${day}_${month}_${year}_${hour}_${minute}`;
}

export function getAuthState(): Promise<AuthState> {
  if (!isTauriRuntime) {
    return Promise.resolve({ is_authenticated: false, email: null });
  }
  return invoke("get_auth_state");
}

export function startGoogleAuth(): Promise<AuthState> {
  if (!isTauriRuntime) {
    return Promise.resolve({ is_authenticated: true, email: "test@example.com" });
  }
  return invoke("start_google_auth");
}

export function logoutAuth(): Promise<void> {
  if (!isTauriRuntime) {
    return Promise.resolve();
  }
  return invoke("logout_auth");
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
