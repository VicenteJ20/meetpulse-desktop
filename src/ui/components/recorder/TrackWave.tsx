import type { CSSProperties, ReactNode } from "react";
import { clsx } from "clsx";

export function TrackWave({
  label,
  icon,
  level,
  bars,
  active,
  color,
}: {
  label: string;
  icon: ReactNode;
  level: number;
  bars: number[];
  active: boolean;
  color: "mic" | "system";
}) {
  const hasSignal = active && level > 0.01;

  return (
    <div className={clsx("track-wave", color, hasSignal && "has-signal")} title={label} aria-label={label}>
      <div className="track-head">{icon}</div>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={`${color}-${index}`}
            className="wave-bar"
            style={
              {
                height: hasSignal ? `${Math.max(4, Math.min(100, height * 100))}%` : "3px",
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}
