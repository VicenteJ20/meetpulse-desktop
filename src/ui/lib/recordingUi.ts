const bars = [
  0.52, 0.7, 0.38, 0.78, 0.66, 0.46, 0.3, 0.58, 0.24, 0.51, 0.72, 0.37, 0.44, 0.64, 0.29, 0.53, 0.4, 0.62,
  0.35, 0.75, 0.28, 0.45, 0.59, 0.33, 0.49, 0.71, 0.39, 0.56, 0.48, 0.8, 0.34, 0.61, 0.4, 0.68, 0.3, 0.54,
  0.44, 0.76, 0.36, 0.58,
];

export function createMeterBars(level: number): number[] {
  if (level < 0.01) {
    return Array.from({ length: bars.length }, () => 0.04);
  }

  const energy = Math.min(1, level * 2.2);
  return bars.map((bar, index) => {
    const movement = 0.82 + Math.sin(Date.now() / 260 + index * 0.72) * 0.12;
    return Math.min(1, Math.max(0.08, bar * energy * movement));
  });
}

export function formatWidgetDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}h:${minutes.toString().padStart(2, "0")}m:${seconds
    .toString()
    .padStart(2, "0")}s`;
}

export function statusTitle(status: string): string {
  if (status === "paused") return "Pausado";
  if (status === "stopping") return "Finalizando";
  if (status === "completed") return "Listo";
  if (status === "error") return "Error";
  if (status === "recording") return "Grabando";
  if (status === "starting") return "Preparando";
  return "Meetings Assistant";
}

export function statusSubtitle(status: string): string {
  if (status === "paused") return "Sesion en espera";
  if (status === "completed") return "Audio local disponible";
  if (status === "recording") return "Captura local";
  if (status === "starting") return "Preparando audio";
  if (status === "stopping") return "Cerrando archivos";
  return "Grabador de audio";
}
