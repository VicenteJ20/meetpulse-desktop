import { Loader2, LogIn, Minus, Pin, X } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import appIcon from "../assets/app-icon.png";
import { closeWindow, currentWindowLabel, minimizeWindow, setWindowAlwaysOnTop, startWindowDrag } from "../tauri/window";

export function LoginScreen() {
  const { login, loading, error } = useAuthStore();
  const isWidgetWindow = currentWindowLabel() === "widget";

  if (isWidgetWindow) {
    return <CompactLogin />;
  }

  return (
    <main className="login-screen">
      <header className="windows-titlebar" data-tauri-drag-region onPointerDown={(e) => {
        if (e.button === 0 && !((e.target as HTMLElement).closest("button"))) {
          startWindowDrag();
        }
      }}>
        <div className="window-brand" data-tauri-drag-region>
          <img className="window-icon" src={appIcon} alt="" data-tauri-drag-region />
          <span data-tauri-drag-region>Meetings Assistant</span>
        </div>
        <div className="window-actions" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => void minimizeWindow()} aria-label="Minimizar" title="Minimizar">
            <Minus />
          </button>
          <button type="button" className="close" onClick={() => void closeWindow()} aria-label="Cerrar" title="Cerrar">
            <X />
          </button>
        </div>
      </header>

      <div className="login-container">
        <div className="login-logo">
          <img src={appIcon} alt="Meetings Assistant" />
          <h1>Meetings Assistant</h1>
        </div>

        <div className="login-content">
          <p>Necesitas iniciar sesión con tu cuenta de Google para usar la aplicación.</p>

          <button type="button" className="login-button" onClick={() => void login()} disabled={loading}>
            {loading ? <Loader2 className="is-spinning" /> : <LogIn />}
            {loading ? "Conectando..." : "Iniciar sesión con Google"}
          </button>

          {error && <p className="login-error">{error}</p>}
        </div>

        <footer className="login-footer">
          <span>Vicente Jorquera © 2026</span>
        </footer>
      </div>
    </main>
  );
}

function CompactLogin() {
  const { login, loading, error } = useAuthStore();

  return (
    <main className="login-screen compact">
      <button type="button" className="compact-login-button" onClick={() => void login()} disabled={loading}>
        {loading ? <Loader2 className="is-spinning" /> : <LogIn />}
        <span>{loading ? "Conectando..." : "Iniciar sesión"}</span>
      </button>
    </main>
  );
}