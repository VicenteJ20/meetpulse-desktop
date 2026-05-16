import type { RecordingSummary } from "../../tauri/commands";

export type AppTheme = "light" | "dark";

export type DraftState = "unclassified" | "classified" | "draft_ready" | "draft_saved" | "archived";

export type AudioMetadata = {
  client: string;
  project: string;
  title: string;
  notes: string;
  draftState: DraftState;
};

export type AudioRow = {
  recording: RecordingSummary;
  metadata: AudioMetadata;
  displayName: string;
  client: string;
  project: string;
  clientSlug?: string;
  projectSlug?: string;
  status: DraftState;
  source: "local" | "cloud";
  cloudJobId?: string;
};

export type CloudClient = {
  slug: string;
  display_name: string;
  status?: string;
  projects?: string[];
  tags?: string[];
};

export type CloudProject = {
  slug: string;
  display_name: string;
  client: string;
  status?: string;
};

export type CloudJob = {
  job_id: string;
  source_filename: string;
  source_size_bytes?: number;
  source_duration_ms?: number | null;
  relative_path?: string;
  status: string;
  accepted_at?: string;
  completed_at?: string | null;
  has_audio?: boolean;
  audio_url?: string | null;
  has_transcription?: boolean;
  has_analysis?: boolean;
};
