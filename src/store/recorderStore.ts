import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  getRecorderSnapshot,
  isTauriRuntime,
  listRecordings,
  pauseRecording,
  RecorderSnapshot,
  RecordingSummary,
  resumeRecording,
  startRecording,
  stopRecording,
} from "../tauri/commands";

type RecorderEvent = {
  snapshot: RecorderSnapshot;
};

type RecorderStore = {
  snapshot: RecorderSnapshot | null;
  recordings: RecordingSummary[];
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
};

async function runAction(action: () => Promise<RecorderSnapshot>, set: (state: Partial<RecorderStore>) => void) {
  set({ loading: true, error: null });
  try {
    const snapshot = await action();
    set({ snapshot, loading: false });
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error), loading: false });
  }
}

export const useRecorderStore = create<RecorderStore>((set, get) => ({
  snapshot: null,
  recordings: [],
  loading: false,
  error: null,

  async init() {
    set({ loading: true });
    try {
      const [snapshot, recordings] = await Promise.all([getRecorderSnapshot(), listRecordings()]);
      set({ snapshot, recordings, loading: false, error: null });

      if (isTauriRuntime) {
        await listen<RecorderEvent>("recorder://snapshot", (event) => {
          set({ snapshot: event.payload.snapshot });
        });

        await listen("recorder://recordings-changed", async () => {
          await get().refresh();
        });
      } else {
        window.setInterval(() => {
          void get().refresh();
        }, 1000);
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  async refresh() {
    const [snapshot, recordings] = await Promise.all([getRecorderSnapshot(), listRecordings()]);
    set({ snapshot, recordings });
  },

  start: () => runAction(startRecording, set),
  pause: () => runAction(pauseRecording, set),
  resume: () => runAction(resumeRecording, set),
  stop: () => runAction(stopRecording, set),
}));
