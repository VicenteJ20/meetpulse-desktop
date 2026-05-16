import { convertFileSrc } from "@tauri-apps/api/core";
import { defaultRecordingFileName, isTauriRuntime, type RecordingSummary } from "../../tauri/commands";
import type { AudioMetadata, AudioRow, DraftState } from "./audioTypes";
import { allProjects, unclassifiedClient } from "./libraryConstants";

export function audioDurationMs(row: AudioRow, durationById: Record<string, number>): number {
  return durationById[row.recording.id] || row.recording.source_duration_ms || row.recording.duration_ms || 0;
}

export function isDraftClient(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "drafts" || normalized === "sin clasificar";
}

export function inferMetadata(recording: RecordingSummary): AudioMetadata {
  const pathParts = recording.final_audio_path?.split(/[\\/]/).filter(Boolean) ?? [];
  const assistantIndex = pathParts.findIndex((part) => part.toLowerCase() === "meetings assistant");
  const client = assistantIndex >= 0 ? pathParts[assistantIndex + 1] : "";
  const project = assistantIndex >= 0 ? pathParts[assistantIndex + 2] : "";
  const isDraft = client?.toLowerCase() === "drafts";
  const normalizedClient = isDraft ? unclassifiedClient : client || unclassifiedClient;

  return {
    client: normalizedClient,
    project: isDraft ? "Drafts" : project || allProjects,
    title: displayRecordingName(recording),
    notes: "",
    draftState: isDraft ? "draft_saved" : resolveAudioStatus("unclassified", normalizedClient),
  };
}

export function resolveAudioStatus(state: DraftState, client: string): DraftState {
  const normalizedClient = client.trim().toLowerCase();
  if (normalizedClient && !isDraftClient(normalizedClient)) {
    return state === "archived" ? "archived" : "classified";
  }

  return state;
}

export function buildClientGroups(rows: AudioRow[]) {
  const counts = new Map<string, number>();
  counts.set(unclassifiedClient, 0);

  rows.forEach((row) => {
    counts.set(row.client, (counts.get(row.client) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => {
      if (left.name === unclassifiedClient) return -1;
      if (right.name === unclassifiedClient) return 1;
      return left.name.localeCompare(right.name);
    });
}

export function buildProjectsForClient(rows: AudioRow[], selectedClient: string) {
  const visibleRows = rows.filter((row) => row.client === selectedClient);
  const counts = new Map<string, number>();
  counts.set(allProjects, visibleRows.length);

  visibleRows.forEach((row) => {
    counts.set(row.project, (counts.get(row.project) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

export function toPlayableAudioSrc(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!isTauriRuntime) return path;
  return convertFileSrc(path);
}

export function recordingAudioPath(recording: RecordingSummary): string {
  if (recording.audio_url) return recording.audio_url;
  if (recording.final_audio_path) return recording.final_audio_path;
  if (!recording.folder_path) return "";
  return `${recording.folder_path.replace(/[\\/]$/, "")}\\final\\mixed.opus`;
}

export function audioFileName(path: string, displayName: string): string {
  const rawFileName = path.split(/[\\/]/).pop();
  const rawExtension = rawFileName?.match(/\.(mp3|opus)$/i)?.[0] ?? ".opus";

  const safeName = displayName
    .trim()
    .replace(/\.(mp3|opus)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim();

  return `${safeName || rawFileName?.replace(/\.(mp3|opus)$/i, "") || "audio"}${rawExtension}`;
}

export function transcriptionRelativePath(client: string, project: string): string {
  const cleanClient = sanitizeRelativePathPart(client);
  const cleanProject = sanitizeRelativePathPart(project);
  if (cleanClient && !isDraftClient(cleanClient)) {
    return cleanProject && cleanProject !== allProjects.toLowerCase() ? `${cleanClient}/${cleanProject}` : cleanClient;
  }
  return "drafts";
}

export function sanitizeRelativePathPart(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[ .]+$/g, "")
    .toLowerCase();
}

export function displayRecordingName(recording: { final_audio_path?: string | null; started_at: string; id: string }): string {
  const fileName = recording.final_audio_path?.split(/[\\/]/).pop()?.replace(/\.opus$/i, "");
  if (fileName) return fileName;

  const startedAt = new Date(recording.started_at);
  if (!Number.isNaN(startedAt.getTime())) {
    return defaultRecordingFileName(startedAt);
  }

  return recording.id.replace("rec_", "");
}
