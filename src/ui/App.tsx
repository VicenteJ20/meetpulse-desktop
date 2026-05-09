import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { ExternalLink, History, Maximize2, Mic, Minus, MonitorSpeaker, Pause, Play, Square, X } from "lucide-react";
import { clsx } from "clsx";
import { formatDuration } from "../lib/format";
import { openExternalUrl, openRecordingFolder } from "../tauri/commands";
import { closeWindow, minimizeWindow, startWindowDrag } from "../tauri/window";
import { useRecorderStore } from "../store/recorderStore";

const bars = [
  0.52, 0.7, 0.38, 0.78, 0.66, 0.46, 0.3, 0.58, 0.24, 0.51, 0.72, 0.37, 0.44, 0.64, 0.29, 0.53, 0.4, 0.62,
  0.35, 0.75, 0.28, 0.45, 0.59, 0.33, 0.49, 0.71, 0.39, 0.56, 0.48, 0.8, 0.34, 0.61, 0.4, 0.68, 0.3, 0.54,
  0.44, 0.76, 0.36, 0.58,
];

export function App() {
  const { snapshot, recordings, loading, error, init, refresh, start, pause, resume, stop } = useRecorderStore();
  const [now, setNow] = useState(() => Date.now());
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = snapshot?.status ?? "idle";
  const durationMs = useLiveDuration(snapshot, now);
  const duration = formatWidgetDuration(durationMs);
  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isBusy = loading || status === "starting" || status === "stopping";
  const isActive = isRecording || isPaused || status === "starting" || status === "stopping";
  const micLevel = snapshot?.mic.status === "recording" ? (snapshot?.mic.rms ?? 0) : 0;
  const systemLevel = snapshot?.system.status === "recording" ? (snapshot?.system.rms ?? 0) : 0;
  const visibleMicBars = createMeterBars(micLevel);
  const visibleSystemBars = createMeterBars(systemLevel);
  const currentRecordingName = snapshot?.recording_id ? snapshot.recording_id.replace("rec_", "") : "sin archivo";

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
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    void startWindowDrag();
  }

  return (
    <main className="widget-shell">
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
          <button type="button" className="close" onClick={() => void closeWindow()} aria-label="Cerrar" title="Cerrar">
            <X />
          </button>
        </div>
      </header>
      <section className="compact-recorder" data-tauri-drag-region>
        <div className={clsx("compact-dot", isRecording && "is-live", isPaused && "is-paused")} />
        <span className="compact-time">{duration}</span>
      </section>

      <section className="recorder-card">
        <header className="recorder-header" data-tauri-drag-region>
          <div data-tauri-drag-region>
            <p className="recording-title">{statusTitle(status)}</p>
            <p className="recording-subtitle">{statusSubtitle(status)}</p>
          </div>
        </header>

        <div className="recording-file" title={currentRecordingName} data-tauri-drag-region>
          {currentRecordingName}
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
                    className="history-item"
                    onClick={() => void openRecordingFolder(recording.id)}
                  >
                    <span className="history-name">{recording.id.replace("rec_", "")}</span>
                    <span className="history-meta">
                      {formatDuration(recording.duration_ms)} · {recording.status}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {(error || snapshot?.last_error) && <div className="widget-error">{error ?? snapshot?.last_error}</div>}
      </section>
    </main>
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
