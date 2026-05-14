import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ChevronRight,
  CheckCircle2,
  Clock3,
  Copy,
  Disc3,
  Eye,
  ExternalLink,
  FileAudio,
  FolderOpen,
  History,
  Loader2,
  ListMusic,
  Maximize2,
  Mic,
  Minus,
  MonitorSpeaker,
  Pause,
  Pin,
  Play,
  Save,
  Search,
  Settings,
  Sparkles,
  SlidersHorizontal,
  Square,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { formatDuration } from "../lib/format";
import appIcon from "../assets/app-icon.png";
import {
  cleanupLocalRecording,
  defaultRecordingFileName,
  getCloudJobArtifacts,
  getAudioDevices,
  getSelectedAudioDevices,
  isTauriRuntime,
  openExternalUrl,
  openRecordingFolder,
  requestAnalysisRetry,
  requestTranscription,
  saveRecordingToLibrary,
  selectAudioDevice,
  syncCloudDashboard,
  type AudioDevice,
  type RecordingSummary,
} from "../tauri/commands";
import {
  applyWindowMode,
  closeWindow,
  currentWindowLabel,
  minimizeWindow,
  setWindowAlwaysOnTop,
  showWindow,
  startWindowDrag,
} from "../tauri/window";
import { useAuthStore } from "../store/authStore";
import { useRecorderStore } from "../store/recorderStore";

const bars = [
  0.52, 0.7, 0.38, 0.78, 0.66, 0.46, 0.3, 0.58, 0.24, 0.51, 0.72, 0.37, 0.44, 0.64, 0.29, 0.53, 0.4, 0.62,
  0.35, 0.75, 0.28, 0.45, 0.59, 0.33, 0.49, 0.71, 0.39, 0.56, 0.48, 0.8, 0.34, 0.61, 0.4, 0.68, 0.3, 0.54,
  0.44, 0.76, 0.36, 0.58,
];

const audioMetadataStorageKey = "meetings-assistant-audio-metadata";
const audioCloudJobStorageKey = "meetings-assistant-audio-cloud-jobs";
const backendUrlStorageKey = "meetings-assistant-backend-url";
const transcriptionApiKeyStorageKey = "meetings-assistant-transcription-api-key";
const defaultBackendUrl = "http://localhost:8000";
const unclassifiedClient = "Drafts";
const allProjects = "Todos los proyectos";
const legacyExpandedRecorderEnabled = false;

const emptyRecordingSummary: RecordingSummary = {
  id: "",
  status: "idle",
  started_at: new Date(0).toISOString(),
  completed_at: null,
  duration_ms: 0,
  folder_path: "",
  final_audio_path: null,
  segments: 0,
  size_bytes: 0,
};

type DraftState = "unclassified" | "classified" | "draft_ready" | "draft_saved" | "archived";

type AudioMetadata = {
  client: string;
  project: string;
  title: string;
  notes: string;
  draftState: DraftState;
};

type AudioRow = {
  recording: RecordingSummary;
  metadata: AudioMetadata;
  displayName: string;
  client: string;
  project: string;
  status: DraftState;
  source: "local" | "cloud";
  cloudJobId?: string;
};

type CloudClient = {
  slug: string;
  display_name: string;
  status?: string;
  projects?: string[];
  tags?: string[];
};

type CloudProject = {
  slug: string;
  display_name: string;
  client: string;
  status?: string;
};

