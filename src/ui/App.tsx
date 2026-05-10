import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ChevronRight,
  Clock3,
  Disc3,
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
import {
  defaultRecordingFileName,
  getAudioDevices,
  getSelectedAudioDevices,
  isTauriRuntime,
  openExternalUrl,
  openRecordingFolder,
  requestTranscription,
  saveRecordingToLibrary,
  selectAudioDevice,
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
import { useRecorderStore } from "../store/recorderStore";

const bars = [
  0.52, 0.7, 0.38, 0.78, 0.66, 0.46, 0.3, 0.58, 0.24, 0.51, 0.72, 0.37, 0.44, 0.64, 0.29, 0.53, 0.4, 0.62,
  0.35, 0.75, 0.28, 0.45, 0.59, 0.33, 0.49, 0.71, 0.39, 0.56, 0.48, 0.8, 0.34, 0.61, 0.4, 0.68, 0.3, 0.54,
  0.44, 0.76, 0.36, 0.58,
];

const audioMetadataStorageKey = "meetings-assistant-audio-metadata";
const backendUrlStorageKey = "meetings-assistant-backend-url";
const transcriptionApiKeyStorageKey = "meetings-assistant-transcription-api-key";
const defaultBackendUrl = "http://localhost:8000";
const unclassifiedClient = "Sin clasificar";
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
};

