import { clsx } from 'clsx';
import { History, Loader2, Settings, UserRound, X } from 'lucide-react';
import { formatDateTime } from '../../lib/dateFormat';

export function SettingsPanel({
  cloudSyncedAt,
  cloudSyncing,
  cloudClientsCount,
  cloudProjectsCount,
  cloudJobsCount,
  authState,
  onSync,
  onLogin,
  onLogout,
  authLoading,
  message,
  error,
}: {
  cloudSyncedAt: string | null;
  cloudSyncing: boolean;
  cloudClientsCount: number;
  cloudProjectsCount: number;
  cloudJobsCount: number;
  authState: { is_authenticated: boolean; email?: string | null } | null;
  onSync: () => void;
  onLogin: () => void;
  onLogout: () => void;
  authLoading: boolean;
  message: string | null;
  error: string | null;
}) {
  return (
    <section className="settings-panel">
      <div className="section-head">
        <div>
          <p>Sincronizacion de servicios</p>
          <h2>Servicios Cloud</h2>
        </div>
        <span><Settings /> Sistema</span>
      </div>

      <div className="settings-form">
        <div className="cloud-sync-panel">
          <div className="cloud-sync-head">
            <div>
              <span>Sincronizacion nube</span>
              <strong>{cloudSyncedAt ? formatDateTime(cloudSyncedAt) : "Sin sincronizar"}</strong>
            </div>
            <button type="button" onClick={onSync} disabled={cloudSyncing}>
              {cloudSyncing ? <Loader2 className="is-spinning" /> : <History />}
              {cloudSyncing ? "Sincronizando" : "Sincronizar"}
            </button>
          </div>
          <div className="cloud-sync-counts">
            <span><strong>{cloudClientsCount}</strong> clientes</span>
            <span><strong>{cloudProjectsCount}</strong> proyectos</span>
            <span><strong>{cloudJobsCount}</strong> jobs</span>
          </div>
        </div>
        <div className="google-auth-panel">
          <div className="google-auth-head">
            <div>
              <span>Autenticacion Google</span>
              <strong>{authState?.is_authenticated ? authState.email ?? "Conectado" : "No conectado"}</strong>
            </div>
            {authState?.is_authenticated ? (
              <button type="button" onClick={onLogout} disabled={authLoading}>
                {authLoading ? <Loader2 className="is-spinning" /> : <X />}
                {authLoading ? "Cerrando" : "Desconectar"}
              </button>
            ) : (
              <button type="button" onClick={onLogin} disabled={authLoading}>
                {authLoading ? <Loader2 className="is-spinning" /> : <UserRound />}
                {authLoading ? "Conectando" : "Iniciar sesion con Google"}
              </button>
            )}
          </div>
        </div>
        {(message || error) && (
          <p className={clsx("save-message details-save-message", error && "is-error")}>
            {error ?? message}
          </p>
        )}
      </div>
    </section>
  );
}
