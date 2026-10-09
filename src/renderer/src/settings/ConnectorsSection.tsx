import { useMemo, useState } from 'react';
import type { MCPServerConfig } from '../../../shared/types';
import {
  CATEGORY_LABELS,
  CONNECTORS,
  type ConnectorCategory,
  type ConnectorEntry
} from '../../../shared/connectors';
import { COWORKERS } from '../../../shared/coworkers';
import { useApp } from '../state';
import { Button, EmptyState, IconPlug, IconPlus, Modal } from '../ui';
import { SettingsGroup } from './controls';
import { ServiceIcon } from './ServiceIcon';
import { connectorLogo } from './connectorLogos';
import './connectors.css';
import { plural } from '../format';

export const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);

/** A connector's mark: its own logo on a white tile, else (custom connectors) a brand glyph or its initial. */
export function ConnectorMark({
  name,
  catalogId,
  size = 16
}: {
  name: string;
  catalogId?: string;
  size?: number;
}) {
  const logo = connectorLogo(catalogId);
  if (logo)
    return (
      <span
        className="connector-mark connector-logo"
        aria-hidden="true"
        style={{ width: size + 12, height: size + 12 }}
      >
        <img src={logo} alt="" width={size} height={size} />
      </span>
    );
  return (
    <span className="connector-mark" aria-hidden="true" style={{ width: size + 12, height: size + 12 }}>
      <ServiceIcon
        name={name}
        size={size}
        fallback={
          <span className="connector-initial" style={{ fontSize: Math.round(size * 0.8) }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        }
      />
    </span>
  );
}

/** "Connected · 12 tools", "Needs sign-in", "Error: …": the same words as the legend above the list. */
export function statusText(server: MCPServerConfig): string {
  if (!server.enabled) return 'Off';
  switch (server.status) {
    case 'connected':
      return `Connected · ${plural(server.tools?.length ?? 0, 'tool')}`;
    case 'connecting':
      return 'Connecting…';
    case 'needs-sign-in':
      return 'Needs sign-in';
    case 'error':
      return `Error${server.error ? `: ${server.error}` : ''}`;
    default:
      return 'Not connected';
  }
}
const statusTone = (server: MCPServerConfig) =>
  !server.enabled
    ? ''
    : server.status === 'connected'
      ? 'badge-accent'
      : server.status === 'error'
        ? 'badge-danger'
        : server.status === 'needs-sign-in'
          ? 'badge-warning'
          : '';

/** "Designer, Chief of Staff +12": who a connector serves. */
export function usedBy(assignees: readonly string[] = []): string {
  const names = assignees
    .filter((a) => !a.startsWith('not:'))
    .map((a) =>
      a === 'chats'
        ? 'Your chats'
        : a.startsWith('group:')
          ? a.slice(6)
          : (COWORKERS.find((c) => c.id === a)?.name ?? a)
    );
  if (!names.length) return 'Nobody yet';
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** Whether connecting opens the browser (the card then waits for it). */
const opensBrowser = (entry: ConnectorEntry, apps: readonly string[]) =>
  entry.auth === 'oauth' ||
  entry.auth === 'oauth-app' ||
  (entry.auth === 'github-account' && apps.includes(entry.id));

/** Settings → Connectors: what's connected, and a catalog to add from. */
export function ConnectorsSection({
  onCustom,
  onManage
}: {
  onCustom: () => void;
  onManage: (id: string) => void;
}) {
  const servers = useApp((s) => s.data!.mcpServers ?? []);
  const apps = useApp((s) => s.data!.connectorApps ?? []);
  const pushToast = useApp((s) => s.pushToast);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all');
  const [waiting, setWaiting] = useState<string | null>(null);
  const [ownApp, setOwnApp] = useState<ConnectorEntry | null>(null);
  const [error, setError] = useState('');

  const shown = useMemo(() => {
    const added = new Set(servers.map((s) => s.catalogId).filter(Boolean));
    const q = query.trim().toLowerCase();
    return CONNECTORS.filter(
      (entry) =>
        !added.has(entry.id) &&
        (category === 'all' || entry.category === category) &&
        (!q || `${entry.name} ${entry.description}`.toLowerCase().includes(q))
    );
  }, [servers, query, category]);

  const connect = async (entry: ConnectorEntry) => {
    if (
      entry.command &&
      !confirm(
        `${entry.name} runs on this PC with:\n\n${[entry.command, ...(entry.args ?? [])].join(' ')}\n\nThe first start downloads the package, which can take a minute. Continue?`
      )
    )
      return;
    setError('');
    setWaiting(entry.id);
    try {
      await window.axon.connectorAdd(entry.id);
      await useApp.getState().refresh();
      const server = useApp.getState().data?.mcpServers.find((s) => s.catalogId === entry.id);
      if (server?.status === 'connected')
        pushToast(`${entry.name} connected · ${plural(server.tools?.length ?? 0, 'tool')}`);
      else if (server) pushToast(`${entry.name}: ${statusText(server)}`, 'error');
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setWaiting(null);
    }
  };

  /** Sign in again, or try a connector that couldn't connect, straight from its row. */
  const fix = async (server: MCPServerConfig) => {
    setError('');
    setWaiting(server.id);
    try {
      await window.axon.connectorReconnect(server.id);
      await useApp.getState().refresh();
      const now = useApp.getState().data?.mcpServers.find((s) => s.id === server.id);
      if (now?.status === 'connected') pushToast(`${server.name} connected · ${plural(now.tools?.length ?? 0, 'tool')}`);
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setWaiting(null);
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Connectors</h3>
          <p>
            Connect your services and your coworkers can use them. Looking things up runs on its own; anything
            that changes something asks you first.
          </p>
        </div>
        <Button icon={IconPlus} onClick={onCustom}>
          Custom connector
        </Button>
      </header>
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {servers.length > 0 && (
        <SettingsGroup title="Connected">
          {/* What each status means, once, in the same words as the badges. */}
          <p className="connector-legend">
            <span className="badge badge-accent">Connected</span> ready to use
            <span className="badge badge-warning">Needs sign-in</span> nothing is broken: sign in again to use it
            <span className="badge badge-danger">Error</span> Axon couldn’t reach it: try again
          </p>
          {servers.map((s) => (
            <div className="settings-item" key={s.id}>
              <ConnectorMark name={s.name} catalogId={s.catalogId} />
              <div className="settings-item-main">
                <div className="settings-item-title">
                  {s.name}
                  <span className={`badge ${statusTone(s)}`}>{statusText(s)}</span>
                </div>
                <div className="settings-item-meta">Used by {usedBy(s.coworkers)}</div>
              </div>
              <div className="settings-item-actions">
                {/* The fix, one click away, beside the problem. */}
                {s.enabled && (s.status === 'needs-sign-in' || s.status === 'error') && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={waiting === s.id}
                    onClick={() => void fix(s)}
                  >
                    {waiting === s.id ? 'Waiting…' : s.status === 'needs-sign-in' ? 'Sign in' : 'Try again'}
                  </Button>
                )}
                {CONNECTORS.find((entry) => entry.id === s.catalogId)?.auth === 'oauth-app' && (
                  <Button size="sm" onClick={() => setOwnApp(CONNECTORS.find((entry) => entry.id === s.catalogId)!)}>
                    Edit app credentials
                  </Button>
                )}
                <Button size="sm" onClick={() => onManage(s.id)}>
                  Manage
                </Button>
              </div>
            </div>
          ))}
        </SettingsGroup>
      )}
      <section className="connector-catalog" aria-label="Add connectors">
        <div className="connector-catalog-bar">
          <h4>Add connectors</h4>
          <input
            className="input connector-search"
            type="search"
            placeholder="Search connectors"
            aria-label="Search connectors"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="connector-chips" role="tablist" aria-label="Connector categories">
          {(['all', ...Object.keys(CATEGORY_LABELS)] as (ConnectorCategory | 'all')[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={category === id}
              className="connector-chip"
              onClick={() => setCategory(id)}
            >
              {id === 'all' ? 'All' : CATEGORY_LABELS[id]}
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="connector-grid">
            {shown.map((entry) => {
              const needsApp = entry.auth === 'oauth-app' && !apps.includes(entry.id);
              const busy = waiting === entry.id;
              return (
                <article className="connector-card" key={entry.id}>
                  <div className="connector-card-head">
                    <ConnectorMark name={entry.name} catalogId={entry.id} size={18} />
                    <div>
                      <h5>{entry.name}</h5>
                      <div className="connector-badges">
                        {entry.auth === 'none' && !entry.command && <span className="badge">No account</span>}
                        {entry.command && <span className="badge">On this PC</span>}
                        {entry.preview && <span className="badge badge-warning">Preview</span>}
                        {needsApp && <span className="badge">Not set up in this build</span>}
                      </div>
                    </div>
                  </div>
                  <p>{entry.description}</p>
                  <div className="connector-card-actions">
                    {busy ? (
                      <>
                        <span className="connector-waiting">
                          {opensBrowser(entry, apps) ? 'Waiting for your browser…' : 'Connecting…'}
                        </span>
                        {opensBrowser(entry, apps) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void window.axon.connectorSignInCancel()}
                          >
                            Cancel
                          </Button>
                        )}
                      </>
                    ) : needsApp ? (
                      <Button size="sm" disabled={!!waiting} onClick={() => setOwnApp(entry)}>
                        Use your own app
                      </Button>
                    ) : (
                      <>
                      {entry.auth === 'oauth-app' && (
                        <Button size="sm" disabled={!!waiting} onClick={() => setOwnApp(entry)}>
                          Edit app credentials
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!!waiting}
                        onClick={() => void connect(entry)}
                      >
                        Connect
                      </Button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="settings-card settings-empty">
            <EmptyState
              icon={IconPlug}
              title="Nothing to add here"
              description="Everything in this group is connected, or nothing matches your search."
            />
          </div>
        )}
      </section>
      {ownApp && (
        <OwnAppDialog
          entry={ownApp}
          onClose={() => setOwnApp(null)}
          onSaved={() => {
            const entry = ownApp;
            setOwnApp(null);
            void connect(entry);
          }}
        />
      )}
    </div>
  );
}

/** Your own OAuth app for a connector this build of Axon has none for. */
export function OwnAppDialog({
  entry,
  onClose,
  onSaved
}: {
  entry: ConnectorEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (!clientId.trim()) return setError('Enter the client ID.');
    if (entry.id === 'hubspot' && /^\d+$/.test(clientId.trim()))
      return setError('That is a HubSpot account or app ID. Use the Client ID from Development → MCP Connectors.');
    try {
      await window.axon.connectorAppSave(entry.id, clientId, secret);
      await useApp.getState().refresh();
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal
      title={`Use your own ${entry.name} app`}
      description={entry.id === 'hubspot'
        ? 'In HubSpot Development → MCP Connectors, create a connector with redirect URL http://localhost:6275/callback. Paste its client ID and secret here. Your HubSpot account ID is not the client ID.'
        : `Register an OAuth app with ${entry.name}, then paste its details. Axon signs in through http://127.0.0.1 on a free port, at /callback.`}
      onClose={onClose}
      onSubmit={() => void save()}
      submitLabel="Save and connect"
    >
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <label className="field">
        Client ID
        <input
          className="input"
          required
          autoComplete="off"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
      <label className="field">
        Client secret
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="If the app has one"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <span className="field-hint">Kept in your computer's secure storage.</span>
      </label>
    </Modal>
  );
}
