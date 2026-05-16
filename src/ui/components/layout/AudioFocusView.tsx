import type { AudioRow } from '../../lib/audioTypes';
import type { MarkdownBlockData } from '../markdown/MarkdownBlock';
import { clsx } from 'clsx';
import { CheckCircle2, ChevronRight, Copy, FileText, Loader2, Sparkles } from 'lucide-react';
import { formatDuration } from '../../../lib/format';
import { formatDateTime } from '../../lib/dateFormat';
import { audioDurationMs } from '../../lib/audioLibrary';
import { MarkdownBlock } from '../markdown/MarkdownBlock';

export function AudioFocusView({
  selectedRow,
  selectedCloudJob,
  artifactTab,
  artifactCopyFormat,
  artifactCopyState,
  artifactLoading,
  cloudSyncing,
  artifactError,
  cloudSyncError,
  selectedArtifactBlocks,
  selectedArtifactContent,
  audioDurationById,
  onBack,
  onTabChange,
  onCopyFormatChange,
  onCopy,
}: {
  selectedRow: AudioRow;
  selectedCloudJob: { has_transcription?: boolean; has_analysis?: boolean } | undefined;
  artifactTab: 'transcription' | 'analysis';
  artifactCopyFormat: 'plain' | 'markdown';
  artifactCopyState: 'idle' | 'copied' | 'error';
  artifactLoading: boolean;
  cloudSyncing: boolean;
  artifactError: string | null;
  cloudSyncError: string | null;
  selectedArtifactBlocks: MarkdownBlockData[];
  selectedArtifactContent: string | null | undefined;
  audioDurationById: Record<string, number>;
  onBack: () => void;
  onTabChange: (tab: 'transcription' | 'analysis') => void;
  onCopyFormatChange: (format: 'plain' | 'markdown') => void;
  onCopy: () => void;
}) {
  return (
    <section className="audio-focus">
      <div className="audio-focus-bar">
        <button
          type="button"
          className="audio-focus-back"
          onClick={onBack}
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

        <div className="audio-focus-tabs" role="tablist" aria-label="Contenido del job">
          <button
            type="button"
            className={clsx(artifactTab === "transcription" && "is-active", !selectedCloudJob?.has_transcription && "is-unavailable")}
            onClick={() => onTabChange("transcription")}
            aria-selected={artifactTab === "transcription"}
          >
            <FileText size={13} />
            Transcripcion
          </button>
          <button
            type="button"
            className={clsx(artifactTab === "analysis" && "is-active", !selectedCloudJob?.has_analysis && "is-unavailable")}
            onClick={() => onTabChange("analysis")}
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
              onClick={() => onCopyFormatChange("plain")}
            >
              Texto
            </button>
            <button
              type="button"
              className={clsx(artifactCopyFormat === "markdown" && "is-active")}
              onClick={() => onCopyFormatChange("markdown")}
            >
              Markdown
            </button>
          </div>
          <button
            type="button"
            className={clsx("audio-focus-copy", artifactCopyState === "copied" && "is-copied", artifactCopyState === "error" && "is-error")}
            onClick={onCopy}
            disabled={!selectedArtifactContent?.trim()}
            title={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"} como ${artifactCopyFormat === "markdown" ? "Markdown" : "texto"}`}
            aria-label={`Copiar ${artifactTab === "analysis" ? "analisis" : "transcripcion"} como ${artifactCopyFormat === "markdown" ? "Markdown" : "texto"}`}
          >
            {artifactCopyState === "copied" ? <CheckCircle2 size={15} /> : <Copy size={15} />}
          </button>
        </div>
      </div>

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
  );
}
