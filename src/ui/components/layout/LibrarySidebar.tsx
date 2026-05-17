import { clsx } from 'clsx';
import { Archive, ArchiveRestore, ExternalLink, ListMusic, Mic, Moon, Settings, Sun, Trash2, UserRound } from 'lucide-react';
import { showWindow } from '../../../tauri/window';
import { openExternalUrl, isTauriRuntime } from '../../../tauri/commands';
import { unclassifiedClient } from '../../lib/libraryConstants';

export function LibrarySidebar({
  appIcon,
  recordingsCount,
  dashboardView,
  theme,
  clients,
  selectedClient,
  onDashboardViewChange,
  onThemeChange,
  onArchiveClient,
  onDeleteClient,
  onClientSelect,
}: {
  appIcon: string;
  recordingsCount: number;
  dashboardView: 'library' | 'archived' | 'settings';
  theme: 'light' | 'dark';
  clients: { name: string; count: number }[];
  selectedClient: string;
  onDashboardViewChange: (view: 'library' | 'archived' | 'settings') => void;
  onThemeChange: (theme: 'light' | 'dark') => void;
  onArchiveClient: (client: string) => void;
  onDeleteClient: (client: string) => void;
  onClientSelect: (client: string) => void;
}) {
  return (
    <aside className="library-sidebar">
      <div className="sidebar-brand" data-tauri-drag-region>
        <span className="brand-mark">
          <img src={appIcon} alt="" />
        </span>
        <div>
          <strong>MeetPulse</strong>
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
          className={clsx(dashboardView === 'archived' && 'is-selected')}
          onClick={() => onDashboardViewChange('archived')}
        >
          <ArchiveRestore />
          Archivados
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
              <span className="client-nav-actions">
                <strong>{client.count}</strong>
                {client.name !== unclassifiedClient && (
                  <>
                    <span
                      role="button"
                      tabIndex={0}
                      className="client-nav-action"
                      title="Archivar cliente"
                      aria-label={`Archivar ${client.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onArchiveClient(client.name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        onArchiveClient(client.name);
                      }}
                    >
                      <Archive />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="client-nav-action is-danger"
                      title="Eliminar cliente"
                      aria-label={`Eliminar ${client.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteClient(client.name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        onDeleteClient(client.name);
                      }}
                    >
                      <Trash2 />
                    </span>
                  </>
                )}
              </span>
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
