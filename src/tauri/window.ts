import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./commands";

const FULL_WINDOW = { width: 356, height: 556 };
const COMPACT_WINDOW = { width: 520, height: 82 };

export async function minimizeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().minimize();
}

export async function closeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().close();
}

export async function startWindowDrag() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().startDragging();
}

export async function applyWindowMode(compact: boolean) {
  if (!isTauriRuntime) return;

  const appWindow = getCurrentWindow();
  const size = compact ? COMPACT_WINDOW : FULL_WINDOW;
  await appWindow.setSize(new LogicalSize(size.width, size.height));

  if (!compact) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const scale = monitor.scaleFactor;
  const monitorX = monitor.position.x / scale;
  const monitorY = monitor.position.y / scale;
  const monitorWidth = monitor.size.width / scale;
  const x = Math.round(monitorX + (monitorWidth - size.width) / 2);
  const y = Math.round(monitorY + 18);
  await appWindow.setPosition(new LogicalPosition(x, y));
}
