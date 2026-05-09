import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "./commands";

export async function minimizeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().minimize();
}

export async function closeWindow() {
  if (!isTauriRuntime) return;
  await getCurrentWindow().close();
}
