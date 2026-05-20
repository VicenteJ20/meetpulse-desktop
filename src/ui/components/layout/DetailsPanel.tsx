import type { AudioRow } from '../../lib/audioTypes';
import { clsx } from 'clsx';
import { Archive, ChevronRight, Clock3, Eye, FileAudio, FileText, FolderOpen, Loader2, Save, Sparkles, Tag, Trash2, X } from 'lucide-react';
import { formatDuration } from '../../../lib/format';
import { audioDurationMs } from '../../lib/audioLibrary';

export function DetailsPanel({
  selectedRow,
  selectedCloudJob,
  saveFileName,
  saveClient,
  saveProject,
  saveNotes,
  saving,
  savedPath,
  saveError,
  analysisSubmitting,
  analysisMessage,
  analysisError,
  selectedCanRequestAnalysis,
  selectedCanRetryAnalysis,
  audioDurationById,
  onFileNameChange,
  onClientChange,
  onProjectChange,
  onNotesChange,
  onSave,
  onOpenFolder,
  onArchiveAudio,
  onDeleteAudio,
  onRequestAnalysis,
  onOpenExpanded,
  onClose,
}: {
  selectedRow: AudioRow | undefined;
  selectedCloudJob: { has_audio?: boolean; has_transcription?: boolean; has_analysis?: boolean } | undefined;
  saveFileName: string;
  saveClient: string;
  saveProject: string;
  saveNotes: string;
  saving: boolean;
  savedPath: string | null;
  saveError: string | null;
  analysisSubmitting: boolean;
  analysisMessage: string | null;
  analysisError: string | null;
  selectedCanRequestAnalysis: boolean;
  selectedCanRetryAnalysis: boolean;
  audioDurationById: Record<string, number>;
  onFileNameChange: (value: string) => void;
  onClientChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onSave: (recordingId: string, draft: boolean) => void;
  onOpenFolder: (recordingId: string) => void;
  onArchiveAudio: (row: AudioRow) => void;
  onDeleteAudio: (row: AudioRow) => void;
  onRequestAnalysis: (row: AudioRow) => void;
  onOpenExpanded: (row: AudioRow) => void;
  onClose: () => void;
}) {
  if (!selectedRow) {
    return (
      <aside className="details-panel">
        <div className="details-empty">
          <FileAudio />
          <p>Selecciona un audio para clasificarlo, guardarlo o enviarlo a drafts.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="details-panel">
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
          onClick={() => onOpenExpanded(selectedRow)}
          aria-label="Ver contenido cloud"
          title="Ver contenido cloud"
        >
          <Eye />
        </button>
        <button
          type="button"
          onClick={onClose}
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
            <input value={saveFileName} onChange={(event) => onFileNameChange(event.currentTarget.value)} placeholder={selectedRow.displayName} disabled={saving || selectedRow.source === "cloud"} />
          </label>
          <label className="field-control">
            <span>Cliente</span>
            <input value={saveClient} onChange={(event) => onClientChange(event.currentTarget.value)} placeholder="Sin cliente" disabled={saving || selectedRow.source === "cloud"} />
          </label>
          <label className="field-control">
            <span>Proyecto</span>
            <input value={saveProject} onChange={(event) => onProjectChange(event.currentTarget.value)} placeholder="Sin proyecto" disabled={saving || selectedRow.source === "cloud"} />
          </label>
          <label className="field-control">
            <span>Notas internas</span>
            <textarea value={saveNotes} onChange={(event) => onNotesChange(event.currentTarget.value)} placeholder="Notas internas" disabled={saving || selectedRow.source === "cloud"} />
          </label>
        </div>
      </div>

      <div className="details-actions">
        <button type="button" className="details-action-btn" onClick={() => onOpenFolder(selectedRow.recording.id)} disabled={saving || selectedRow.source === "cloud"}>
          <FolderOpen size={15} />
          Abrir archivo
        </button>
        <button type="button" className="details-action-btn is-primary" onClick={() => onSave(selectedRow.recording.id, false)} disabled={saving || selectedRow.source === "cloud"}>
          <Save size={15} />
          Guardar
        </button>
        <button type="button" className="details-action-btn is-success" onClick={() => onSave(selectedRow.recording.id, true)} disabled={saving || selectedRow.source === "cloud"}>
          <ChevronRight size={15} />
          Drafts
        </button>
        <button type="button" className="details-action-btn is-archive" onClick={() => onArchiveAudio(selectedRow)} disabled={saving}>
          <Archive size={15} />
          Archivar
        </button>
        <button type="button" className="details-action-btn is-danger" onClick={() => onDeleteAudio(selectedRow)} disabled={saving}>
          <Trash2 size={15} />
          Eliminar
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
          onClick={() => onRequestAnalysis(selectedRow)}
          disabled={analysisSubmitting || (!selectedCanRequestAnalysis && !selectedCanRetryAnalysis)}
          title={
            selectedCanRetryAnalysis
              ? selectedCloudJob?.has_transcription
                ? "Volver a generar el analisis desde la transcripcion guardada"
                : "Volver a procesar desde el audio guardado en cloud"
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
    </aside>
  );
}
