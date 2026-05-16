import type { ReactNode } from "react";
import type { AudioDevice } from "../../../tauri/commands";

export function DeviceSelect({
  label,
  icon,
  devices,
  value,
  disabled,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  devices: AudioDevice[];
  value: string;
  disabled: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="device-select">
      <span>
        {icon}
        {label}
      </span>
      <select
        value={value}
        disabled={disabled || devices.length === 0}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {devices.length === 0 ? (
          <option value="">No disponible</option>
        ) : (
          devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
              {device.is_default ? " (default)" : ""}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
