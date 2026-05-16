import type { AudioDevice, RecordingSummary } from '../../../tauri/commands';
import { clsx } from 'clsx';
import { ExternalLink, FolderOpen, History, Mic, MonitorSpeaker, Pause, Play, Save, Square, X } from 'lucide-react';
import { formatDuration } from '../../../lib/format';
import { displayRecordingName } from '../../lib/audioLibrary';
import { ControlButton } from './ControlButton';
import { DeviceSelect } from './DeviceSelect';
import { TrackWave } from './TrackWave';
import { openExternalUrl, openRecordingFolder, isTauriRuntime } from '../../../tauri/commands';

export function LegacyRecorder({
  status,
  statusTitle,
  statusSubtitle,
  compactMode,
  visibleRecordingName,
  inputDevices,
  outputDevices,
  selectedInputId,
  selectedOutputId,
  duration,
  micLevel,
  systemLevel,
  visibleMicBars,
  visibleSystemBars,
  isRecording,
  isActive,
  isBusy,
  isPaused,
  recordings,
  selectedRecordingId,
  selectedRecording,
  saving,
  saveClient,
  saveProject,
  saveFileName,
  savedPath,
  saveError,
  onToggleCompactMode,
  onDeviceChange,
  onStop,
  onPrimary,
  onToggleHistory,
  onSelectRecording,
  onSave,
  onCloseOrganize,
  onClientChange,
  onProjectChange,
  onFileNameChange,
}: {
  status: string;
  statusTitle: (status: string) => string;
  statusSubtitle: (status: string) => string;
  compactMode: boolean;
  visibleRecordingName: string;
  inputDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  selectedInputId: string;
  selectedOutputId: string;
  duration: string;
  micLevel: number;
  systemLevel: number;
  visibleMicBars: number[];
  visibleSystemBars: number[];
  isRecording: boolean;
  isActive: boolean;
  isBusy: boolean;
  isPaused: boolean;
  recordings: RecordingSummary[];
  selectedRecordingId: string | null;
  selectedRecording: RecordingSummary;
  saving: boolean;
  saveClient: string;
  saveProject: string;
  saveFileName: string;
  savedPath: string | null;
  saveError: string | null;
  onToggleCompactMode: (value: boolean) => void;
  onDeviceChange: (kind: 'input' | 'output', deviceId: string) => void;
  onStop: () => void;
  onPrimary: () => void;
  onToggleHistory: () => void;
  onSelectRecording: (recording: RecordingSummary) => void;
  onSave: (recordingId: string, draft: boolean) => void;
  onCloseOrganize: () => void;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
}) {
  return (
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
            onChange={(event) => onToggleCompactMode(event.currentTarget.checked)}
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
          onChange={(deviceId) => onDeviceChange("input", deviceId)}
        />
        <DeviceSelect
          label="Audio PC"
          icon={<MonitorSpeaker />}
          devices={outputDevices}
          value={selectedOutputId}
          disabled={isActive}
          onChange={(deviceId) => onDeviceChange("output", deviceId)}
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
          onClick={onStop}
        />
        <ControlButton
          label={isPaused ? "REANUDAR" : isRecording ? "PAUSAR" : "GRABAR"}
          className="primary"
          icon={isRecording ? <Pause /> : <Play />}
          disabled={isBusy}
          onClick={onPrimary}
        />
        <ControlButton
          label="FINALIZAR"
          className="finish"
          icon={<Square />}
          disabled={isBusy || !isActive}
          onClick={onStop}
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
          onClick={onToggleHistory}
          title="Historial"
          aria-label="Historial"
        >
          <History />
        </button>
      </footer>
    </section>
  );
}

export function LegacyHistoryPanel({
  recordings,
  selectedRecordingId,
  selectedRecording,
  saving,
  saveClient,
  saveProject,
  saveFileName,
  savedPath,
  saveError,
  onSelectRecording,
  onSave,
  onClose,
  onClientChange,
  onProjectChange,
  onFileNameChange,
}: {
  recordings: RecordingSummary[];
  selectedRecordingId: string | null;
  selectedRecording: RecordingSummary;
  saving: boolean;
  saveClient: string;
  saveProject: string;
  saveFileName: string;
  savedPath: string | null;
  saveError: string | null;
  onSelectRecording: (recording: RecordingSummary) => void;
  onSave: (recordingId: string, draft: boolean) => void;
  onClose: () => void;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onFileNameChange: (value: string) => void;
}) {
  return (
    <section className="history-panel">
      <div className="history-header">
        <span>Historial</span>
        <button type="button" onClick={onClose} aria-label="Cerrar historial">
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
              onClick={() => onSelectRecording(recording)}
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
            <button type="button" onClick={onClose} aria-label="Cerrar organizador">
              <X />
            </button>
          </div>
          <div className="save-fields">
            <input
              value={saveClient}
              onChange={(event) => onClientChange(event.currentTarget.value)}
              placeholder="Cliente"
              disabled={saving}
            />
            <input
              value={saveProject}
              onChange={(event) => onProjectChange(event.currentTarget.value)}
              placeholder="Proyecto"
              disabled={saving}
            />
            <input
              value={saveFileName}
              onChange={(event) => onFileNameChange(event.currentTarget.value)}
              placeholder={displayRecordingName(selectedRecording)}
              disabled={saving}
            />
          </div>
          <div className="organize-actions">
            <button type="button" onClick={() => openRecordingFolder(selectedRecording.id)} disabled={saving}>
              <FolderOpen />
              Abrir
            </button>
            <button type="button" onClick={() => onSave(selectedRecording.id, false)} disabled={saving}>
              <Save />
              Guardar organizado
            </button>
          </div>
          {(savedPath || saveError) && <p className={clsx("save-message", saveError && "is-error")}>{saveError ?? savedPath}</p>}
        </div>
      )}
    </section>
  );
}
