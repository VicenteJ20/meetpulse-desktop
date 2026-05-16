import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import {
  ChevronRight,
  CheckCircle2,
  Clock3,
  Copy,
  Disc3,
  Eye,
  ExternalLink,
  FileAudio,
  FileText,
  FolderOpen,
  History,
  Loader2,
  ListMusic,
  Maximize2,
  Mic,
  Minus,
  MonitorSpeaker,
  Moon,
  Pause,
  Pin,
  Play,
  Save,
  Search,
  Settings,
  Sparkles,
  SlidersHorizontal,
  Square,
  Sun,
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
  toggleWindowMaximize,
} from "../tauri/window";
import { useAuthStore } from "../store/authStore";
import { useRecorderStore } from "../store/recorderStore";
import { LoginScreen } from "./Login";
import { StatusBadge } from "./components/library/StatusBadge";
import { MarkdownBlock } from "./components/markdown/MarkdownBlock";
import { ControlButton } from "./components/recorder/ControlButton";
import { DeviceSelect } from "./components/recorder/DeviceSelect";
import { MiniButton } from "./components/recorder/MiniButton";
import { SignalIcon } from "./components/recorder/SignalIcon";
import { TrackWave } from "./components/recorder/TrackWave";
import { WindowTitlebar } from "./components/layout/WindowTitlebar";
import { CompactWidget } from "./components/layout/CompactWidget";
import {
  backendUrlStorageKey,
  loadAudioCloudJobs,
  loadAudioMetadata,
  loadBackendUrl,
  loadStoredTheme,
  normalizeBackendUrl,
  saveAudioCloudJobs,
  saveAudioMetadata,
  themeStorageKey,
  transcriptionApiKeyStorageKey,
} from "./lib/appStorage";
import {
  audioDurationMs,
  buildClientGroups,
  buildProjectsForClient,
  displayRecordingName,
  inferMetadata,
  isDraftClient,
  recordingAudioPath,
  resolveAudioStatus,
  toPlayableAudioSrc,
} from "./lib/audioLibrary";
import type { AppTheme, AudioMetadata, AudioRow, CloudClient, CloudJob, CloudProject } from "./lib/audioTypes";
import { copyTextToClipboard } from "./lib/clipboard";
import {
  cloudJobToAudioRow,
  findCloudJobForRow,
  mergeClientGroups,
  mergeProjectsForClient,
  parseCloudClients,
  parseCloudJobs,
  parseCloudProjects,
} from "./lib/cloudLibrary";
import { formatDateTime } from "./lib/dateFormat";
import { allProjects, unclassifiedClient } from "./lib/libraryConstants";
import { markdownBlocksToPlainText, parseMarkdownBlocks } from "./lib/markdown";
import { createMeterBars, formatWidgetDuration, statusSubtitle, statusTitle } from "./lib/recordingUi";
import { parseTranscriptionAccepted, requestBrowserTranscription, responseErrorMessage } from "./lib/transcription";

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
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playbackAudioSrc, setPlaybackAudioSrc] = useState("");
  const [backendUrl, setBackendUrl] = useState(() => loadBackendUrl());
  const [transcriptionApiKey, setTranscriptionApiKey] = useState(() => localStorage.getItem(transcriptionApiKeyStorageKey) ?? "");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<AppTheme>(() => loadStoredTheme());
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
  const [artifactCopyFormat, setArtifactCopyFormat] = useState<"plain" | "markdown">("plain");
  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [selectedOutputId, setSelectedOutputId] = useState("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayerUiUpdateRef = useRef(0);

  useEffect(() => {
    void init();
    void initAuth();
  }, [init, initAuth]);

  useEffect(() => {
    if (isWidgetWindow) return;
    if (!authState?.is_authenticated) return;
    void refreshCloudDashboard({ showMessage: false });
  }, [authState?.is_authenticated, isWidgetWindow]);

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
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

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
    setPlaybackAudioSrc("");
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

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);
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
  const cloudMode = Boolean(authState?.is_authenticated);
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
  const selectedArtifactBlocks = useMemo(() => parseMarkdownBlocks(selectedArtifactContent), [selectedArtifactContent]);
  const expandedContentOpen = Boolean(selectedRow && expandedRecordingId === selectedRow.recording.id);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function preparePlaybackSource() {
      audioRef.current?.pause();
      setPlayerPlaying(false);
      setPlayerCurrentMs(0);
      setPlayerDurationMs(0);
      setPlayerError(null);
      setPlaybackAudioSrc("");

      if (!activeAudioSrc) {
        setPlayerLoading(false);
        return;
      }

      if (!isTauriRuntime || /^https?:\/\//i.test(activeAudioSrc)) {
        setPlaybackAudioSrc(activeAudioSrc);
        setPlayerLoading(false);
        return;
      }

      setPlayerLoading(true);
      try {
        const response = await fetch(activeAudioSrc, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`No se pudo leer el audio (${response.status})`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setPlaybackAudioSrc(objectUrl);
        }
      } catch (error) {
        if (!cancelled) {
          setPlayerError(error instanceof Error ? error.message : "No se pudo preparar el audio");
        }
      } finally {
        if (!cancelled) {
          setPlayerLoading(false);
        }
      }
    }

    void preparePlaybackSource();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeAudioSrc]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedArtifacts() {
      setSelectedArtifacts({});
      setArtifactError(null);
      if (!expandedContentOpen) return;
      if (!selectedCloudJob) return;

      if (!authState?.is_authenticated || (!selectedCloudJob.has_transcription && !selectedCloudJob.has_analysis)) return;

      setArtifactLoading(true);
      try {
        const artifacts = await getCloudJobArtifacts({
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
    // Close expanded view when switching to a different audio
    setExpandedRecordingId(null);
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
    // Toggle: if already open for this audio, close it
    if (expandedRecordingId === row.recording.id) {
      setExpandedRecordingId(null);
      return;
    }
    handleSelectRecording(row);
    setExpandedRecordingId(row.recording.id);
    setArtifactError(null);
    setSelectedArtifacts({});
    await refreshCloudDashboard({ showMessage: false });
  }

  async function handlePlayerPlay() {
    if (!audioRef.current || !playbackAudioSrc || playerLoading) return;
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
    lastPlayerUiUpdateRef.current = 0;
    setPlayerCurrentMs(0);
    setPlayerPlaying(false);
  }

  function handlePlayerTimeUpdate(currentTime: number, force = false) {
    const nowMs = performance.now();
    if (!force && nowMs - lastPlayerUiUpdateRef.current < 500) return;
    lastPlayerUiUpdateRef.current = nowMs;
    setPlayerCurrentMs(Math.round(currentTime * 1000));
  }

  async function handleRequestAnalysis(row: AudioRow) {
    const audioPath = recordingAudioPath(row.recording);
    const audioSrc = audioPath ? toPlayableAudioSrc(audioPath) : "";
    const cloudJob = selectedCloudJob;
    const canRetryFromTranscription = Boolean(cloudJob?.has_transcription);

    setAnalysisError(null);
    setAnalysisMessage(null);
    setArtifactError(null);

    if (!authState?.is_authenticated) {
      setAnalysisError("Debes iniciar sesion con Google para solicitar el analisis.");
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
          jobId: cloudJob.job_id,
        });
        acceptedJobId = cloudJob.job_id;
        setSelectedArtifacts((current) => ({ ...current, analysis: null }));
        setArtifactTab("analysis");
      } else if (isTauriRuntime) {
        const result = await requestTranscription({
          recordingId: row.recording.id,
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
          endpoint: "",
          apiKey: "",
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
      setAnalysisError(error instanceof Error ? error.message : String(error));
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
    setCloudSyncError(null);
    if (showMessage) setSettingsMessage(null);

    if (!authState?.is_authenticated) {
      setCloudSyncError("Debes iniciar sesion con Google para sincronizar.");
      return;
    }

    setCloudSyncing(true);
    try {
      const dashboard = await syncCloudDashboard();
      setCloudClients(parseCloudClients(dashboard.clients));
      setCloudProjects(parseCloudProjects(dashboard.projects));
      setCloudJobs(parseCloudJobs(dashboard.jobs));
      setCloudSyncedAt(new Date().toISOString());
      if (showMessage) setSettingsMessage("Sincronizacion completada.");
    } catch (error) {
      setCloudSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudSyncing(false);
    }
  }

  async function handleCopyArtifact() {
    if (!selectedArtifactContent?.trim()) return;

    try {
      const text =
        artifactCopyFormat === "markdown"
          ? selectedArtifactContent
          : markdownBlocksToPlainText(selectedArtifactBlocks, selectedArtifactContent);
      await copyTextToClipboard(text);
      setArtifactCopyState("copied");
      window.setTimeout(() => setArtifactCopyState("idle"), 1800);
    } catch {
      setArtifactCopyState("error");
    }
  }

  if (!authState?.is_authenticated) {
    return <LoginScreen />;
  }

  return (
    <main className={clsx("widget-shell", compactView && "is-compact")}>
      {!compactView && (
        <WindowTitlebar
          icon={appIcon}
          pinned={pinned}
          onPointerDown={handleTitlebarPointerDown}
          onTogglePinned={() => setPinned((value) => !value)}
          onMinimize={() => void minimizeWindow()}
          onMaximize={() => void toggleWindowMaximize()}
          onClose={() => void closeWindow()}
        />
      )}

      {compactView ? (
        <CompactWidget
          duration={duration}
          isRecording={isRecording}
          isPaused={isPaused}
          isBusy={isBusy}
          isActive={isActive}
          micLevel={micLevel}
          systemLevel={systemLevel}
          pinned={pinned}
          onPrimary={handlePrimary}
          onStop={() => void stop()}
          onClose={() => void closeWindow()}
          onTogglePinned={() => setPinned((value) => !value)}
          onExpand={() => toggleCompactMode(false)}
          onPointerDown={handleTitlebarPointerDown}
        />
      ) : (
        <>
          <section className="dashboard-shell">
            <aside className="library-sidebar">
              <div className="sidebar-brand" data-tauri-drag-region>
                <span className="brand-mark">
                  <img src={appIcon} alt="" />
                </span>
                <div>
                  <strong>Meeting Assistant</strong>
                  <span>{recordings.length} audios</span>
                </div>
              </div>

              <div className="quick-recorder">
                <button
                  type="button"
                  className="recorder-launcher"
                  onClick={() => {
                    if (isTauriRuntime) {
                      showWindow("widget");
                    }
                  }}
                >
                  <Mic />
                  <span>Iniciar grabacion</span>
                </button>
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

              <div className="theme-switcher" aria-label="Tema">
                <button
                  type="button"
                  className={clsx(theme === "light" && "is-selected")}
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                  title="Usar tema claro"
                >
                  <Sun />
                  Claro
                </button>
                <button
                  type="button"
                  className={clsx(theme === "dark" && "is-selected")}
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                  title="Usar tema oscuro"
                >
                  <Moon />
                  Oscuro
                </button>
              </div>

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
                        setSelectedRecordingId(null);
                        setExpandedRecordingId(null);
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
                    <span className="backend-status">{authState?.is_authenticated ? "Conectado a nube" : "Modo local"}</span>
                  )}
                </div>
              </header>

              {dashboardView === "settings" ? (
                <section className="settings-panel">
                  <div className="section-head">
                    <div>
                      <p>Sincronizacion de servicios</p>
                      <h2>Servicios Cloud</h2>
                    </div>
                    <span><Settings /> Sistema</span>
                  </div>

                  <div className="settings-form">
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
                        onClick={() => {
                          setSelectedProject(project.name);
                          setSelectedRecordingId(null);
                          setExpandedRecordingId(null);
                        }}
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
                    {/* ── Top bar ───────────────────────────────────── */}
                    <div className="audio-focus-bar">
                      <button
                        type="button"
                        className="audio-focus-back"
                        onClick={() => setExpandedRecordingId(null)}
                        aria-label="Volver a la lista"
                        title="Volver a la lista"
                      >
                        <ChevronRight />
                      </button>

                      <div className="audio-focus-identity">
                        <span className="audio-focus-crumb">{selectedRow.client} / {selectedRow.project}</span>
                        <h2 className="audio-focus-title">{selectedRow.displayName}</h2>
                      </div>

                      <div className="audio-focus-meta-pills">
                        <span>{formatDuration(audioDurationMs(selectedRow, audioDurationById))}</span>
                        <span>{formatDateTime(selectedRow.recording.started_at)}</span>
                      </div>

                      {/* Tab switcher integrated in top bar */}
                      <div className="audio-focus-tabs" role="tablist" aria-label="Contenido del job">
                        <button
                          type="button"
                          className={clsx(artifactTab === "transcription" && "is-active", !selectedCloudJob?.has_transcription && "is-unavailable")}
                          onClick={() => setArtifactTab("transcription")}
                          aria-selected={artifactTab === "transcription"}
                        >
                          <FileText size={13} />
                          Transcripcion
                        </button>
                        <button
                          type="button"
                          className={clsx(artifactTab === "analysis" && "is-active", !selectedCloudJob?.has_analysis && "is-unavailable")}
                          onClick={() => setArtifactTab("analysis")}
                          aria-selected={artifactTab === "analysis"}
                        >
                          <Sparkles size={13} />
                          Analisis
                        </button>
                      </div>

                      <div className="audio-focus-copy-group" aria-label="Opciones de copia">
                        <div className="copy-format-toggle" role="group" aria-label="Formato de copia">
                          <button
                            type="button"
                            className={clsx(artifactCopyFormat === "plain" && "is-active")}
                            onClick={() => setArtifactCopyFormat("plain")}
                          >
                            Texto
                          </button>
                          <button
                            type="button"
                            className={clsx(artifactCopyFormat === "markdown" && "is-active")}
                            onClick={() => setArtifactCopyFormat("markdown")}
                          >
                            Markdown
                          </button>
                        </div>
                        <button
                          type="button"
                          className={clsx("audio-focus-copy", artifactCopyState === "copied" && "is-copied", artifactCopyState === "error" && "is-error")}
                          onClick={() => void handleCopyArtifact()}
                          disabled={!selectedArtifactContent?.trim()}
                          title={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"} como ${artifactCopyFormat === "markdown" ? "Markdown" : "texto"}`}
                          aria-label={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"} como ${artifactCopyFormat === "markdown" ? "Markdown" : "texto"}`}
                        >
                          {artifactCopyState === "copied" ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                        </button>
                      </div>
                    </div>

                    {/* ── Content area ──────────────────────────────── */}
                    <div className="markdown-stage" data-tab={artifactTab}>
                      {artifactLoading ? (
                        <div className="lyrics-empty"><Loader2 className="is-spinning" /> Cargando contenido</div>
                      ) : cloudSyncing && !selectedCloudJob ? (
                        <div className="lyrics-empty"><Loader2 className="is-spinning" /> Buscando contenido cloud</div>
                      ) : artifactError ? (
                        <div className="lyrics-empty is-error">{artifactError}</div>
                      ) : cloudSyncError && !selectedCloudJob ? (
                        <div className="lyrics-empty is-error">{cloudSyncError}</div>
                      ) : selectedArtifactBlocks.length > 0 ? (
                        <div className={clsx("markdown-body", artifactTab === "transcription" && "is-transcript")}>
                          {selectedArtifactBlocks.map((block, index) => <MarkdownBlock key={`${artifactTab}-${index}`} block={block} tab={artifactTab} />)}
                        </div>
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
                        <div className="details-head-badges">
                          {selectedCloudJob && (
                            <>
                              <span
                                className={clsx("cloud-badge", selectedCloudJob.has_transcription && "is-available")}
                                title={selectedCloudJob.has_transcription ? "Transcripcion disponible" : "Sin transcripcion"}
                              >
                                <FileText />
                              </span>
                              <span
                                className={clsx("cloud-badge", selectedCloudJob.has_analysis && "is-available")}
                                title={selectedCloudJob.has_analysis ? "Analisis disponible" : "Sin analisis"}
                              >
                                <Sparkles />
                              </span>
                            </>
                          )}
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

                      <div className="details-actions">
                        <button type="button" className="details-action-btn" onClick={() => void openRecordingFolder(selectedRow.recording.id)} disabled={saving || selectedRow.source === "cloud"}>
                          <FolderOpen size={15} />
                          Abrir archivo
                        </button>
                        <button type="button" className="details-action-btn is-primary" onClick={() => void handleSave(selectedRow.recording.id, false)} disabled={saving || selectedRow.source === "cloud"}>
                          <Save size={15} />
                          Guardar
                        </button>
                        <button type="button" className="details-action-btn is-success" onClick={() => void handleSave(selectedRow.recording.id, true)} disabled={saving || selectedRow.source === "cloud"}>
                          <ChevronRight size={15} />
                          Drafts
                        </button>
                      </div>

                      {(savedPath || saveError) && (
                        <p className={clsx("save-message details-save-message", saveError && "is-error")}>
                          {saveError ?? `Guardado en ${savedPath}`}
                        </p>
                      )}

                      <div className="details-section analysis-section">
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
                          {analysisSubmitting ? <Loader2 className="is-spinning" /> : <Sparkles size={16} />}
                          {analysisSubmitting ? "Solicitando..." : selectedCanRetryAnalysis ? "Reanalizar" : "Solicitar analisis"}
                        </button>
                        {(analysisMessage || analysisError) && (
                          <p className={clsx("save-message details-save-message", analysisError && "is-error")}>
                            {analysisError ?? analysisMessage}
                          </p>
                        )}
                      </div>
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
                    <button type="button" onClick={() => void handlePlayerPlay()} disabled={!playbackAudioSrc || playerLoading || playerPlaying} aria-label="Reproducir" title="Reproducir">
                      <Play />
                    </button>
                    <button type="button" onClick={handlePlayerPause} disabled={!playbackAudioSrc || !playerPlaying} aria-label="Pausar" title="Pausar">
                      <Pause />
                    </button>
                    <button type="button" onClick={handlePlayerStop} disabled={!playbackAudioSrc} aria-label="Detener" title="Detener">
                      <Square />
                    </button>
                    <div className="player-progress" aria-label="Progreso">
                      <span>{formatDuration(playerCurrentMs)}</span>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(visiblePlayerDuration, 1)}
                        value={Math.min(playerCurrentMs, Math.max(visiblePlayerDuration, 1))}
                        disabled={!playbackAudioSrc || playerLoading}
                        onChange={(event) => {
                          const nextMs = Number(event.currentTarget.value);
                          lastPlayerUiUpdateRef.current = 0;
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
                      key={playbackAudioSrc || activeAudioSrc}
                      preload="auto"
                      src={playbackAudioSrc || undefined}
                      onLoadedMetadata={(event) => {
                        const seconds = event.currentTarget.duration;
                        const nextDurationMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
                        handlePlayerTimeUpdate(event.currentTarget.currentTime, true);
                        setPlayerDurationMs(nextDurationMs);
                        if (activeRow && nextDurationMs > 0) {
                          setAudioDurationById((current) => ({ ...current, [activeRow.recording.id]: nextDurationMs }));
                        }
                      }}
                      onTimeUpdate={(event) => handlePlayerTimeUpdate(event.currentTarget.currentTime)}
                      onPause={() => setPlayerPlaying(false)}
                      onPlay={() => setPlayerPlaying(true)}
                      onEnded={handlePlayerStop}
                      onError={() => {
                        setPlayerPlaying(false);
                        setPlayerError("No se pudo cargar el archivo de audio");
                      }}
                    />
                    {(playerLoading || playerError) && <span className="player-error">{playerLoading ? "Preparando audio..." : playerError}</span>}
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