export function App() {
  const { snapshot, recordings, loading, error, init, refresh, start, pause, resume, stop } = useRecorderStore();
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saveNotes, setSaveNotes] = useState("");
  const [metadataById, setMetadataById] = useState<Record<string, AudioMetadata>>(() => loadAudioMetadata());
  const [selectedClient, setSelectedClient] = useState(unclassifiedClient);
  const [selectedProject, setSelectedProject] = useState(allProjects);
  const [audioQuery, setAudioQuery] = useState("");
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [playerCurrentMs, setPlayerCurrentMs] = useState(0);
  const [playerDurationMs, setPlayerDurationMs] = useState(0);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState(() => loadBackendUrl());
  const [transcriptionApiKey, setTranscriptionApiKey] = useState(() => localStorage.getItem(transcriptionApiKeyStorageKey) ?? "");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
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
  }, [init]);

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
  const audioRows = useMemo<AudioRow[]>(
    () =>
      recordings.map((recording) => {
        const inferred = inferMetadata(recording);
        const metadata = metadataById[recording.id] ?? inferred;
        const client = metadata.client.trim() || inferred.client;
        const project = metadata.project.trim() || inferred.project;
        const title = metadata.title.trim() || displayRecordingName(recording);
        const status = resolveAudioStatus(metadata.draftState, client);

        return {
          recording,
          metadata: { ...metadata, client, project, title },
          displayName: title,
          client,
          project,
          status,
        };
      }),
    [metadataById, recordings],
  );
  const clients = useMemo(() => buildClientGroups(audioRows), [audioRows]);
  const projectsForSelectedClient = useMemo(
    () => buildProjectsForClient(audioRows, selectedClient),
    [audioRows, selectedClient],
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
  const visiblePlayerDuration = playerDurationMs || activeRow?.recording.duration_ms || 0;
  const selectedCanRequestAnalysis = selectedRow?.status === "classified" && Boolean(selectedRow && recordingAudioPath(selectedRow.recording));

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

    setAnalysisError(null);
    setAnalysisMessage(null);

    if (!endpoint) {
      setAnalysisError("Configura la URL del backend antes de solicitar el analisis.");
      return;
    }

    if (!apiKey) {
      setAnalysisError("Configura la API key antes de solicitar el analisis.");
      return;
    }

    if (!audioSrc) {
      setAnalysisError("Este audio no tiene archivo final disponible.");
      return;
    }

    setAnalysisSubmitting(true);
    try {
      if (isTauriRuntime) {
        await requestTranscription({
          recordingId: row.recording.id,
          endpoint,
          apiKey,
        });
      } else {
        await requestBrowserTranscription(endpoint, apiKey, audioSrc, audioPath, row.displayName);
      }

      setAnalysisMessage("Analisis solicitado. El servicio acepto el audio para procesarlo.");
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

  return (
    <main className={clsx("widget-shell", compactView && "is-compact")}>
      {!compactView && (
        <header
          className="windows-titlebar"
          data-tauri-drag-region
          onPointerDown={handleTitlebarPointerDown}
        >
          <div className="window-brand" data-tauri-drag-region>
            <span className="window-icon" />
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
                    {settingsMessage && <p className="save-message details-save-message">{settingsMessage}</p>}
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
                      </button>
                    ))}
                  </div>

                  <div className="content-grid">
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
                          <span className="audio-duration">{formatDuration(row.recording.duration_ms)}</span>
                          <StatusBadge state={row.status} />
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <aside className="details-panel">
                  {selectedRow ? (
                    <>
                      <div className="details-head">
                        <div>
                          <p>Audio seleccionado</p>
                          <h2>{selectedRow.displayName}</h2>
                        </div>
                        <button type="button" onClick={() => setSelectedRecordingId(null)} aria-label="Cerrar detalle" title="Cerrar detalle">
                          <X />
                        </button>
                      </div>

                      <div className="details-summary">
                        <div className="summary-item">
                          <span><Clock3 /> Duracion</span>
                          <strong>{formatDuration(selectedRow.recording.duration_ms)}</strong>
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
                            <input value={saveFileName} onChange={(event) => setSaveFileName(event.currentTarget.value)} placeholder={selectedRow.displayName} disabled={saving} />
                          </label>
                          <label className="field-control">
                            <span>Cliente</span>
                            <input value={saveClient} onChange={(event) => setSaveClient(event.currentTarget.value)} placeholder="Sin cliente" disabled={saving} />
                          </label>
                          <label className="field-control">
                            <span>Proyecto</span>
                            <input value={saveProject} onChange={(event) => setSaveProject(event.currentTarget.value)} placeholder="Sin proyecto" disabled={saving} />
                          </label>
                          <label className="field-control">
                            <span>Notas internas</span>
                            <textarea value={saveNotes} onChange={(event) => setSaveNotes(event.currentTarget.value)} placeholder="Notas internas" disabled={saving} />
                          </label>
                        </div>
                      </div>

                      <div className="organize-actions dashboard-actions">
                        <button type="button" onClick={() => void openRecordingFolder(selectedRow.recording.id)} disabled={saving}>
                          <FolderOpen />
                          Abrir
                        </button>
                        <button type="button" className="save-strong" onClick={() => void handleSave(selectedRow.recording.id, false)} disabled={saving}>
                          <Save />
                          Guardar biblioteca
                        </button>
                        <button type="button" className="draft-strong" onClick={() => void handleSave(selectedRow.recording.id, true)} disabled={saving}>
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
                          disabled={!selectedCanRequestAnalysis || analysisSubmitting}
                          title={selectedCanRequestAnalysis ? "Solicitar analisis" : "Clasifica el audio antes de solicitar analisis"}
                        >
                          {analysisSubmitting ? <Loader2 className="is-spinning" /> : <Sparkles />}
                          {analysisSubmitting ? "Solicitando" : "Solicitar analisis"}
                        </button>
                        {(analysisMessage || analysisError) && (
                          <p className={clsx("save-message details-save-message", analysisError && "is-error")}>
                            {analysisError ?? analysisMessage}
                          </p>
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
                        setPlayerDurationMs(Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0);
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
            Desarrollado por Vicente Jorquera
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
  if (normalizedClient && normalizedClient !== unclassifiedClient.toLowerCase() && normalizedClient !== "drafts") {
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
  if (!isTauriRuntime) return path;
  return convertFileSrc(path);
}

function recordingAudioPath(recording: RecordingSummary): string {
  if (recording.final_audio_path) return recording.final_audio_path;
  if (!recording.folder_path) return "";
  return `${recording.folder_path.replace(/[\\/]$/, "")}\\final\\mixed.opus`;
}

function audioFileName(path: string, displayName: string): string {
  const rawFileName = path.split(/[\\/]/).pop();
  if (rawFileName?.match(/\.(mp3|opus)$/i)) return rawFileName;

  const safeName = displayName
    .trim()
    .replace(/\.(mp3|opus)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim();

  return `${safeName || "audio"}.opus`;
}

async function requestBrowserTranscription(
  endpoint: string,
  apiKey: string,
  audioSrc: string,
  audioPath: string,
  displayName: string,
) {
  const audioResponse = await fetch(audioSrc);
  if (!audioResponse.ok) {
    throw new Error("No se pudo leer el archivo de audio local.");
  }

  const blob = await audioResponse.blob();
  const fileName = audioFileName(audioPath, displayName);
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("relative_path", "drafts");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
    body: form,
  });

  if (response.status !== 202) {
    throw new Error(await responseErrorMessage(response));
  }
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
