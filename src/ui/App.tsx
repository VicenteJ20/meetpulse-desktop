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
import appIcon from "../../src-tauri/icons/icon.png";
import {
  cleanupLocalRecording,
  defaultRecordingFileName,
  archiveCloudClient,
  archiveCloudJob,
  deleteCloudClient,
  deleteCloudJob,
  getCloudJobArtifacts,
  getAudioDevices,
  getSelectedAudioDevices,
  isTauriRuntime,
  listArchivedCloudJobs,
  openExternalUrl,
  openRecordingFolder,
  requestAnalysisRetry,
  requestTranscription,
  saveRecordingToLibrary,
  selectAudioDevice,
  syncCloudDashboard,
  unarchiveCloudJob,
  type AudioDevice,
  type RecordingSummary,
} from "../tauri/commands";
import {
  applyWindowMode,
  closeWindow,
  currentWindowLabel,
  minimizeWindow,
  setWindowAlwaysOnTop,
  setWindowIcon,
  showWindow,
  startWindowDrag,
  toggleWindowMaximize,
} from "../tauri/window";
import { useAuthStore } from "../store/authStore";
import { useRecorderStore } from "../store/recorderStore";
import { LoginScreen } from "./Login";
import { useLiveDuration } from "../hooks/useLiveDuration";
import { LegacyRecorder, LegacyHistoryPanel } from "./components/recorder/LegacyRecorder";
import { StatusBadge } from "./components/library/StatusBadge";
import { MarkdownBlock } from "./components/markdown/MarkdownBlock";
import { ControlButton } from "./components/recorder/ControlButton";
import { DeviceSelect } from "./components/recorder/DeviceSelect";
import { MiniButton } from "./components/recorder/MiniButton";
import { SignalIcon } from "./components/recorder/SignalIcon";
import { TrackWave } from "./components/recorder/TrackWave";
import { WindowTitlebar } from "./components/layout/WindowTitlebar";
import { CompactWidget } from "./components/layout/CompactWidget";
import { LibrarySidebar } from "./components/layout/LibrarySidebar";
import { AudioLibraryTable } from "./components/library/AudioLibraryTable";
import { ArchivedAudioList } from "./components/library/ArchivedAudioList";
import { SettingsPanel } from "./components/layout/SettingsPanel";
import { DetailsPanel } from "./components/layout/DetailsPanel";
import { AudioFocusView } from "./components/layout/AudioFocusView";
import { PlayerBar } from "./components/layout/PlayerBar";
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
  sanitizeRelativePathPart,
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
  const [dashboardView, setDashboardView] = useState<"library" | "archived" | "settings">("library");
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem("recorder-view-mode") === "compact");
  const [pinned, setPinned] = useState(() => localStorage.getItem("recorder-window-pinned") === "true");
  const [saveClient, setSaveClient] = useState("");
  const [saveProject, setSaveProject] = useState("");
  const [saveFileName, setSaveFileName] = useState("");
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [expandedRecordingId, setExpandedRecordingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
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
  const visualTheme: AppTheme = theme;
  const [cloudClients, setCloudClients] = useState<CloudClient[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [cloudJobs, setCloudJobs] = useState<CloudJob[]>([]);
  const [archivedCloudJobs, setArchivedCloudJobs] = useState<CloudJob[]>([]);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [archivedSyncing, setArchivedSyncing] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [restoringArchivedId, setRestoringArchivedId] = useState<string | null>(null);
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
    void setWindowIcon(appIcon);
  }, [init, initAuth]);

  useEffect(() => {
    if (isWidgetWindow) return;
    if (!authState?.is_authenticated) return;
    void refreshCloudDashboard({ showMessage: false });
  }, [authState?.is_authenticated, isWidgetWindow]);

  useEffect(() => {
    if (dashboardView !== "archived") return;
    if (!authState?.is_authenticated) return;
    void refreshArchivedCloudJobs();
  }, [authState?.is_authenticated, dashboardView]);

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
    const handleThemeStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey) return;
      if (event.newValue !== "light" && event.newValue !== "dark") return;
      setTheme(event.newValue);
    };

    window.addEventListener("storage", handleThemeStorage);
    return () => window.removeEventListener("storage", handleThemeStorage);
  }, []);

  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(visualTheme);
  }, [visualTheme]);

  useEffect(() => {
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
    void setWindowAlwaysOnTop(isWidgetWindow ? pinned : false);
  }, [isWidgetWindow, pinned]);

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
    () => cloudJobs.map((job) => cloudJobToAudioRow(job, cloudClients, cloudProjects)),
    [cloudClients, cloudJobs, cloudProjects],
  );
  const archivedCloudRows = useMemo<AudioRow[]>(
    () => archivedCloudJobs.map((job) => cloudJobToAudioRow(job, cloudClients, cloudProjects)),
    [archivedCloudJobs, cloudClients, cloudProjects],
  );
  const linkedCloudJobIds = useMemo(
    () => new Set(Object.values(cloudJobByRecordingId).filter(Boolean)),
    [cloudJobByRecordingId],
  );
  const audioRows = useMemo<AudioRow[]>(
    () => [
      ...cloudAudioRows,
      ...localAudioRows.filter((row) => row.status !== "archived" && (!row.cloudJobId || !linkedCloudJobIds.has(row.cloudJobId))),
    ],
    [cloudAudioRows, linkedCloudJobIds, localAudioRows],
  );
  const archivedRows = useMemo<AudioRow[]>(
    () => [...archivedCloudRows, ...localAudioRows.filter((row) => row.status === "archived")],
    [archivedCloudRows, localAudioRows],
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
  const selectedCanRetryAnalysis = Boolean(selectedCloudJob?.has_transcription || selectedCloudJob?.has_audio);
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

  function removeAudioCloudJob(recordingId: string) {
    setCloudJobByRecordingId((current) => {
      if (!current[recordingId]) return current;
      const next = { ...current };
      delete next[recordingId];
      saveAudioCloudJobs(next);
      return next;
    });
  }

  function clearAudioSelection() {
    setSelectedRecordingId(null);
    setActiveAudioId(null);
    setExpandedRecordingId(null);
    setSelectedArtifacts({});
  }

  function clientSlugForName(clientName: string) {
    return cloudClients.find((client) => client.display_name === clientName || client.slug === clientName)?.slug
      ?? sanitizeRelativePathPart(clientName);
  }

  function localRowsLinkedToCloudJob(jobId: string) {
    return localAudioRows.filter((row) => row.cloudJobId === jobId || cloudJobByRecordingId[row.recording.id] === jobId);
  }

  function localRowsForClient(clientName: string, cloudJobIds: Set<string>) {
    return localAudioRows.filter(
      (row) =>
        row.client === clientName ||
        Boolean(row.cloudJobId && cloudJobIds.has(row.cloudJobId)) ||
        Boolean(cloudJobByRecordingId[row.recording.id] && cloudJobIds.has(cloudJobByRecordingId[row.recording.id])),
    );
  }

  async function handleArchiveAudio(row: AudioRow) {
    const confirmed = window.confirm(`Archivar "${row.displayName}"? Se ocultara de la biblioteca, pero no se borraran sus archivos.`);
    if (!confirmed) return;

    setSaving(true);
    setSaveError(null);
    setLibraryActionError(null);
    try {
      if (row.source === "cloud" && row.cloudJobId) {
        await archiveCloudJob(row.cloudJobId);
        localRowsLinkedToCloudJob(row.cloudJobId).forEach((localRow) => {
          updateAudioMetadata(localRow.recording.id, { ...localRow.metadata, draftState: "archived" });
          removeAudioCloudJob(localRow.recording.id);
        });
        await refreshCloudDashboard({ showMessage: false });
      } else {
        updateAudioMetadata(row.recording.id, { ...row.metadata, draftState: "archived" });
      }
      removeAudioCloudJob(row.recording.id);
      clearAudioSelection();
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAudio(row: AudioRow) {
    const confirmed = window.confirm(`Eliminar permanentemente "${row.displayName}"? Esta accion borra el audio y no deja registro recuperable.`);
    if (!confirmed) return;

    setSaving(true);
    setSaveError(null);
    setLibraryActionError(null);
    try {
      if (row.source === "cloud" && row.cloudJobId) {
        await deleteCloudJob(row.cloudJobId);
        const linkedLocalRows = localRowsLinkedToCloudJob(row.cloudJobId);
        await Promise.all(linkedLocalRows.map((localRow) => cleanupLocalRecording(localRow.recording.id)));
        linkedLocalRows.forEach((localRow) => removeAudioCloudJob(localRow.recording.id));
        await refreshCloudDashboard({ showMessage: false });
      } else {
        await cleanupLocalRecording(row.recording.id);
      }
      removeAudioCloudJob(row.recording.id);
      clearAudioSelection();
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleRestoreArchivedAudio(row: AudioRow) {
    setArchivedError(null);
    setRestoringArchivedId(row.recording.id);
    try {
      if (row.source === "cloud" && row.cloudJobId) {
        await unarchiveCloudJob(row.cloudJobId);
        await Promise.all([refreshCloudDashboard({ showMessage: false }), refreshArchivedCloudJobs()]);
      } else {
        const draftState = isDraftClient(row.metadata.client) ? "draft_saved" : "classified";
        updateAudioMetadata(row.recording.id, { ...row.metadata, draftState });
        await refresh();
      }
    } catch (error) {
      setArchivedError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoringArchivedId(null);
    }
  }

  async function handleArchiveClient(clientName: string) {
    if (clientName === unclassifiedClient) return;
    const confirmed = window.confirm(`Archivar cliente "${clientName}"? Se ocultaran el cliente y sus audios asociados.`);
    if (!confirmed) return;

    setLibraryActionError(null);
    try {
      const clientSlug = clientSlugForName(clientName);
      const affectedCloudJobIds = new Set(
        cloudAudioRows
          .filter((row) => row.client === clientName || row.clientSlug === clientSlug)
          .map((row) => row.cloudJobId)
          .filter((jobId): jobId is string => Boolean(jobId)),
      );
      const localRows = localRowsForClient(clientName, affectedCloudJobIds);
      await archiveCloudClient(clientSlug);
      localRows.forEach((row) => updateAudioMetadata(row.recording.id, { ...row.metadata, draftState: "archived" }));
      localRows.forEach((row) => removeAudioCloudJob(row.recording.id));
      clearAudioSelection();
      setSelectedClient(unclassifiedClient);
      await refreshCloudDashboard({ showMessage: false });
      await refresh();
    } catch (error) {
      setLibraryActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDeleteClient(clientName: string) {
    if (clientName === unclassifiedClient) return;
    const confirmed = window.confirm(`Eliminar permanentemente cliente "${clientName}"? Esto borra sus audios cloud y registros asociados.`);
    if (!confirmed) return;

    setLibraryActionError(null);
    try {
      const clientSlug = clientSlugForName(clientName);
      const affectedCloudJobIds = new Set(
        cloudAudioRows
          .filter((row) => row.client === clientName || row.clientSlug === clientSlug)
          .map((row) => row.cloudJobId)
          .filter((jobId): jobId is string => Boolean(jobId)),
      );
      const localRows = localRowsForClient(clientName, affectedCloudJobIds);
      await deleteCloudClient(clientSlug);
      await Promise.all(localRows.map((row) => cleanupLocalRecording(row.recording.id)));
      localRows.forEach((row) => removeAudioCloudJob(row.recording.id));
      clearAudioSelection();
      setSelectedClient(unclassifiedClient);
      await refreshCloudDashboard({ showMessage: false });
      await refresh();
    } catch (error) {
      setLibraryActionError(error instanceof Error ? error.message : String(error));
    }
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
    const canRetryCloudJob = Boolean(cloudJob?.has_transcription || cloudJob?.has_audio);

    setAnalysisError(null);
    setAnalysisMessage(null);
    setArtifactError(null);

    if (!authState?.is_authenticated) {
      setAnalysisError("Debes iniciar sesion con Google para solicitar el analisis.");
      return;
    }

    if (!canRetryCloudJob && !audioSrc) {
      setAnalysisError("Este audio no tiene archivo final disponible.");
      return;
    }

    setAnalysisSubmitting(true);
    try {
      let acceptedJobId: string | undefined;
      if (canRetryCloudJob && cloudJob) {
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
        const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
        if (!normalizedBackendUrl) {
          throw new Error("Ingresa una URL http o https valida para el backend.");
        }

        const result = await requestBrowserTranscription({
          endpoint: `${normalizedBackendUrl}/transcription/`,
          apiKey: transcriptionApiKey.trim(),
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
        canRetryCloudJob
          ? "Reprocesamiento solicitado. El servicio volvera a generar la transcripcion y el analisis desde el audio guardado."
          : "Analisis solicitado. El servicio acepto el audio para procesarlo.",
      );
      await refreshCloudDashboard({ showMessage: false });
      if (acceptedJobId && !canRetryCloudJob) {
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
      setSettingsMessage("Ingresa una URL http o https valida para el backend.");
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

  async function refreshArchivedCloudJobs() {
    setArchivedError(null);

    if (!authState?.is_authenticated) {
      setArchivedCloudJobs([]);
      return;
    }

    setArchivedSyncing(true);
    try {
      const jobs = await listArchivedCloudJobs();
      setArchivedCloudJobs(parseCloudJobs(jobs));
    } catch (error) {
      setArchivedError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchivedSyncing(false);
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
          onPointerDown={handleTitlebarPointerDown}
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
          theme={visualTheme}
          appIcon={appIcon}
          onPrimary={handlePrimary}
          onStop={() => void stop()}
          onClose={() => void closeWindow()}
          onTogglePinned={() => setPinned((value) => !value)}
          onPointerDown={handleTitlebarPointerDown}
        />
      ) : (
        <>
          <section className="dashboard-shell">
            <LibrarySidebar
              appIcon={appIcon}
              recordingsCount={recordings.length}
              dashboardView={dashboardView}
              theme={theme}
              clients={clients}
              selectedClient={selectedClient}
              onDashboardViewChange={setDashboardView}
              onThemeChange={setTheme}
              onArchiveClient={handleArchiveClient}
              onDeleteClient={handleDeleteClient}
              onClientSelect={(client) => {
                setSelectedClient(client);
                setSelectedProject(allProjects);
                setSelectedRecordingId(null);
                setExpandedRecordingId(null);
              }}
            />

            <div className="dashboard-main">
              <header className="dashboard-topbar" data-tauri-drag-region>
                <div>
                  <p>
                    {dashboardView === "settings"
                      ? "Preferencias"
                      : dashboardView === "archived"
                        ? "Archivo"
                        : "Biblioteca administrativa"}
                  </p>
                  <h1>{dashboardView === "settings" ? "Configuracion" : dashboardView === "archived" ? "Archivados" : selectedClient}</h1>
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
                <SettingsPanel
                  cloudSyncedAt={cloudSyncedAt}
                  cloudSyncing={cloudSyncing}
                  cloudClientsCount={cloudClients.length}
                  cloudProjectsCount={cloudProjects.length}
                  cloudJobsCount={cloudJobs.length}
                  authState={authState}
                  onSync={handleSyncCloudDashboard}
                  onLogin={() => void login()}
                  onLogout={() => void logout()}
                  authLoading={useAuthStore.getState().loading}
                  message={settingsMessage}
                  error={cloudSyncError}
                />
              ) : dashboardView === "archived" ? (
                <div className="content-grid is-archived">
                  <ArchivedAudioList
                    rows={archivedRows}
                    loading={archivedSyncing}
                    error={archivedError}
                    restoringId={restoringArchivedId}
                    audioDurationById={audioDurationById}
                    onRestore={(row) => void handleRestoreArchivedAudio(row)}
                  />
                </div>
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
                <AudioFocusView
                  selectedRow={selectedRow}
                  selectedCloudJob={selectedCloudJob}
                  artifactTab={artifactTab}
                  artifactCopyFormat={artifactCopyFormat}
                  artifactCopyState={artifactCopyState}
                  artifactLoading={artifactLoading}
                  cloudSyncing={cloudSyncing}
                  artifactError={artifactError}
                  cloudSyncError={cloudSyncError}
                  selectedArtifactBlocks={selectedArtifactBlocks}
                  selectedArtifactContent={selectedArtifactContent}
                  audioDurationById={audioDurationById}
                  onBack={() => setExpandedRecordingId(null)}
                  onTabChange={setArtifactTab}
                  onCopyFormatChange={setArtifactCopyFormat}
                  onCopy={handleCopyArtifact}
                />
                ) : (
                  <AudioLibraryTable
                    filteredRows={filteredRows}
                    selectedRecordingId={selectedRecordingId}
                    onSelectRecording={handleSelectRecording}
                    audioDurationById={audioDurationById}
                  />
                )}

                <DetailsPanel
                  selectedRow={selectedRow}
                  selectedCloudJob={selectedCloudJob}
                  saveFileName={saveFileName}
                  saveClient={saveClient}
                  saveProject={saveProject}
                  saveNotes={saveNotes}
                  saving={saving}
                  savedPath={savedPath}
                  saveError={saveError}
                  analysisSubmitting={analysisSubmitting}
                  analysisMessage={analysisMessage}
                  analysisError={analysisError}
                  selectedCanRequestAnalysis={selectedCanRequestAnalysis}
                  selectedCanRetryAnalysis={selectedCanRetryAnalysis}
                  audioDurationById={audioDurationById}
                  onFileNameChange={setSaveFileName}
                  onClientChange={setSaveClient}
                  onProjectChange={setSaveProject}
                  onNotesChange={setSaveNotes}
                  onSave={handleSave}
                  onOpenFolder={openRecordingFolder}
                  onArchiveAudio={handleArchiveAudio}
                  onDeleteAudio={handleDeleteAudio}
                  onRequestAnalysis={handleRequestAnalysis}
                  onOpenExpanded={handleOpenExpandedContent}
                  onClose={() => {
                    setSelectedRecordingId(null);
                    setExpandedRecordingId(null);
                  }}
                />
                  </div>

                  <PlayerBar
                    activeRow={activeRow}
                    activeAudioSrc={activeAudioSrc}
                    playbackAudioSrc={playbackAudioSrc}
                    playerCurrentMs={playerCurrentMs}
                    playerDurationMs={playerDurationMs}
                    visiblePlayerDuration={visiblePlayerDuration}
                    playerPlaying={playerPlaying}
                    playerLoading={playerLoading}
                    playerError={playerError}
                    audioRef={audioRef}
                    onPlay={() => void handlePlayerPlay()}
                    onPause={handlePlayerPause}
                    onStop={handlePlayerStop}
                    onTimeChange={(ms) => {
                      lastPlayerUiUpdateRef.current = 0;
                      setPlayerCurrentMs(ms);
                      if (audioRef.current) {
                        audioRef.current.currentTime = ms / 1000;
                      }
                    }}
                    onLoadedMetadata={(event) => {
                      const seconds = event.currentTarget.duration;
                      const nextDurationMs = Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;
                      handlePlayerTimeUpdate(event.currentTarget.currentTime, true);
                      setPlayerDurationMs(nextDurationMs);
                    }}
                    onTimeUpdate={(event) => handlePlayerTimeUpdate(event.currentTarget.currentTime)}
                    activeRowDurationUpdate={(id, durationMs) => {
                      setAudioDurationById((current) => ({ ...current, [id]: durationMs }));
                    }}
                  />
                </>
              )}

              {(error || snapshot?.last_error || deviceError) && <div className="widget-error dashboard-error">{error ?? snapshot?.last_error ?? deviceError}</div>}
              {libraryActionError && <div className="widget-error dashboard-error">{libraryActionError}</div>}
            </div>
          </section>

          {legacyExpandedRecorderEnabled && (
            <>
              <LegacyRecorder
                status={status}
                statusTitle={statusTitle}
                statusSubtitle={statusSubtitle}
                compactMode={compactMode}
                visibleRecordingName={visibleRecordingName}
                inputDevices={inputDevices}
                outputDevices={outputDevices}
                selectedInputId={selectedInputId}
                selectedOutputId={selectedOutputId}
                duration={duration}
                micLevel={micLevel}
                systemLevel={systemLevel}
                visibleMicBars={visibleMicBars}
                visibleSystemBars={visibleSystemBars}
                isRecording={isRecording}
                isActive={isActive}
                isBusy={isBusy}
                isPaused={isPaused}
                recordings={recordings}
                selectedRecordingId={selectedRecordingId}
                selectedRecording={selectedRecording}
                saving={saving}
                saveClient={saveClient}
                saveProject={saveProject}
                saveFileName={saveFileName}
                savedPath={savedPath}
                saveError={saveError}
                onToggleCompactMode={toggleCompactMode}
                onDeviceChange={handleDeviceChange}
                onStop={() => void stop()}
                onPrimary={handlePrimary}
                onToggleHistory={() => setShowHistory((value) => !value)}
                onSelectRecording={(recording) => {
                  setSelectedRecordingId(recording.id);
                  setSaveError(null);
                  setSavedPath(null);
                  setSaveFileName(displayRecordingName(recording));
                }}
                onSave={handleSave}
                onCloseOrganize={() => setSelectedRecordingId(null)}
                onClientChange={setSaveClient}
                onProjectChange={setSaveProject}
                onFileNameChange={setSaveFileName}
              />
              {showHistory && (
                <LegacyHistoryPanel
                  recordings={recordings}
                  selectedRecordingId={selectedRecordingId}
                  selectedRecording={selectedRecording}
                  saving={saving}
                  saveClient={saveClient}
                  saveProject={saveProject}
                  saveFileName={saveFileName}
                  savedPath={savedPath}
                  saveError={saveError}
                  onSelectRecording={(recording) => {
                    setSelectedRecordingId(recording.id);
                    setSaveError(null);
                    setSavedPath(null);
                    setSaveFileName(displayRecordingName(recording));
                  }}
                  onSave={handleSave}
                  onClose={() => setShowHistory(false)}
                  onClientChange={setSaveClient}
                  onProjectChange={setSaveProject}
                  onFileNameChange={setSaveFileName}
                />
              )}
              {(error || snapshot?.last_error || deviceError) && <div className="widget-error">{error ?? snapshot?.last_error ?? deviceError}</div>}
            </>
          )}
        </>
      )}
    </main>
  );
}

