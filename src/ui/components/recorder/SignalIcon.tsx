import type { ReactNode } from "react";
import { clsx } from "clsx";

export function SignalIcon({
  icon,
  active,
  color,
  label,
}: {
  icon: ReactNode;
  active: boolean;
  color: "mic" | "system";
  label: string;
}) {
  return (
    <span className={clsx("signal-icon", color, active && "is-active")} title={label} aria-label={label}>
      {icon}
    </span>
  );
}