type CloudJob = {
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

export function App() {
  const { snapshot, recordings, loading, error, init, refresh, start, pause, resume, stop } = useRecorderStore();
  const { authState, init: initAuth, login, logout } = useAuthStore();
  const windowLabel = currentWindowLabel();
  const isWidgetWindow = windowLabel === "widget";
  const [now, setNow] = useState(() => Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const [dashboardView, setDashboardView] = useState<"library" | "settings">("library");
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem("recorder-view-mode") === "compact");
  const [pinned, setPinned] = useState(() => localStorage.getItem("recorder-window-pinned") === "true");
  const [saveClient, setSaveClient] = useState("");
  const [saveProject, setSaveProject] = useState("");
  const [saveFileName, setSaveFileName] = useState("");
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveNotes, setSaveNotes] = useState("");
  const [metadataById, setMetadataById] = useState<Record<string, AudioMetadata>>(() => loadAudioMetadata());
  const [cloudJobByRecordingId, setCloudJobByRecordingId] = useState<Record<string, string>>(() => loadAudioCloudJobs());
  const [selectedClient, setSelectedClient] = useState(unclassifiedClient);
  const [selectedProject, setSelectedProject] = useState(allProjects);
  const [audioQuery, setAudioQuery] = useState("");
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [playerCurrentMs, setPlayerCurrentMs] = useState(0);
  const [playerDurationMs, setPlayerDurationMs] = useState(0);
  const [audioDurationById, setAudioDurationById] = useState<Record<string, number>>({});
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState(() => loadBackendUrl());
  const [transcriptionApiKey, setTranscriptionApiKey] = useState(() => localStorage.getItem(transcriptionApiKeyStorageKey) ?? "");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [cloudClients, setCloudClients] = useState<CloudClient[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [cloudJobs, setCloudJobs] = useState<CloudJob[]>([]);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [cloudSyncedAt, setCloudSyncedAt] = useState<string | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [selectedArtifacts, setSelectedArtifacts] = useState<{ transcription?: string | null; analysis?: string | null }>({});
  const [artifactTab, setArtifactTab] = useState<"transcription" | "analysis">("transcription");
  const [artifactCopyState, setArtifactCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void init();
    void initAuth();
  }, [init, initAuth]);

  useEffect(() => {
    if (isWidgetWindow) return;
    if (!normalizeBackendUrl(backendUrl) || !transcriptionApiKey.trim()) return;
    void refreshCloudDashboard({ showMessage: false });
  }, [backendUrl, isWidgetWindow, transcriptionApiKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      try {
        const [devices, selection] = await Promise.all([getAudioDevices(), getSelectedAudioDevices()]);
        if (cancelled) return;
        setAudioDevices(devices);
        const defaultInput =
          devices.find((device) => device.kind === "input" && device.is_default)?.id ??
          devices.find((device) => device.kind === "input")?.id ??
          "";
        const defaultOutput =
          devices.find((device) => device.kind === "output" && device.is_default)?.id ??
          devices.find((device) => device.kind === "output")?.id ??
          "";
        setSelectedInputId(devices.some((device) => device.id === selection.input_device_id) ? selection.input_device_id ?? "" : defaultInput);
        setSelectedOutputId(devices.some((device) => device.id === selection.output_device_id) ? selection.output_device_id ?? "" : defaultOutput);
        setDeviceError(null);
      } catch (error) {
        if (!cancelled) setDeviceError(error instanceof Error ? error.message : String(error));
      }
    }

    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isWidgetWindow) {
      void applyWindowMode(true);
      return;
    }

    if (!isTauriRuntime) {
      localStorage.setItem("recorder-view-mode", compactMode ? "compact" : "full");
    }
  }, [compactMode, isWidgetWindow]);

  useEffect(() => {
    localStorage.setItem("recorder-window-pinned", pinned ? "true" : "false");
    void setWindowAlwaysOnTop(pinned);
  }, [pinned]);

  useEffect(() => {
    setSaveError(null);
    setSavedPath(null);
    setSaveFileName("");
  }, [snapshot?.recording_id]);

  useEffect(() => {
    setPlayerCurrentMs(0);
    setPlayerDurationMs(0);
    setPlayerPlaying(false);
    setPlayerError(null);
  }, [activeAudioId]);

  const compactView = isWidgetWindow || (!isTauriRuntime && compactMode);
  const status = snapshot?.status ?? "idle";
  const durationMs = useLiveDuration(snapshot, now);
  const duration = formatWidgetDuration(durationMs);
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isBusy = loading || status === "starting" || status === "stopping";
  const isActive = isRecording || isPaused || status === "starting" || status === "stopping";
  const inputDevices = audioDevices.filter((device) => device.kind === "input");
  const outputDevices = audioDevices.filter((device) => device.kind === "output");
  const micLevel = snapshot?.mic.status === "recording" ? (snapshot?.mic.rms ?? 0) : 0;
  const systemLevel = snapshot?.system.status === "recording" ? (snapshot?.system.rms ?? 0) : 0;
  const visibleMicBars = createMeterBars(micLevel);
  const visibleSystemBars = createMeterBars(systemLevel);
  const suggestedFileName = snapshot?.started_at ? defaultRecordingFileName(new Date(snapshot.started_at)) : defaultRecordingFileName(new Date());
  const visibleRecordingName = snapshot?.recording_id ? suggestedFileName : "sin archivo";
  const selectedRecording = selectedRecordingId
    ? (recordings.find((recording) => recording.id === selectedRecordingId) ?? emptyRecordingSummary)
    : emptyRecordingSummary;
  const cloudMode = Boolean(normalizeBackendUrl(backendUrl) && transcriptionApiKey.trim());
  const localAudioRows = useMemo<AudioRow[]>(
    () =>
      recordings.map((recording) => {
        const inferred = inferMetadata(recording);
        const metadata = metadataById[recording.id] ?? inferred;
        const localClient = metadata.client.trim() || inferred.client;
        const localProject = metadata.project.trim() || inferred.project;
        const hasLocalClassification = Boolean(metadata.client.trim()) && !isDraftClient(metadata.client);
        const client = cloudMode && !hasLocalClassification ? unclassifiedClient : localClient;
        const project = cloudMode && !hasLocalClassification ? allProjects : localProject;
        const title = metadata.title.trim() || displayRecordingName(recording);
        const status = resolveAudioStatus(metadata.draftState, client);

        return {
          recording,
          metadata: { ...metadata, client, project, title },
          displayName: title,
          client,
          project,
          status,
          source: "local",
          cloudJobId: cloudJobByRecordingId[recording.id],
        };
      }),
    [cloudJobByRecordingId, cloudMode, metadataById, recordings],
  );
  const cloudAudioRows = useMemo<AudioRow[]>(
    () => cloudJobs.map(cloudJobToAudioRow),
    [cloudJobs],
  );
  const linkedCloudJobIds = useMemo(
    () => new Set(Object.values(cloudJobByRecordingId).filter(Boolean)),
    [cloudJobByRecordingId],
  );
  const audioRows = useMemo<AudioRow[]>(
    () => [
      ...cloudAudioRows,
      ...localAudioRows.filter((row) => !row.cloudJobId || !linkedCloudJobIds.has(row.cloudJobId)),
    ],
    [cloudAudioRows, linkedCloudJobIds, localAudioRows],
  );
  const clients = useMemo(() => mergeClientGroups(buildClientGroups(audioRows), cloudClients), [audioRows, cloudClients]);
  const projectsForSelectedClient = useMemo(
    () => mergeProjectsForClient(buildProjectsForClient(audioRows, selectedClient), cloudProjects, cloudClients, cloudJobs, selectedClient),
    [audioRows, cloudClients, cloudJobs, cloudProjects, selectedClient],
  );
  const filteredRows = useMemo(
    () =>
      audioRows.filter((row) => {
        const matchesClient = selectedClient === unclassifiedClient ? row.client === unclassifiedClient : row.client === selectedClient;
        const matchesProject = selectedProject === allProjects || row.project === selectedProject;
        const query = audioQuery.trim().toLowerCase();
        const matchesQuery =
          !query ||
          row.displayName.toLowerCase().includes(query) ||
          row.client.toLowerCase().includes(query) ||
          row.project.toLowerCase().includes(query) ||
          row.metadata.notes.toLowerCase().includes(query);

        return matchesClient && matchesProject && matchesQuery;
      }),
    [audioQuery, audioRows, selectedClient, selectedProject],
  );
  const selectedRow = selectedRecordingId ? audioRows.find((row) => row.recording.id === selectedRecordingId) : undefined;
  const activeRow = activeAudioId ? audioRows.find((row) => row.recording.id === activeAudioId) : selectedRow;
  const activeAudioPath = activeRow ? recordingAudioPath(activeRow.recording) : "";
  const activeAudioSrc = activeAudioPath ? toPlayableAudioSrc(activeAudioPath) : "";
  const visiblePlayerDuration = playerDurationMs || (activeRow ? audioDurationMs(activeRow, audioDurationById) : 0);
  const selectedCanRequestAnalysis = selectedRow?.source === "local" && selectedRow.status === "classified" && Boolean(recordingAudioPath(selectedRow.recording));
  const selectedCloudJob = selectedRow
    ? selectedRow.cloudJobId
      ? cloudJobs.find((job) => job.job_id === selectedRow.cloudJobId)
      : findCloudJobForRow(selectedRow, audioRows, cloudJobs, cloudJobByRecordingId[selectedRow.recording.id])
    : undefined;
  const selectedHasCloudArtifacts = Boolean(selectedCloudJob?.has_transcription || selectedCloudJob?.has_analysis);
  const selectedCanRetryAnalysis = Boolean(selectedCloudJob?.has_transcription);
  const selectedArtifactContent = artifactTab === "analysis" ? selectedArtifacts.analysis : selectedArtifacts.transcription;
  const selectedArtifactBlocks = parseMarkdownBlocks(selectedArtifactContent);
  const expandedContentOpen = Boolean(selectedRow && expandedRecordingId === selectedRow.recording.id);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedArtifacts() {
      setSelectedArtifacts({});
      setArtifactError(null);
      if (!expandedContentOpen) return;
      if (!selectedCloudJob) return;

      const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
      const apiKey = transcriptionApiKey.trim();
      if (!normalizedBackendUrl || !apiKey || (!selectedCloudJob.has_transcription && !selectedCloudJob.has_analysis)) return;

      setArtifactLoading(true);
      try {
        const artifacts = await getCloudJobArtifacts({
          baseUrl: normalizedBackendUrl,
          apiKey,
          jobId: selectedCloudJob.job_id,
          includeTranscription: Boolean(selectedCloudJob.has_transcription),
          includeAnalysis: Boolean(selectedCloudJob.has_analysis),
        });
        if (cancelled) return;
        setSelectedArtifacts(artifacts);
        setArtifactTab(artifacts.transcription ? "transcription" : "analysis");
      } catch (error) {
        if (!cancelled) setArtifactError(error instanceof Error ? error.message : "No se pudo cargar el contenido del job.");
      } finally {
        if (!cancelled) setArtifactLoading(false);
      }
    }

    void loadSelectedArtifacts();
    return () => {
      cancelled = true;
    };
  }, [backendUrl, expandedContentOpen, selectedCloudJob, transcriptionApiKey]);

  useEffect(() => {
    setArtifactCopyState("idle");
  }, [artifactTab, selectedArtifactContent]);

  function handlePrimary() {
    if (isPaused) {
      void resume();
      return;
    }

    if (isRecording) {
      void pause();
      return;
    }

    void start();
  }

  function handleTitlebarPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    void startWindowDrag();
  }

  function toggleCompactMode(value: boolean) {
    setShowHistory(false);
    if (isTauriRuntime) {
      void showWindow(value ? "widget" : "main");
      return;
    }
    setCompactMode(value);
  }

  async function handleSave(recordingId: string, draft: boolean) {
    if (selectedRow?.source === "cloud") {
      setSaveError("Este audio ya esta administrado por el backend.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedPath(null);

    const nextMetadata: AudioMetadata = {
      client: saveClient.trim(),
      project: saveProject.trim(),
      title: saveFileName.trim() || selectedRow?.displayName || "",
      notes: saveNotes.trim(),
      draftState: draft ? "draft_saved" : "classified",
    };
    updateAudioMetadata(recordingId, nextMetadata);

    try {
      const saved = await saveRecordingToLibrary({
        recordingId,
        client: saveClient,
        project: saveProject,
        fileName: saveFileName,
        draft,
      });
      setSavedPath(saved.path);
      void refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeviceChange(kind: "input" | "output", deviceId: string) {
    setDeviceError(null);
    if (kind === "input") {
      setSelectedInputId(deviceId);
    } else {
      setSelectedOutputId(deviceId);
    }

    try {
      const selection = await selectAudioDevice(kind, deviceId);
      setSelectedInputId(selection.input_device_id ?? selectedInputId);
      setSelectedOutputId(selection.output_device_id ?? selectedOutputId);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateAudioMetadata(recordingId: string, metadata: AudioMetadata) {
    setMetadataById((current) => {
      const next = { ...current, [recordingId]: metadata };
      saveAudioMetadata(next);
      return next;
    });
  }

  function updateAudioCloudJob(recordingId: string, jobId: string) {
    setCloudJobByRecordingId((current) => {
      const next = { ...current, [recordingId]: jobId };
      saveAudioCloudJobs(next);
      return next;
    });
  }

  function handleSelectRecording(row: AudioRow) {
    setSelectedRecordingId(row.recording.id);
    setActiveAudioId(row.recording.id);
    setSaveError(null);
    setSavedPath(null);
    setAnalysisError(null);
    setAnalysisMessage(null);
    setSaveClient(row.client === unclassifiedClient ? "" : row.client);
    setSaveProject(row.project === allProjects ? "" : row.project);
    setSaveFileName(row.displayName);
    setSaveNotes(row.metadata.notes);
  }

  async function handleOpenExpandedContent(row: AudioRow) {
    handleSelectRecording(row);
    setExpandedRecordingId(row.recording.id);
    setArtifactError(null);
    setSelectedArtifacts({});
    await refreshCloudDashboard({ showMessage: false });
  }

  async function handlePlayerPlay() {
    if (!audioRef.current || !activeAudioSrc) return;
    setPlayerError(null);
    try {
      await audioRef.current.play();
      setPlayerPlaying(true);
    } catch (error) {
      setPlayerPlaying(false);
      setPlayerError(error instanceof Error ? error.message : "No se pudo reproducir el audio");
    }
  }

  function handlePlayerPause() {
    audioRef.current?.pause();
    setPlayerPlaying(false);
  }

  function handlePlayerStop() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setPlayerCurrentMs(0);
    setPlayerPlaying(false);
  }

  async function handleRequestAnalysis(row: AudioRow) {
    const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
    const endpoint = normalizedBackendUrl ? `${normalizedBackendUrl}/transcription/` : "";
    const apiKey = transcriptionApiKey.trim();
    const audioPath = recordingAudioPath(row.recording);
    const audioSrc = audioPath ? toPlayableAudioSrc(audioPath) : "";
    const cloudJob = selectedCloudJob;
    const canRetryFromTranscription = Boolean(cloudJob?.has_transcription);

    setAnalysisError(null);
    setAnalysisMessage(null);
    setArtifactError(null);

    if (!normalizedBackendUrl) {
      setAnalysisError("Configura la URL del backend antes de solicitar el analisis.");
      return;
    }

    if (!apiKey) {
      setAnalysisError("Configura la API key antes de solicitar el analisis.");
      return;
    }

    if (!canRetryFromTranscription && !audioSrc) {
      setAnalysisError("Este audio no tiene archivo final disponible.");
      return;
    }

    setAnalysisSubmitting(true);
    try {
      let acceptedJobId: string | undefined;
      if (canRetryFromTranscription && cloudJob) {
        await requestAnalysisRetry({
          baseUrl: normalizedBackendUrl,
          apiKey,
          jobId: cloudJob.job_id,
        });
        acceptedJobId = cloudJob.job_id;
        setSelectedArtifacts((current) => ({ ...current, analysis: null }));
        setArtifactTab("analysis");
      } else if (isTauriRuntime) {
        const result = await requestTranscription({
          recordingId: row.recording.id,
          endpoint,
          apiKey,
          client: saveClient || row.client,
          project: saveProject || row.project,
          fileName: saveFileName || row.displayName,
          durationMs: audioDurationMs(row, audioDurationById),
        });
        const accepted = parseTranscriptionAccepted(result.body);
        if (accepted?.job_id) {
          acceptedJobId = accepted.job_id;
          updateAudioCloudJob(row.recording.id, accepted.job_id);
        }
      } else {
        const result = await requestBrowserTranscription({
          endpoint,
          apiKey,
          audioSrc,
          audioPath,
          displayName: saveFileName || row.displayName,
          client: saveClient || row.client,
          project: saveProject || row.project,
          durationMs: audioDurationMs(row, audioDurationById),
        });
        const accepted = parseTranscriptionAccepted(result.body);
        if (accepted?.job_id) {
          acceptedJobId = accepted.job_id;
          updateAudioCloudJob(row.recording.id, accepted.job_id);
        }
      }

      setAnalysisMessage(
        canRetryFromTranscription
          ? "Reanalisis solicitado. El servicio volvera a generar el analisis desde la transcripcion guardada."
          : "Analisis solicitado. El servicio acepto el audio para procesarlo.",
      );
      await refreshCloudDashboard({ showMessage: false });
      if (acceptedJobId && !canRetryFromTranscription) {
        if (row.source === "local") {
          await cleanupLocalRecording(row.recording.id);
          await refresh();
        }
        setSelectedRecordingId(acceptedJobId);
        setActiveAudioId(acceptedJobId);
      }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "No se pudo solicitar el analisis.");
    } finally {
      setAnalysisSubmitting(false);
    }
  }

  function handleSaveSettings() {
    const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
    if (!normalizedBackendUrl) {
      setSettingsMessage("Ingresa una URL http valida para el backend.");
      return;
    }

    setBackendUrl(normalizedBackendUrl);
    localStorage.setItem(backendUrlStorageKey, normalizedBackendUrl);
    localStorage.setItem(transcriptionApiKeyStorageKey, transcriptionApiKey.trim());
    setSettingsMessage("Configuracion guardada.");
  }

  async function handleSyncCloudDashboard() {
    await refreshCloudDashboard({ showMessage: true });
  }

  async function refreshCloudDashboard({ showMessage }: { showMessage: boolean }) {
    const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
    const apiKey = transcriptionApiKey.trim();
    setCloudSyncError(null);
    if (showMessage) setSettingsMessage(null);

    if (!normalizedBackendUrl) {
      setCloudSyncError("Configura una URL http valida para sincronizar.");
      return;
    }

    if (!apiKey) {
      setCloudSyncError("Configura la API key para sincronizar.");
      return;
    }

    setCloudSyncing(true);
    try {
      const dashboard = await syncCloudDashboard({ baseUrl: normalizedBackendUrl, apiKey });
      setCloudClients(parseCloudClients(dashboard.clients));
      setCloudProjects(parseCloudProjects(dashboard.projects));
      setCloudJobs(parseCloudJobs(dashboard.jobs));
      setCloudSyncedAt(new Date().toISOString());
      if (showMessage) setSettingsMessage("Sincronizacion completada.");
    } catch (error) {
      setCloudSyncError(error instanceof Error ? error.message : "No se pudo sincronizar con la nube.");
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleCopyArtifact() {
    if (!selectedArtifactContent?.trim()) return;

    try {
      await copyTextToClipboard(selectedArtifactContent);
      setArtifactCopyState("copied");
      window.setTimeout(() => setArtifactCopyState("idle"), 1800);
    } catch {
      setArtifactCopyState("error");
    }
  }

  return (
    <main className={clsx("widget-shell", compactView && "is-compact")}>
      {!compactView && (
        <header
          className="windows-titlebar"
          data-tauri-drag-region
          onPointerDown={handleTitlebarPointerDown}
        >
          <div className="window-brand" data-tauri-drag-region>
            <img className="window-icon" src={appIcon} alt="" data-tauri-drag-region />
            <span data-tauri-drag-region>Meetings Assistant</span>
          </div>
          <div
            className="window-actions"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <button type="button" onClick={() => void minimizeWindow()} aria-label="Minimizar" title="Minimizar">
              <Minus />
            </button>
            <button type="button" className="is-disabled" aria-label="Maximizar deshabilitado" title="No expandible">
              <Maximize2 />
            </button>
            <button
              type="button"
              className={clsx(pinned && "is-active")}
              onClick={() => setPinned((value) => !value)}
              aria-label={pinned ? "Quitar siempre encima" : "Mantener encima"}
              title={pinned ? "Quitar siempre encima" : "Mantener encima"}
            >
              <Pin />
            </button>
            <button type="button" className="close" onClick={() => void closeWindow()} aria-label="Cerrar" title="Cerrar">
              <X />
            </button>
          </div>
        </header>
      )}

      {compactView ? (
        <section className="compact-recorder" onPointerDown={handleTitlebarPointerDown}>
          <div className="compact-status">
            <SignalIcon icon={<Mic />} active={isRecording && micLevel > 0.01} color="mic" label="Microfono" />
            <SignalIcon icon={<MonitorSpeaker />} active={isRecording && systemLevel > 0.01} color="system" label="Equipo" />
          </div>
          <span className="compact-time">{duration}</span>
          <div className="compact-controls">
            <MiniButton
              label={isPaused ? "Reanudar" : isRecording ? "Pausar" : "Grabar"}
              icon={isRecording ? <Pause /> : <Play />}
              disabled={isBusy}
              active={isRecording}
              onClick={handlePrimary}
            />
            <MiniButton
              label="Finalizar"
              icon={<Square />}
              disabled={isBusy || !isActive}
              onClick={() => void stop()}
            />
            <MiniButton
              label="Ocultar widget"
              icon={<Minus />}
              onClick={() => void closeWindow()}
            />
            <MiniButton
              label={pinned ? "Desfijar widget" : "Fijar widget"}
              icon={<Pin />}
              active={pinned}
              onClick={() => setPinned((value) => !value)}
            />
            <MiniButton
              label="Vista completa"
              icon={<Maximize2 />}
              onClick={() => toggleCompactMode(false)}
            />
          </div>
        </section>
      ) : (
        <>
          <section className="dashboard-shell">
            <aside className="library-sidebar">
              <div className="sidebar-brand" data-tauri-drag-region>
                <span className="brand-mark"><Disc3 /></span>
                <div>
                  <strong>Audio Library</strong>
                  <span>{recordings.length} audios</span>
                </div>
              </div>

              <div className="quick-recorder">
                <div>
                  <p>{statusTitle(status)}</p>
                  <span>{statusSubtitle(status)}</span>
                </div>
                <strong>{duration}</strong>
                <div className="quick-controls">
                  <button type="button" onClick={handlePrimary} disabled={isBusy} aria-label={isPaused ? "Reanudar" : isRecording ? "Pausar" : "Grabar"} title={isPaused ? "Reanudar" : isRecording ? "Pausar" : "Grabar"}>
                    {isRecording ? <Pause /> : <Play />}
                  </button>
                  <button type="button" onClick={() => void stop()} disabled={isBusy || !isActive} aria-label="Finalizar" title="Finalizar">
                    <Square />
                  </button>
                </div>
              </div>

              <nav className="workspace-nav" aria-label="Secciones">
                <button
                  type="button"
                  className={clsx(dashboardView === "library" && "is-selected")}
                  onClick={() => setDashboardView("library")}
                >
                  <ListMusic />
                  Biblioteca
                </button>
                <button
                  type="button"
                  className={clsx(dashboardView === "settings" && "is-selected")}
                  onClick={() => setDashboardView("settings")}
                >
                  <Settings />
                  Configuracion
                </button>
              </nav>

              {dashboardView === "library" && (
                <nav className="client-nav" aria-label="Clientes">
                  <div className="nav-heading">
                    <UserRound />
                    <span>Clientes</span>
                  </div>
                  {clients.map((client) => (
                    <button
                      key={client.name}
                      type="button"
                      className={clsx("client-nav-item", selectedClient === client.name && "is-selected")}
                      onClick={() => {
                        setSelectedClient(client.name);
                        setSelectedProject(allProjects);
                      }}
                    >
                      <span>{client.name}</span>
                      <strong>{client.count}</strong>
                    </button>
                  ))}
                </nav>
              )}

              <a
                className="developer-link"
                href="https://vicentejorquera.dev"
                target="_blank"
                rel="noreferrer"
                title="vicentejorquera.dev"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl("https://vicentejorquera.dev");
                }}
              >
                Vicente Jorquera
                <ExternalLink />
              </a>
            </aside>

            <div className="dashboard-main">
              <header className="dashboard-topbar" data-tauri-drag-region>
                <div>
                  <p>{dashboardView === "settings" ? "Preferencias" : "Biblioteca administrativa"}</p>
                  <h1>{dashboardView === "settings" ? "Configuracion" : selectedClient}</h1>
                </div>
                <div className="dashboard-tools">
                  {dashboardView === "library" ? (
                    <>
                      <label className="search-box" title="Buscar audio">
                        <Search />
                        <input value={audioQuery} onChange={(event) => setAudioQuery(event.currentTarget.value)} placeholder="Buscar audio, cliente o nota" />
                      </label>
                      <button type="button" onClick={() => void refresh()} title="Actualizar" aria-label="Actualizar">
                        <History />
                      </button>
                    </>
                  ) : (
                    <span className="backend-status">{normalizeBackendUrl(backendUrl) || "Sin servidor"}</span>
                  )}
                </div>
              </header>

              {dashboardView === "settings" ? (
                <section className="settings-panel">
                  <div className="section-head">
                    <div>
                      <p>Servidor backend</p>
                      <h2>Conexion de analisis</h2>
                    </div>
                    <span><Settings /> Sistema</span>
                  </div>

                  <div className="settings-form">
                    <label className="field-control">
                      <span>URL del backend</span>
                      <input
                        value={backendUrl}
                        onChange={(event) => {
                          setBackendUrl(event.currentTarget.value);
                          setSettingsMessage(null);
                        }}
                        placeholder={defaultBackendUrl}
                      />
                    </label>
                    <label className="field-control">
                      <span>API key</span>
                      <input
                        type="password"
                        value={transcriptionApiKey}
                        onChange={(event) => {
                          setTranscriptionApiKey(event.currentTarget.value);
                          setSettingsMessage(null);
                        }}
                        placeholder="API key del servicio"
                      />
                    </label>
                    <div className="settings-preview">
                      <span>Endpoint de analisis</span>
                      <strong>{normalizeBackendUrl(backendUrl) ? `${normalizeBackendUrl(backendUrl)}/transcription/` : "Sin URL valida"}</strong>
                    </div>
                    <button type="button" className="settings-save" onClick={handleSaveSettings}>
                      <Save />
                      Guardar configuracion
                    </button>
                    <div className="cloud-sync-panel">
                      <div className="cloud-sync-head">
                        <div>
                          <span>Sincronizacion nube</span>
                          <strong>{cloudSyncedAt ? formatDateTime(cloudSyncedAt) : "Sin sincronizar"}</strong>
                        </div>
                        <button type="button" onClick={() => void handleSyncCloudDashboard()} disabled={cloudSyncing}>
                          {cloudSyncing ? <Loader2 className="is-spinning" /> : <History />}
                          {cloudSyncing ? "Sincronizando" : "Sincronizar"}
                        </button>
                      </div>
                      <div className="cloud-sync-counts">
                        <span><strong>{cloudClients.length}</strong> clientes</span>
                        <span><strong>{cloudProjects.length}</strong> proyectos</span>
                        <span><strong>{cloudJobs.length}</strong> jobs</span>
                      </div>
                    </div>
                    <div className="google-auth-panel">
                      <div className="google-auth-head">
                        <div>
                          <span>Autenticacion Google</span>
                          <strong>{authState?.is_authenticated ? authState.email ?? "Conectado" : "No conectado"}</strong>
                        </div>
                        {authState?.is_authenticated ? (
                          <button type="button" onClick={() => void logout()} disabled={useAuthStore.getState().loading}>
                            {useAuthStore.getState().loading ? <Loader2 className="is-spinning" /> : <X />}
                            {useAuthStore.getState().loading ? "Cerrando" : "Desconectar"}
                          </button>
                        ) : (
                          <button type="button" onClick={() => void login()} disabled={useAuthStore.getState().loading}>
                            {useAuthStore.getState().loading ? <Loader2 className="is-spinning" /> : <UserRound />}
                            {useAuthStore.getState().loading ? "Conectando" : "Iniciar sesion con Google"}
                          </button>
                        )}
                      </div>
                    </div>
                    {(settingsMessage || cloudSyncError) && (
                      <p className={clsx("save-message details-save-message", cloudSyncError && "is-error")}>
                        {cloudSyncError ?? settingsMessage}
                      </p>
                    )}
                  </div>
                </section>
              ) : (
                <>
                  <div className="project-strip" aria-label="Proyectos">
                    {projectsForSelectedClient.map((project) => (
                      <button
                        key={project.name}
                        type="button"
                        className={clsx(selectedProject === project.name && "is-selected")}
                        onClick={() => setSelectedProject(project.name)}
                      >
                        <span>{project.name}</span>
                        <strong>{project.count}</strong>
                        {(project.hasTranscription || project.hasAnalysis) && (
                          <span className="project-cloud-badges" aria-label="Contenido cloud" title="Contenido cloud disponible">
                            {project.hasTranscription && <CheckCircle2 />}
                            {project.hasAnalysis && <Sparkles />}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="content-grid">
                {expandedContentOpen && selectedRow ? (
                  <section className="audio-focus">
                    <div className="audio-focus-top">
                      <button type="button" onClick={() => setExpandedRecordingId(null)} aria-label="Volver a la lista" title="Volver a la lista">
                        <ChevronRight />
                      </button>
                      <div>
                        <p>{selectedRow.client} / {selectedRow.project}</p>
                        <h2>{selectedRow.displayName}</h2>
                      </div>
                      {selectedCloudJob && <span>{selectedCloudJob.status}</span>}
                    </div>
                    <div className="audio-focus-meta">
                      <span>{formatDuration(audioDurationMs(selectedRow, audioDurationById))}</span>
                      <span>{formatDateTime(selectedRow.recording.started_at)}</span>
                      <span>{selectedCloudJob ? "Cloud vinculado" : "Sin job cloud"}</span>
                    </div>
                    <div className="content-switch-wrap">
                      <div className="content-switch-head">
                        <span>Contenido</span>
                        <button
                          type="button"
                          className={clsx("copy-content-button", artifactCopyState === "copied" && "is-copied", artifactCopyState === "error" && "is-error")}
                          onClick={() => void handleCopyArtifact()}
                          disabled={!selectedArtifactContent?.trim()}
                          title={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"}`}
                          aria-label={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"}`}
                        >
                          {artifactCopyState === "copied" ? <CheckCircle2 /> : <Copy />}
                          <span>{artifactCopyState === "copied" ? "Copiado" : artifactCopyState === "error" ? "Error" : "Copiar"}</span>
                        </button>
                      </div>
                      <div className="content-switch" role="tablist" aria-label="Contenido del job">
                        <button
                          type="button"
                          className={clsx(artifactTab === "transcription" && "is-selected", !selectedCloudJob?.has_transcription && "is-unavailable")}
                          onClick={() => setArtifactTab("transcription")}
                        >
                          Transcripcion
                        </button>
                        <button
                          type="button"
                          className={clsx(artifactTab === "analysis" && "is-selected", !selectedCloudJob?.has_analysis && "is-unavailable")}
                          onClick={() => setArtifactTab("analysis")}
                        >
                          Analisis
                        </button>
                      </div>
                    </div>
                    <div className="markdown-stage">
                      {artifactLoading ? (
                        <div className="lyrics-empty"><Loader2 className="is-spinning" /> Cargando contenido</div>
                      ) : cloudSyncing && !selectedCloudJob ? (
                        <div className="lyrics-empty"><Loader2 className="is-spinning" /> Buscando contenido cloud</div>
                      ) : artifactError ? (
                        <div className="lyrics-empty is-error">{artifactError}</div>
                      ) : cloudSyncError && !selectedCloudJob ? (
                        <div className="lyrics-empty is-error">{cloudSyncError}</div>
                      ) : selectedArtifactBlocks.length > 0 ? (
                        selectedArtifactBlocks.map((block, index) => <MarkdownBlock key={`${artifactTab}-${index}`} block={block} />)
                      ) : (
                        <div className="lyrics-empty">
                          {selectedCloudJob ? "Contenido no disponible para este job." : "Sin contenido cloud asociado a este audio."}
                        </div>
                      )}
                    </div>
                  </section>
                ) : (
                  <section className="audio-library">
                    <div className="section-head">
                      <div>
                        <p>Audios</p>
                        <h2>{filteredRows.length} resultados</h2>
                      </div>
                      <span><SlidersHorizontal /> Datos</span>
                    </div>

                    <div className="audio-table" role="list">
                      {filteredRows.length === 0 ? (
                        <div className="empty-state">
                          <ListMusic />
                          <p>No hay audios para esta vista.</p>
                        </div>
                      ) : (
                        filteredRows.map((row) => (
                          <button
                            key={row.recording.id}
                            type="button"
                            className={clsx("audio-row", selectedRecordingId === row.recording.id && "is-selected")}
                            onClick={() => handleSelectRecording(row)}
                          >
                            <span className="audio-index"><FileAudio /></span>
                            <span className="audio-title">
                              <strong>{row.displayName}</strong>
                              <small>{formatDateTime(row.recording.started_at)}</small>
                            </span>
                            <span className="audio-client">{row.client}</span>
                            <span className="audio-project">{row.project}</span>
                            <span className="audio-duration">{formatDuration(audioDurationMs(row, audioDurationById))}</span>
                            <StatusBadge state={row.status} />
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                )}

                <aside className="details-panel">
                  {selectedRow ? (
                    <>
                      <div className="details-head">
                        <div>
                          <p>Audio seleccionado</p>
                          <h2>{selectedRow.displayName}</h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleOpenExpandedContent(selectedRow)}
                          aria-label="Ver contenido cloud"
                          title="Ver contenido cloud"
                        >
                          <Eye />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRecordingId(null);
                            setExpandedRecordingId(null);
                          }}
                          aria-label="Cerrar detalle"
                          title="Cerrar detalle"
                        >
                          <X />
                        </button>
                      </div>

                      <div className="details-summary">
                        <div className="summary-item">
                          <span><Clock3 /> Duracion</span>
                          <strong>{formatDuration(audioDurationMs(selectedRow, audioDurationById))}</strong>
                        </div>
                        <div className="summary-item">
                          <span><Tag /> Estado</span>
                          <strong>{selectedRow.recording.status}</strong>
                        </div>
                      </div>

                      <div className="details-section">
                        <div className="details-section-title">
                          <span>Datos del audio</span>
                        </div>
                        <div className="save-fields details-fields">
                          <label className="field-control">
                            <span>Nombre del audio</span>
                            <input value={saveFileName} onChange={(event) => setSaveFileName(event.currentTarget.value)} placeholder={selectedRow.displayName} disabled={saving || selectedRow.source === "cloud"} />
                          </label>
                          <label className="field-control">
                            <span>Cliente</span>
                            <input value={saveClient} onChange={(event) => setSaveClient(event.currentTarget.value)} placeholder="Sin cliente" disabled={saving || selectedRow.source === "cloud"} />
                          </label>
                          <label className="field-control">
                            <span>Proyecto</span>
                            <input value={saveProject} onChange={(event) => setSaveProject(event.currentTarget.value)} placeholder="Sin proyecto" disabled={saving || selectedRow.source === "cloud"} />
                          </label>
                          <label className="field-control">
                            <span>Notas internas</span>
                            <textarea value={saveNotes} onChange={(event) => setSaveNotes(event.currentTarget.value)} placeholder="Notas internas" disabled={saving || selectedRow.source === "cloud"} />
                          </label>
                        </div>
                      </div>

                      <div className="organize-actions dashboard-actions">
                        <button type="button" onClick={() => void openRecordingFolder(selectedRow.recording.id)} disabled={saving || selectedRow.source === "cloud"}>
                          <FolderOpen />
                          Abrir
                        </button>
                        <button type="button" className="save-strong" onClick={() => void handleSave(selectedRow.recording.id, false)} disabled={saving || selectedRow.source === "cloud"}>
                          <Save />
                          Guardar biblioteca
                        </button>
                        <button type="button" className="draft-strong" onClick={() => void handleSave(selectedRow.recording.id, true)} disabled={saving || selectedRow.source === "cloud"}>
                          <ChevronRight />
                          Drafts
                        </button>
                      </div>

                      <div className="details-section analysis-section">
                        <div className="details-section-title">
                          <span>Analisis</span>
                        </div>
                        <button
                          type="button"
                          className="analysis-button"
                          onClick={() => void handleRequestAnalysis(selectedRow)}
                          disabled={analysisSubmitting || (!selectedCanRequestAnalysis && !selectedCanRetryAnalysis)}
                          title={
                            selectedCanRetryAnalysis
                              ? "Volver a generar el analisis desde la transcripcion guardada"
                              : selectedCanRequestAnalysis
                                ? "Solicitar analisis"
                                : "Clasifica el audio o vincula una transcripcion antes de solicitar analisis"
                          }
                        >
                          {analysisSubmitting ? <Loader2 className="is-spinning" /> : <Sparkles />}
                          {analysisSubmitting ? "Solicitando" : selectedCanRetryAnalysis ? "Reanalizar" : "Solicitar analisis"}
                        </button>
                        {selectedHasCloudArtifacts && selectedCanRetryAnalysis && (
                          <p className="analysis-hint">Usa reanalizar para regenerar solo el analisis; la transcripcion se mantiene intacta.</p>
                        )}
                        {(analysisMessage || analysisError) && (
                          <p className={clsx("save-message details-save-message", analysisError && "is-error")}>
                            {analysisError ?? analysisMessage}
                          </p>
                        )}
                      </div>

                      <div className="details-section artifact-section compact-artifact-section">
                        <div className="details-section-title">
                          <span>Contenido cloud</span>
                          {selectedCloudJob && <strong>{selectedCloudJob.status}</strong>}
                        </div>
                        {selectedCloudJob ? (
                          <div className="cloud-availability">
                            <span className={clsx(selectedCloudJob.has_transcription && "is-available")}>
                              <CheckCircle2 />
                              Transcripcion
                            </span>
                            <span className={clsx(selectedCloudJob.has_analysis && "is-available")}>
                              <CheckCircle2 />
                              Analisis
                            </span>
                          </div>
                        ) : (
                          <div className="lyrics-empty">Sin job cloud asociado a este audio.</div>
                        )}
                      </div>

                      {(savedPath || saveError) && (
                        <p className={clsx("save-message details-save-message", saveError && "is-error")}>
                          {saveError ?? `Guardado en ${savedPath}`}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="details-empty">
                      <FileAudio />
                      <p>Selecciona un audio para clasificarlo, guardarlo o enviarlo a drafts.</p>
                    </div>
                  )}
                </aside>
                  </div>

                  <div className="player-bar">
                <div className="player-now">
                  <span><Disc3 /></span>
                  <div>
                    <strong>{activeRow?.displayName ?? "Sin audio seleccionado"}</strong>
                    <small>{activeRow ? `${activeRow.client} / ${activeRow.project}` : "El reproductor queda listo al seleccionar un audio"}</small>
                  </div>
                </div>
                {activeAudioSrc ? (
                  <div className="player-controls">
                    <button type="button" onClick={() => void handlePlayerPlay()} disabled={!activeAudioSrc || playerPlaying} aria-label="Reproducir" title="Reproducir">
                      <Play />
                    </button>
                    <button type="button" onClick={handlePlayerPause} disabled={!activeAudioSrc || !playerPlaying} aria-label="Pausar" title="Pausar">
                      <Pause />
                    </button>
                    <button type="button" onClick={handlePlayerStop} disabled={!activeAudioSrc} aria-label="Detener" title="Detener">
                      <Square />
                    </button>
                    <div className="player-progress" aria-label="Progreso">
                      <span>{formatDuration(playerCurrentMs)}</span>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(visiblePlayerDuration, 1)}
                        value={Math.min(playerCurrentMs, Math.max(visiblePlayerDuration, 1))}
                        disabled={!activeAudioSrc}
                        onChange={(event) => {
                          const nextMs = Number(event.currentTarget.value);
                          setPlayerCurrentMs(nextMs);
                          if (audioRef.current) {
                            audioRef.current.currentTime = nextMs / 1000;
                          }
                        }}
                        aria-label="Adelantar o retroceder audio"
                      />
                      <span>{formatDuration(visiblePlayerDuration)}</span>
                    </div>
                    <audio
                      ref={audioRef}
                      key={activeAudioSrc}
                      preload="metadata"
                      src={activeAudioSrc}
                      onLoadedMetadata={(event) => {
                        const seconds = event.currentTarget.duration;
                        const nextDurationMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
                        setPlayerDurationMs(nextDurationMs);
                        if (activeRow && nextDurationMs > 0) {
                          setAudioDurationById((current) => ({ ...current, [activeRow.recording.id]: nextDurationMs }));
                        }
                      }}
                      onTimeUpdate={(event) => setPlayerCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
                      onPause={() => setPlayerPlaying(false)}
                      onPlay={() => setPlayerPlaying(true)}
                      onEnded={handlePlayerStop}
                      onError={() => {
                        setPlayerPlaying(false);
                        setPlayerError("No se pudo cargar el archivo de audio");
                      }}
                    />
                    {playerError && <span className="player-error">{playerError}</span>}
                  </div>
                ) : (
                  <div className="player-placeholder">Audio no disponible</div>
                )}
                  </div>
                </>
              )}

              {(error || snapshot?.last_error || deviceError) && <div className="widget-error dashboard-error">{error ?? snapshot?.last_error ?? deviceError}</div>}
            </div>
          </section>

          {legacyExpandedRecorderEnabled && (
      <section className="recorder-card">
        <header className="recorder-header" data-tauri-drag-region>
          <div data-tauri-drag-region>
            <p className="recording-title">{statusTitle(status)}</p>
            <p className="recording-subtitle">{statusSubtitle(status)}</p>
          </div>
          <label className="view-switch" title="Vista minima">
            <span>Vista minima</span>
            <input
              type="checkbox"
              checked={compactMode}
              onChange={(event) => toggleCompactMode(event.currentTarget.checked)}
            />
            <span className="switch-track" />
          </label>
        </header>

        <div className="recording-file" title={visibleRecordingName} data-tauri-drag-region>
          <span>Archivo</span>
          <strong>{visibleRecordingName}</strong>
        </div>

        <div className="device-selectors">
          <DeviceSelect
            label="Microfono"
            icon={<Mic />}
            devices={inputDevices}
            value={selectedInputId}
            disabled={isActive}
            onChange={(deviceId) => void handleDeviceChange("input", deviceId)}
          />
          <DeviceSelect
            label="Audio PC"
            icon={<MonitorSpeaker />}
            devices={outputDevices}
            value={selectedOutputId}
            disabled={isActive}
            onChange={(deviceId) => void handleDeviceChange("output", deviceId)}
          />
        </div>

        <div className="duration-row" data-tauri-drag-region>
          <span className="duration-value">{duration}</span>
        </div>

        <div className="controls">
          <ControlButton
            label="CERRAR"
            className="secondary"
            icon={<X />}
            disabled={isBusy || !isActive}
            onClick={() => void stop()}
          />

          <ControlButton
            label={isPaused ? "REANUDAR" : isRecording ? "PAUSAR" : "GRABAR"}
            className="primary"
            icon={isRecording ? <Pause /> : <Play />}
            disabled={isBusy}
            onClick={handlePrimary}
          />

          <ControlButton
            label="FINALIZAR"
            className="finish"
            icon={<Square />}
            disabled={isBusy || !isActive}
            onClick={() => void stop()}
          />
        </div>

        <div className="waveform-panel" data-tauri-drag-region>
          <TrackWave
            label="Micrófono"
            icon={<Mic />}
            level={micLevel}
            bars={visibleMicBars}
            active={isRecording}
            color="mic"
          />
          <TrackWave
            label="Equipo"
            icon={<MonitorSpeaker />}
            level={systemLevel}
            bars={visibleSystemBars}
            active={isRecording}
            color="system"
          />
        </div>

        <footer className="widget-footer">
          <a
            className="timeline-label"
            href="https://vicentejorquera.dev"
            target="_blank"
            rel="noreferrer"
            title="vicentejorquera.dev"
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl("https://vicentejorquera.dev");
            }}
          >
            Diseñado y desarrollado por Vicente Jorquera
            <ExternalLink />
          </a>
          <button
            type="button"
            className="history-button"
            onClick={() => {
              setShowHistory((value) => !value);
              void refresh();
            }}
            title="Historial"
            aria-label="Historial"
          >
            <History />
          </button>
        </footer>

        {showHistory && (
          <section className="history-panel">
            <div className="history-header">
              <span>Historial</span>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="Cerrar historial">
                <X />
              </button>
            </div>
            <div className="history-list">
              {recordings.length === 0 ? (
                <p className="history-empty">Todavía no hay grabaciones.</p>
              ) : (
                recordings.map((recording) => (
                  <button
                    key={recording.id}
                    type="button"
                    className={clsx("history-item", selectedRecordingId === recording.id && "is-selected")}
                    onClick={() => {
                      setSelectedRecordingId(recording.id);
                      setSaveError(null);
                      setSavedPath(null);
                      setSaveFileName(displayRecordingName(recording));
                    }}
                  >
                    <span className="history-name">{displayRecordingName(recording)}</span>
                    <span className="history-meta">
                      {formatDuration(recording.duration_ms)} · {recording.status}
                    </span>
                  </button>
                ))
              )}
            </div>
            {selectedRecording && (
              <div className="organize-panel">
                <div className="organize-head">
                  <span>Organizar audio</span>
                  <button type="button" onClick={() => setSelectedRecordingId(null)} aria-label="Cerrar organizador">
                    <X />
                  </button>
                </div>
                <div className="save-fields">
                  <input
                    value={saveClient}
                    onChange={(event) => setSaveClient(event.currentTarget.value)}
                    placeholder="Cliente"
                    disabled={saving}
                  />
                  <input
                    value={saveProject}
                    onChange={(event) => setSaveProject(event.currentTarget.value)}
                    placeholder="Proyecto"
                    disabled={saving}
                  />
                  <input
                    value={saveFileName}
                    onChange={(event) => setSaveFileName(event.currentTarget.value)}
                    placeholder={displayRecordingName(selectedRecording)}
                    disabled={saving}
                  />
                </div>
                <div className="organize-actions">
                  <button type="button" onClick={() => void openRecordingFolder(selectedRecording.id)} disabled={saving}>
                    <FolderOpen />
                    Abrir
                  </button>
                  <button type="button" onClick={() => void handleSave(selectedRecording.id, false)} disabled={saving}>
                    <Save />
                    Guardar organizado
                  </button>
                </div>
                {(savedPath || saveError) && <p className={clsx("save-message", saveError && "is-error")}>{saveError ?? savedPath}</p>}
              </div>
            )}
          </section>
        )}

        {(error || snapshot?.last_error || deviceError) && <div className="widget-error">{error ?? snapshot?.last_error ?? deviceError}</div>}
      </section>
          )}
        </>
      )}
    </main>
  );
}

function StatusBadge({ state }: { state: DraftState }) {
  const label = {
    unclassified: "Pendiente",
    classified: "Clasificado",
    draft_ready: "Draft ready",
    draft_saved: "En drafts",
    archived: "Archivo",
  }[state];

  return <span className={clsx("status-badge", `is-${state}`)}>{label}</span>;
}

type MarkdownBlockData =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "meta"; label: string; value: string }
  | { type: "divider" };

type MarkdownInlinePart =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "code"; value: string };

function MarkdownBlock({ block }: { block: MarkdownBlockData }) {
  if (block.type === "heading") {
    const Tag = block.level <= 2 ? "h2" : "h3";
    const className = clsx("markdown-heading", block.level <= 2 && "is-major", block.level >= 4 && "is-minor");
    return <Tag className={className}>{renderMarkdownInline(block.text)}</Tag>;
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className={clsx("markdown-list", block.ordered && "is-ordered")}>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderMarkdownInline(item)}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "quote") {
    return <blockquote className="markdown-quote">{renderMarkdownInline(block.text)}</blockquote>;
  }

  if (block.type === "meta") {
    return (
      <p className="markdown-meta">
        <span>{renderMarkdownInline(block.label)}</span>
        <strong>{renderMarkdownInline(block.value)}</strong>
      </p>
    );
  }

  if (block.type === "divider") {
    return <hr className="markdown-divider" />;
  }

  return <p className="markdown-paragraph">{renderMarkdownInline(block.text)}</p>;
}

function renderMarkdownInline(text: string): ReactNode {
  return parseMarkdownInline(text).map((part, index) => {
    if (part.type === "strong") return <strong key={`${part.value}-${index}`}>{part.value}</strong>;
    if (part.type === "code") return <code key={`${part.value}-${index}`}>{part.value}</code>;
    return <span key={`${part.value}-${index}`}>{part.value}</span>;
  });
}

function loadAudioMetadata(): Record<string, AudioMetadata> {
  try {
    const raw = localStorage.getItem(audioMetadataStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AudioMetadata>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAudioMetadata(metadata: Record<string, AudioMetadata>) {
  localStorage.setItem(audioMetadataStorageKey, JSON.stringify(metadata));
}

function loadAudioCloudJobs(): Record<string, string> {
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

function saveAudioCloudJobs(value: Record<string, string>) {
  localStorage.setItem(audioCloudJobStorageKey, JSON.stringify(value));
}

function loadBackendUrl(): string {
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

function normalizeBackendUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:") return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

function mergeClientGroups(localClients: { name: string; count: number }[], cloudClients: CloudClient[]) {
  const merged = new Map(localClients.map((client) => [client.name, client]));

  cloudClients.forEach((client) => {
    const name = client.display_name || client.slug;
    if (!merged.has(name)) {
      merged.set(name, { name, count: 0 });
    }
  });

  return Array.from(merged.values()).sort((left, right) => {
    if (left.name === unclassifiedClient) return -1;
    if (right.name === unclassifiedClient) return 1;
    return left.name.localeCompare(right.name);
  });
}

function mergeProjectsForClient(
  localProjects: { name: string; count: number }[],
  cloudProjects: CloudProject[],
  cloudClients: CloudClient[],
  cloudJobs: CloudJob[],
  selectedClient: string,
) {
  const selectedCloudClient = cloudClients.find(
    (client) => client.display_name === selectedClient || client.slug === selectedClient,
  );
  const selectedClientSlug = selectedCloudClient?.slug ?? selectedClient;
  const merged = new Map(localProjects.map((project) => [project.name, project]));

  cloudProjects
    .filter((project) => project.client === selectedClientSlug)
    .forEach((project) => {
      const name = project.display_name || project.slug;
      if (!merged.has(name)) {
        merged.set(name, { name, count: 0 });
      }
    });

  return Array.from(merged.values()).map((project) => {
    const relativePath = transcriptionRelativePath(selectedClient, project.name);
    const availability = cloudAvailabilityForRelativePath(cloudJobs, relativePath);
    return { ...project, ...availability };
  });
}

function parseCloudClients(value: unknown): CloudClient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.slug !== "string" || typeof item.display_name !== "string") return [];
    return [
      {
        slug: item.slug,
        display_name: item.display_name,
        status: typeof item.status === "string" ? item.status : undefined,
        projects: Array.isArray(item.projects) ? item.projects.filter((project): project is string => typeof project === "string") : [],
        tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      },
    ];
  });
}

function parseCloudProjects(value: unknown): CloudProject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.slug !== "string" ||
      typeof item.display_name !== "string" ||
      typeof item.client !== "string"
    ) {
      return [];
    }

    return [
      {
        slug: item.slug,
        display_name: item.display_name,
        client: item.client,
        status: typeof item.status === "string" ? item.status : undefined,
      },
    ];
  });
}

function parseCloudJobs(value: unknown): CloudJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.job_id !== "string" || typeof item.source_filename !== "string" || typeof item.status !== "string") {
      return [];
    }

    return [
      {
        job_id: item.job_id,
        source_filename: item.source_filename,
        source_size_bytes: typeof item.source_size_bytes === "number" ? item.source_size_bytes : undefined,
        source_duration_ms: typeof item.source_duration_ms === "number" || item.source_duration_ms === null ? item.source_duration_ms : undefined,
        relative_path: typeof item.relative_path === "string" ? item.relative_path : undefined,
        status: item.status,
        accepted_at: typeof item.accepted_at === "string" ? item.accepted_at : undefined,
        completed_at: typeof item.completed_at === "string" || item.completed_at === null ? item.completed_at : undefined,
        has_audio: typeof item.has_audio === "boolean" ? item.has_audio : undefined,
        audio_url: typeof item.audio_url === "string" || item.audio_url === null ? item.audio_url : undefined,
        has_transcription: typeof item.has_transcription === "boolean" ? item.has_transcription : undefined,
        has_analysis: typeof item.has_analysis === "boolean" ? item.has_analysis : undefined,
      },
    ];
  });
}

function cloudJobToAudioRow(job: CloudJob): AudioRow {
  const { client, project } = relativePathToLabels(job.relative_path);
  const title = job.source_filename.replace(/\.(opus|mp3)$/i, "") || job.job_id;
  const startedAt = job.accepted_at ?? job.completed_at ?? new Date(0).toISOString();
  const hasCloudContent = Boolean(job.has_transcription || job.has_analysis);

  return {
    recording: {
      id: job.job_id,
      status: job.status,
      started_at: startedAt,
      completed_at: job.completed_at,
      duration_ms: job.source_duration_ms ?? 0,
      folder_path: "",
      final_audio_path: null,
      audio_url: job.audio_url ?? null,
      source_duration_ms: job.source_duration_ms ?? null,
      segments: 0,
      size_bytes: job.source_size_bytes ?? 0,
    },
    metadata: {
      client,
      project,
      title,
      notes: "",
      draftState: hasCloudContent ? "classified" : "draft_saved",
    },
    displayName: title,
    client,
    project,
    status: hasCloudContent ? "classified" : "draft_saved",
    source: "cloud",
    cloudJobId: job.job_id,
  };
}

function relativePathToLabels(relativePath?: string): { client: string; project: string } {
  const parts = (relativePath ?? "drafts")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const client = parts[0] && !isDraftClient(parts[0]) ? parts[0] : unclassifiedClient;
  const project = parts[1] || allProjects;
  return { client, project };
}

function audioDurationMs(row: AudioRow, durationById: Record<string, number>): number {
  return durationById[row.recording.id] || row.recording.source_duration_ms || row.recording.duration_ms || 0;
}

function findCloudJobForRow(row: AudioRow, rows: AudioRow[], jobs: CloudJob[], linkedJobId?: string): CloudJob | undefined {
  const candidates = audioJobCandidateNames(row);
  const rowRelativePath = transcriptionRelativePath(row.client, row.project);

  if (linkedJobId) {
    const linkedJob = jobs.find((job) => job.job_id === linkedJobId);
    if (linkedJob) return linkedJob;
  }

  const byStrictMatch = jobs.find((job) => cloudJobMatchesRow(job, candidates, rowRelativePath));
  if (byStrictMatch) return byStrictMatch;

  const rowsInSamePath = rows.filter((candidate) => transcriptionRelativePath(candidate.client, candidate.project) === rowRelativePath);
  if (rowsInSamePath.length !== 1) return undefined;

  const artifactJobsInSamePath = jobs.filter(
    (job) =>
      normalizeRelativePathForMatch(job.relative_path ?? "") === normalizeRelativePathForMatch(rowRelativePath) &&
      (job.has_transcription || job.has_analysis),
  );

  if (artifactJobsInSamePath.length === 1) return artifactJobsInSamePath[0];

  return artifactJobsInSamePath.find((job) => isGenericMixedAudioName(job.source_filename));
}

function isDraftClient(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "drafts" || normalized === "sin clasificar";
}

function audioJobCandidateNames(row: AudioRow): Set<string> {
  const path = recordingAudioPath(row.recording);
  const pathFileName = path.split(/[\\/]/).pop() ?? "";
  const displayName = row.displayName.trim();
  const names = [displayName, `${displayName}.opus`, `${displayName}.mp3`];
  if (!isGenericMixedAudioName(pathFileName)) {
    names.push(pathFileName);
  }
  return new Set(names.map(normalizeJobFileName).filter(Boolean));
}

function normalizeJobFileName(value: string): string {
  return value.trim().toLowerCase().replace(/\.(opus|mp3)$/i, "");
}

function isGenericMixedAudioName(value: string): boolean {
  const normalized = normalizeJobFileName(value);
  return normalized === "mixed" || normalized === "audio";
}

function cloudJobMatchesRow(job: CloudJob, candidates: Set<string>, rowRelativePath: string): boolean {
  if (!candidates.has(normalizeJobFileName(job.source_filename))) return false;
  if (!job.relative_path) return true;
  return normalizeRelativePathForMatch(job.relative_path) === normalizeRelativePathForMatch(rowRelativePath);
}

function cloudAvailabilityForRelativePath(jobs: CloudJob[], relativePath: string) {
  const normalizedPath = normalizeRelativePathForMatch(relativePath);
  const matches = jobs.filter((job) => normalizeRelativePathForMatch(job.relative_path ?? "") === normalizedPath);
  return {
    hasTranscription: matches.some((job) => Boolean(job.has_transcription)),
    hasAnalysis: matches.some((job) => Boolean(job.has_analysis)),
  };
}

function normalizeRelativePathForMatch(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(sanitizeRelativePathPart)
    .filter(Boolean)
    .join("/");
}

function parseMarkdownBlocks(content?: string | null): MarkdownBlockData[] {
  if (!content) return [];
  const normalized = content.replace(/^---[\s\S]*?---\s*/m, "");
  const blocks: MarkdownBlockData[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  }

  normalized.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: stripMarkdownContainers(heading[2]) });
      return;
    }

    const unorderedListItem = line.match(/^[-*]\s+(.+)$/);
    const orderedListItem = line.match(/^\d+[.)]\s+(.+)$/);
    if (unorderedListItem || orderedListItem) {
      flushParagraph();
      const ordered = Boolean(orderedListItem);
      if (listItems.length > 0 && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      listItems.push(stripMarkdownContainers((orderedListItem ?? unorderedListItem)?.[1] ?? ""));
      return;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: stripMarkdownContainers(line.replace(/^>\s*/, "")) });
      return;
    }

    const meta = line.match(/^([^:]{2,44}):\s+(.+)$/);
    if (meta && line.length < 140) {
      flushParagraph();
      flushList();
      blocks.push({ type: "meta", label: stripMarkdownContainers(meta[1]), value: stripMarkdownContainers(meta[2]) });
      return;
    }

    flushList();
    paragraphLines.push(stripMarkdownContainers(line));
  });

  flushParagraph();
  flushList();
  return blocks.slice(0, 120);
}

