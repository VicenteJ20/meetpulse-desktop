import { clsx } from 'clsx';
import { ExternalLink, ListMusic, Mic, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { showWindow } from '../../../tauri/window';
import { openExternalUrl, isTauriRuntime } from '../../../tauri/commands';

export function LibrarySidebar({
  appIcon,
  recordingsCount,
  dashboardView,
  theme,
  clients,
  selectedClient,
  onDashboardViewChange,
  onThemeChange,
  onClientSelect,
}: {
  appIcon: string;
  recordingsCount: number;
  dashboardView: 'library' | 'settings';
  theme: 'light' | 'dark';
  clients: { name: string; count: number }[];
  selectedClient: string;
  onDashboardViewChange: (view: 'library' | 'settings') => void;
  onThemeChange: (theme: 'light' | 'dark') => void;
  onClientSelect: (client: string) => void;
}) {
  return (
    <aside className="library-sidebar">
      <div className="sidebar-brand" data-tauri-drag-region>
        <span className="brand-mark">
          <img src={appIcon} alt="" />
        </span>
        <div>
          <strong>Meeting Assistant</strong>
          <span>{recordingsCount} audios</span>
        </div>
      </div>

      <div className="quick-recorder">
        <button
          type="button"
          className="recorder-launcher"
          onClick={() => {
            if (isTauriRuntime) {
              void showWindow('widget');
            }
          }}
        >
          <Mic />
          <span>Iniciar grabacion</span>
        </button>
      </div>

      <nav className="workspace-nav" aria-label="Secciones">
        <button
          type="button"
          className={clsx(dashboardView === 'library' && 'is-selected')}
          onClick={() => onDashboardViewChange('library')}
        >
          <ListMusic />
          Biblioteca
        </button>
        <button
          type="button"
          className={clsx(dashboardView === 'settings' && 'is-selected')}
          onClick={() => onDashboardViewChange('settings')}
        >
          <Settings />
          Configuracion
        </button>
      </nav>

      <div className="theme-switcher" aria-label="Tema">
        <button
          type="button"
          className={clsx(theme === 'light' && 'is-selected')}
          onClick={() => onThemeChange('light')}
          aria-pressed={theme === 'light'}
          title="Usar tema claro"
        >
          <Sun />
          Claro
        </button>
        <button
          type="button"
          className={clsx(theme === 'dark' && 'is-selected')}
          onClick={() => onThemeChange('dark')}
          aria-pressed={theme === 'dark'}
          title="Usar tema oscuro"
        >
          <Moon />
          Oscuro
        </button>
      </div>

      {dashboardView === 'library' && (
        <nav className="client-nav" aria-label="Clientes">
          <div className="nav-heading">
            <UserRound />
            <span>Clientes</span>
          </div>
          {clients.map((client) => (
            <button
              key={client.name}
              type="button"
              className={clsx('client-nav-item', selectedClient === client.name && 'is-selected')}
              onClick={() => onClientSelect(client.name)}
            >
              <span>{client.name}</span>
              <strong>{client.count}</strong>
            </button>
          ))}
        </nav>
      )}

      <a
        className="developer-link"
        href="https://vicentejorquera.dev"
        target="_blank"
        rel="noreferrer"
        title="vicentejorquera.dev"
        onClick={(event) => {
          event.preventDefault();
          void openExternalUrl('https://vicentejorquera.dev');
        }}
      >
        Vicente Jorquera
        <ExternalLink />
      </a>
    </aside>
  );
}
