import type { PointerEvent } from 'react';
import { clsx } from 'clsx';
import { Mic, Minus, MonitorSpeaker, Pause, Pin, Play, Square } from 'lucide-react';
import { SignalIcon } from '../recorder/SignalIcon';
import { MiniButton } from '../recorder/MiniButton';
import type { AppTheme } from '../../lib/audioTypes';

export function CompactWidget({
  duration,
  isRecording,
  isPaused,
  isBusy,
  isActive,
  micLevel,
  systemLevel,
  pinned,
  theme,
  appIcon,
  onPrimary,
  onStop,
  onClose,
  onTogglePinned,
  onPointerDown,
}: {
  duration: string;
  isRecording: boolean;
  isPaused: boolean;
  isBusy: boolean;
  isActive: boolean;
  micLevel: number;
  systemLevel: number;
  pinned: boolean;
  theme: AppTheme;
  appIcon: string;
  onPrimary: () => void;
  onStop: () => void;
  onClose: () => void;
  onTogglePinned: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className={clsx("compact-recorder", theme)} onPointerDown={onPointerDown}>
      <div className="compact-identity">
        <img src={appIcon} alt="App" className="compact-app-icon" />
        <div className="compact-status">
          <SignalIcon icon={<Mic />} active={isRecording && micLevel > 0.01} color="mic" label="Microfono" />
          <SignalIcon icon={<MonitorSpeaker />} active={isRecording && systemLevel > 0.01} color="system" label="Equipo" />
        </div>
      </div>
      <span className="compact-time">{duration}</span>
      <div className="compact-controls">
        <MiniButton
          label={isPaused ? "Reanudar" : isRecording ? "Pausar" : "Grabar"}
          icon={isRecording ? <Pause /> : <Play />}
          disabled={isBusy}
          active={isRecording}
          variant="primary"
          onClick={onPrimary}
        />
        <MiniButton
          label="Finalizar"
          icon={<Square />}
          disabled={isBusy || !isActive}
          active={isActive}
          variant="danger"
          onClick={onStop}
        />
        <MiniButton
          label="Ocultar widget"
          icon={<Minus />}
          onClick={onClose}
        />
        <MiniButton
          label={pinned ? "Desfijar widget" : "Fijar widget"}
          icon={<Pin />}
          active={pinned}
          variant="pin"
          onClick={onTogglePinned}
        />
      </div>
    </section>
  );
}
