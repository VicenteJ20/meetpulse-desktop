import type { ReactNode } from "react";
import { clsx } from "clsx";

export function MiniButton({
  label,
  icon,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx("mini-button", active && "is-active")}
      disabled={disabled}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
