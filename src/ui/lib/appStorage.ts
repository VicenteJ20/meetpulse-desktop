import type { AppTheme, AudioMetadata } from "./audioTypes";

export const backendUrlStorageKey = "meetings-assistant-backend-url";
export const transcriptionApiKeyStorageKey = "meetings-assistant-transcription-api-key";
export const themeStorageKey = "meetings-assistant-theme";

const audioMetadataStorageKey = "meetings-assistant-audio-metadata";
const audioCloudJobStorageKey = "meetings-assistant-audio-cloud-jobs";
const defaultBackendUrl = import.meta.env.VITE_MEETPULSE_BACKEND_URL?.trim().replace(/\/+$/, "") || "http://localhost:8000";

export function loadAudioMetadata(): Record<string, AudioMetadata> {
  try {
    const raw = localStorage.getItem(audioMetadataStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AudioMetadata>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAudioMetadata(metadata: Record<string, AudioMetadata>) {
  localStorage.setItem(audioMetadataStorageKey, JSON.stringify(metadata));
}

export function loadAudioCloudJobs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(audioCloudJobStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, jobId]) => typeof jobId === "string"));
  } catch {
    return {};
  }
}

export function saveAudioCloudJobs(value: Record<string, string>) {
  localStorage.setItem(audioCloudJobStorageKey, JSON.stringify(value));
}

export function loadBackendUrl(): string {
  const savedBackendUrl = localStorage.getItem(backendUrlStorageKey);
  if (savedBackendUrl) return savedBackendUrl;

  const legacyEndpoint = localStorage.getItem("meetings-assistant-transcription-endpoint");
  if (!legacyEndpoint) return defaultBackendUrl;

  try {
    const url = new URL(legacyEndpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return defaultBackendUrl;
  }
}

export function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

export function loadStoredTheme(): AppTheme {
  const stored = localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" ? stored : "dark";
}
