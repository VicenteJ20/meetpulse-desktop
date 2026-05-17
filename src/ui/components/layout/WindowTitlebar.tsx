import type { PointerEvent } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';

export function WindowTitlebar({
  icon,
  onPointerDown,
  onMinimize,
  onMaximize,
  onClose,
}: {
  icon: string;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <header
      className="windows-titlebar"
      data-tauri-drag-region
      onPointerDown={onPointerDown}
    >
      <div className="window-brand" data-tauri-drag-region>
        <img className="window-icon" src={icon} alt="" data-tauri-drag-region />
        <span data-tauri-drag-region>MeetPulse</span>
      </div>
      <div
        className="window-actions"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <button type="button" onClick={onMinimize} aria-label="Minimizar" title="Minimizar">
          <Minus />
        </button>
        <button type="button" onClick={onMaximize} aria-label="Maximizar" title="Maximizar">
          <Maximize2 />
        </button>
        <button type="button" className="close" onClick={onClose} aria-label="Cerrar" title="Cerrar">
          <X />
        </button>
      </div>
    </header>
  );
}
