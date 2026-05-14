import { create } from "zustand";
import { AuthState, getAuthState, logoutAuth, startGoogleAuth } from "../tauri/commands";

type AuthStore = {
  authState: AuthState | null;
  loading: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthStore>((set) => ({
  authState: null,
  loading: false,
  error: null,

  async init() {
    set({ loading: true });
    try {
      const authState = await getAuthState();
      set({ authState, loading: false, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  async login() {
    set({ loading: true, error: null });
    try {
      const authState = await startGoogleAuth();
      set({ authState, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  async logout() {
    set({ loading: true, error: null });
    try {
      await logoutAuth();
      set({ authState: { is_authenticated: false, email: null }, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },
}));