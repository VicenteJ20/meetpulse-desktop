import type { AudioRow } from '../../lib/audioTypes';
import { clsx } from 'clsx';
import { Disc3, Pause, Play, Square } from 'lucide-react';
import { formatDuration } from '../../../lib/format';

export function PlayerBar({
  activeRow,
  activeAudioSrc,
  playbackAudioSrc,
  playerCurrentMs,
  playerDurationMs,
  visiblePlayerDuration,
  playerPlaying,
  playerLoading,
  playerError,
  audioRef,
  onPlay,
  onPause,
  onStop,
  onTimeChange,
  onLoadedMetadata,
  onTimeUpdate,
  activeRowDurationUpdate,
}: {
  activeRow: AudioRow | undefined;
  activeAudioSrc: string;
  playbackAudioSrc: string;
  playerCurrentMs: number;
  playerDurationMs: number;
  visiblePlayerDuration: number;
  playerPlaying: boolean;
  playerLoading: boolean;
  playerError: string | null;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onTimeChange: (ms: number) => void;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLAudioElement>) => void;
  onTimeUpdate: (event: React.SyntheticEvent<HTMLAudioElement>) => void;
  activeRowDurationUpdate: (id: string, durationMs: number) => void;
}) {
  return (
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
          <button type="button" onClick={onPlay} disabled={!playbackAudioSrc || playerLoading || playerPlaying} aria-label="Reproducir" title="Reproducir">
            <Play />
          </button>
          <button type="button" onClick={onPause} disabled={!playbackAudioSrc || !playerPlaying} aria-label="Pausar" title="Pausar">
            <Pause />
          </button>
          <button type="button" onClick={onStop} disabled={!playbackAudioSrc} aria-label="Detener" title="Detener">
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
                onTimeChange(nextMs);
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
              onLoadedMetadata(event);
              if (activeRow && nextDurationMs > 0) {
                activeRowDurationUpdate(activeRow.recording.id, nextDurationMs);
              }
            }}
            onTimeUpdate={onTimeUpdate}
            onPause={() => onPause()}
            onPlay={() => onPlay()}
            onEnded={onStop}
            onError={() => {
              onPause();
            }}
          />
          {(playerLoading || playerError) && <span className="player-error">{playerLoading ? "Preparando audio..." : playerError}</span>}
        </div>
      ) : (
        <div className="player-placeholder">Audio no disponible</div>
      )}
    </div>
  );
}
