import type { AudioRow } from '../../lib/audioTypes';
import { clsx } from 'clsx';
import { FileAudio, ListMusic } from 'lucide-react';
import { StatusBadge } from '../library/StatusBadge';
import { formatDateTime } from '../../lib/dateFormat';
import { formatDuration } from '../../../lib/format';
import { audioDurationMs } from '../../lib/audioLibrary';

export function AudioLibraryTable({
  filteredRows,
  selectedRecordingId,
  onSelectRecording,
  audioDurationById,
}: {
  filteredRows: AudioRow[];
  selectedRecordingId: string | null;
  onSelectRecording: (row: AudioRow) => void;
  audioDurationById: Record<string, number>;
}) {
  return (
    <section className="audio-library">
      <div className="section-head">
        <div>
          <p>Audios</p>
          <h2>{filteredRows.length} resultados</h2>
        </div>
        <span><ListMusic /> Datos</span>
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
              onClick={() => onSelectRecording(row)}
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
  );
}
