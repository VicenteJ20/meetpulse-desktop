import type { ReactNode } from "react";
import { clsx } from "clsx";

export function ControlButton({
  label,
  icon,
  className,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="control-stack">
      <span className="control-label">{label}</span>
      <button
        type="button"
        className={clsx("control-button", className)}
        disabled={disabled}
        onClick={onClick}
        title={label}
        aria-label={label}
      >
        {icon}
      </button>
    </div>
  );
}
