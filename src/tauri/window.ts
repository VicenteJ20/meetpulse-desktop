import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Window, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./commands";

const FULL_WINDOW = { width: 1120, height: 720 };
const FULL_WINDOW_MIN = { width: 920, height: 620 };
const COMPACT_WINDOW = { width: 430, height: 56 };

export async function minimizeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().minimize();
}

export async function toggleWindowMaximize() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().toggleMaximize();
}

export async function closeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().hide();
}

export async function startWindowDrag() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().startDragging();
}

export async function setWindowAlwaysOnTop(pinned: boolean) {
  if (!isTauriRuntime) return;
  await getCurrentWindow().setAlwaysOnTop(pinned);
}

export function currentWindowLabel(): string {
  if (!isTauriRuntime) return "main";
  return getCurrentWindow().label;
}

export async function showWindow(label: "main" | "widget") {
  if (!isTauriRuntime) return;
  const appWindow = await Window.getByLabel(label);
  if (!appWindow) return;
  await appWindow.show();
  await appWindow.setFocus();
}

export async function applyWindowMode(compact: boolean) {
  if (!isTauriRuntime) return;

  const appWindow = getCurrentWindow();
  const size = compact ? COMPACT_WINDOW : FULL_WINDOW;
  await appWindow.setResizable(!compact);
  await appWindow.setMinSize(
    compact
      ? new LogicalSize(COMPACT_WINDOW.width, COMPACT_WINDOW.height)
      : new LogicalSize(FULL_WINDOW_MIN.width, FULL_WINDOW_MIN.height),
  );
  await appWindow.setSize(new LogicalSize(size.width, size.height));

  if (!compact) return;

  const monitor = await currentMonitor();
  if (!monitor) return;

  const scale = monitor.scaleFactor;
  const monitorX = monitor.position.x / scale;
  const monitorY = monitor.position.y / scale;
  const monitorWidth = monitor.size.width / scale;
  const monitorHeight = monitor.size.height / scale;
  const x = Math.round(monitorX + monitorWidth - size.width - 18);
  const y = Math.round(monitorY + monitorHeight - size.height - 78);
  await appWindow.setPosition(new LogicalPosition(x, y));
}
