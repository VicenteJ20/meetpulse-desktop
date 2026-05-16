import type { PointerEvent } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Mic, Minus, MonitorSpeaker, Pause, Pin, Play, Square } from 'lucide-react';
import { SignalIcon } from '../recorder/SignalIcon';
import { MiniButton } from '../recorder/MiniButton';

export function CompactWidget({
  duration,
  isRecording,
  isPaused,
  isBusy,
  isActive,
  micLevel,
  systemLevel,
  pinned,
  onPrimary,
  onStop,
  onClose,
  onTogglePinned,
  onExpand,
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
  onPrimary: () => void;
  onStop: () => void;
  onClose: () => void;
  onTogglePinned: () => void;
  onExpand: () => void;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <section className="compact-recorder" onPointerDown={onPointerDown}>
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
          onClick={onPrimary}
        />
        <MiniButton
          label="Finalizar"
          icon={<Square />}
          disabled={isBusy || !isActive}
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
          onClick={onTogglePinned}
        />
        <MiniButton
          label="Vista completa"
          icon={<Maximize2 />}
          onClick={onExpand}
        />
      </div>
    </section>
  );
}
