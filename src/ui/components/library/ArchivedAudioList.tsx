import { ArchiveRestore, FileAudio, Loader2 } from "lucide-react";
import type { AudioRow } from "../../lib/audioTypes";
import { audioDurationMs } from "../../lib/audioLibrary";
import { formatDateTime } from "../../lib/dateFormat";
import { formatDuration } from "../../../lib/format";
import { StatusBadge } from "./StatusBadge";

export function ArchivedAudioList({
  rows,
  loading,
  error,
  restoringId,
  audioDurationById,
  onRestore,
}: {
  rows: AudioRow[];
  loading: boolean;
  error: string | null;
  restoringId: string | null;
  audioDurationById: Record<string, number>;
  onRestore: (row: AudioRow) => void;
}) {
  return (
    <section className="audio-library archived-library">
      <div className="section-head">
        <div>
          <p>Archivados</p>
          <h2>{rows.length} audios</h2>
        </div>
        <span>
          {loading ? <Loader2 className="is-spinning" /> : <ArchiveRestore />}
          Archivo
        </span>
      </div>

      {error && <p className="inline-error archived-error">{error}</p>}

      <div className="audio-table" role="list">
        {rows.length === 0 ? (
          <div className="empty-state">
            <ArchiveRestore />
            <p>No hay audios archivados.</p>
          </div>
        ) : (
          rows.map((row) => (
            <div key={row.recording.id} className="audio-row archived-row" role="listitem">
              <span className="audio-index">
                <FileAudio />
              </span>
              <span className="audio-title">
                <strong>{row.displayName}</strong>
                <small>{formatDateTime(row.recording.started_at)}</small>
              </span>
              <span className="audio-client">{row.client}</span>
              <span className="audio-project">{row.project}</span>
              <span className="audio-duration">{formatDuration(audioDurationMs(row, audioDurationById))}</span>
              <StatusBadge state={row.status} />
              <button
                type="button"
                className="archived-restore"
                disabled={restoringId === row.recording.id}
                onClick={() => onRestore(row)}
              >
                {restoringId === row.recording.id ? <Loader2 className="is-spinning" /> : <ArchiveRestore />}
                <span>Quitar del archivo</span>
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