function stripMarkdownContainers(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .trim();
}

function parseMarkdownInline(value: string): MarkdownInlinePart[] {
  const parts: MarkdownInlinePart[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    if (match[4]) {
      parts.push({ type: "code", value: match[4] });
    } else {
      parts.push({ type: "strong", value: match[2] ?? match[3] ?? "" });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value }];
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("copy command failed");
  } finally {
    document.body.removeChild(textarea);
  }
}

function parseTranscriptionAccepted(body: string): { job_id?: string; status?: string } | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isRecord(parsed)) return null;
    return {
      job_id: typeof parsed.job_id === "string" ? parsed.job_id : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function inferMetadata(recording: RecordingSummary): AudioMetadata {
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

function resolveAudioStatus(state: DraftState, client: string): DraftState {
  const normalizedClient = client.trim().toLowerCase();
  if (normalizedClient && !isDraftClient(normalizedClient)) {
    return state === "archived" ? "archived" : "classified";
  }

  return state;
}

function buildClientGroups(rows: AudioRow[]) {
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

function buildProjectsForClient(rows: AudioRow[], selectedClient: string) {
  const visibleRows = rows.filter((row) => row.client === selectedClient);
  const counts = new Map<string, number>();
  counts.set(allProjects, visibleRows.length);

  visibleRows.forEach((row) => {
    counts.set(row.project, (counts.get(row.project) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

function toPlayableAudioSrc(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!isTauriRuntime) return path;
  return convertFileSrc(path);
}

function recordingAudioPath(recording: RecordingSummary): string {
  if (recording.audio_url) return recording.audio_url;
  if (recording.final_audio_path) return recording.final_audio_path;
  if (!recording.folder_path) return "";
  return `${recording.folder_path.replace(/[\\/]$/, "")}\\final\\mixed.opus`;
}

function audioFileName(path: string, displayName: string): string {
  const rawFileName = path.split(/[\\/]/).pop();
  const rawExtension = rawFileName?.match(/\.(mp3|opus)$/i)?.[0] ?? ".opus";

  const safeName = displayName
    .trim()
    .replace(/\.(mp3|opus)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim();

  return `${safeName || rawFileName?.replace(/\.(mp3|opus)$/i, "") || "audio"}${rawExtension}`;
}

function transcriptionRelativePath(client: string, project: string): string {
  const cleanClient = sanitizeRelativePathPart(client);
  const cleanProject = sanitizeRelativePathPart(project);
  if (cleanClient && !isDraftClient(cleanClient)) {
    return cleanProject && cleanProject !== allProjects.toLowerCase() ? `${cleanClient}/${cleanProject}` : cleanClient;
  }
  return "drafts";
}

function sanitizeRelativePathPart(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[ .]+$/g, "")
    .toLowerCase();
}

async function requestBrowserTranscription({
  endpoint,
  apiKey,
  audioSrc,
  audioPath,
  displayName,
  client,
  project,
  durationMs,
}: {
  endpoint: string;
  apiKey: string;
  audioSrc: string;
  audioPath: string;
  displayName: string;
  client: string;
  project: string;
  durationMs?: number;
}): Promise<{ status: number; body: string }> {
  const audioResponse = await fetch(audioSrc);
  if (!audioResponse.ok) {
    throw new Error("No se pudo leer el archivo de audio local.");
  }

  const blob = await audioResponse.blob();
  const fileName = audioFileName(audioPath, displayName);
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("relative_path", transcriptionRelativePath(client, project));
  if (durationMs && durationMs > 0) {
    form.append("duration_ms", String(Math.round(durationMs)));
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: form,
  });

  const body = await response.text();

  if (response.status !== 202) {
    throw new Error(responseErrorText(response.status, body));
  }

  return { status: response.status, body };
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `El servicio respondio ${response.status}.`;
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

function responseErrorText(status: number, body: string): string {
  const fallback = `El servicio respondio ${status}.`;
  if (!body.trim()) return fallback;
  try {
    const payload = JSON.parse(body) as unknown;
    if (isRecord(payload) && typeof payload.detail === "string") return payload.detail;
    if (isRecord(payload) && typeof payload.message === "string") return payload.message;
    return fallback;
  } catch {
    return body.trim() || fallback;
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DeviceSelect({
  label,
  icon,
  devices,
  value,
  disabled,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  devices: AudioDevice[];
  value: string;
  disabled: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="device-select">
      <span>
        {icon}
        {label}
      </span>
      <select
        value={value}
        disabled={disabled || devices.length === 0}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {devices.length === 0 ? (
          <option value="">No disponible</option>
        ) : (
          devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}{device.is_default ? " (default)" : ""}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function SignalIcon({
  icon,
  active,
  color,
  label,
}: {
  icon: ReactNode;
  active: boolean;
  color: "mic" | "system";
  label: string;
}) {
  return (
    <span className={clsx("signal-icon", color, active && "is-active")} title={label} aria-label={label}>
      {icon}
    </span>
  );
}

function MiniButton({
  label,
  icon,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx("mini-button", active && "is-active")}
      disabled={disabled}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

function TrackWave({
  label,
  icon,
  level,
  bars,
  active,
  color,
}: {
  label: string;
  icon: ReactNode;
  level: number;
  bars: number[];
  active: boolean;
  color: "mic" | "system";
}) {
  const hasSignal = active && level > 0.01;

  return (
    <div
      className={clsx("track-wave", color, hasSignal && "has-signal")}
      title={label}
      aria-label={label}
    >
      <div className="track-head">
        {icon}
      </div>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={`${color}-${index}`}
            className="wave-bar"
            style={{
              height: hasSignal ? `${Math.max(4, Math.min(100, height * 100))}%` : "3px",
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

function createMeterBars(level: number): number[] {
  if (level < 0.01) {
    return Array.from({ length: bars.length }, () => 0.04);
  }

  const energy = Math.min(1, level * 2.2);
  return bars.map((bar, index) => {
    const movement = 0.82 + Math.sin(Date.now() / 260 + index * 0.72) * 0.12;
    return Math.min(1, Math.max(0.08, bar * energy * movement));
  });
}

function displayRecordingName(recording: { final_audio_path?: string | null; started_at: string; id: string }): string {
  const fileName = recording.final_audio_path?.split(/[\\/]/).pop()?.replace(/\.opus$/i, "");
  if (fileName) return fileName;

  const startedAt = new Date(recording.started_at);
  if (!Number.isNaN(startedAt.getTime())) {
    return defaultRecordingFileName(startedAt);
  }

  return recording.id.replace("rec_", "");
}

function ControlButton({
  label,
  icon,
  className,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="control-stack">
      <span className="control-label">{label}</span>
      <button
        type="button"
        className={clsx("control-button", className)}
        disabled={disabled}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        {icon}
      </button>
    </div>
  );
}

function formatWidgetDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}h:${minutes.toString().padStart(2, "0")}m:${seconds
    .toString()
    .padStart(2, "0")}s`;
}

function statusTitle(status: string): string {
  if (status === "paused") return "Pausado";
  if (status === "stopping") return "Finalizando";
  if (status === "completed") return "Listo";
  if (status === "error") return "Error";
  if (status === "recording") return "Grabando";
  if (status === "starting") return "Preparando";
  return "Meetings Assistant";
}

function statusSubtitle(status: string): string {
  if (status === "paused") return "Sesión en espera";
  if (status === "completed") return "Audio local disponible";
  if (status === "recording") return "Captura local";
  if (status === "starting") return "Preparando audio";
  if (status === "stopping") return "Cerrando archivos";
  return "Grabador de audio";
}

function useLiveDuration(
  snapshot: {
    status: string;
    recording_id?: string | null;
    duration_ms: number;
  } | null,
  now: number,
): number {
  const [anchor, setAnchor] = useState({ at: now, duration: 0, recordingId: "", status: "idle" });

  useEffect(() => {
    setAnchor({
      at: Date.now(),
      duration: snapshot?.duration_ms ?? 0,
      recordingId: snapshot?.recording_id ?? "",
      status: snapshot?.status ?? "idle",
    });
  }, [snapshot?.duration_ms, snapshot?.recording_id, snapshot?.status]);

  if (!snapshot) return 0;
  if (snapshot.status !== "recording") return snapshot.duration_ms;
  if (anchor.recordingId !== (snapshot.recording_id ?? "") || anchor.status !== "recording") return snapshot.duration_ms;

  return Math.max(snapshot.duration_ms, anchor.duration + now - anchor.at);
}
