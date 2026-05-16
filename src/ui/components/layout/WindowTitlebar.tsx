import type { PointerEvent } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Minus, Pin, X } from 'lucide-react';

export function WindowTitlebar({
  icon,
  pinned,
  onPointerDown,
  onTogglePinned,
  onMinimize,
  onMaximize,
  onClose,
}: {
  icon: string;
  pinned: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onTogglePinned: () => void;
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
        <span data-tauri-drag-region>Meetings Assistant</span>
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
        <button
          type="button"
          className={clsx(pinned && "is-active")}
          onClick={onTogglePinned}
          aria-label={pinned ? "Quitar siempre encima" : "Mantener encima"}
          title={pinned ? "Quitar siempre encima" : "Mantener encima"}
        >
          <Pin />
        </button>
        <button type="button" className="close" onClick={onClose} aria-label="Cerrar" title="Cerrar">
          <X />
        </button>
      </div>
    </header>
  );
}
