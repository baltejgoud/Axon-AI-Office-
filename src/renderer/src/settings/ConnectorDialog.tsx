import { useState } from 'react';
import type { MCPServerConfig, McpToolPolicy } from '../../../shared/types';
import {
  CONNECTOR_TOOL_BUDGET,
  assign,
  assignGroup,
  connectorById,
  servesRun,
  toolAction
} from '../../../shared/connectors';
import { COWORKERS, SPECIALIST_GROUPS } from '../../../shared/coworkers';
import { useApp, perform } from '../state';
import { Button, Modal } from '../ui';
import { Segmented, Switch } from './controls';
import { ConnectorMark, errorText, statusText } from './ConnectorsSection';

const CORE = COWORKERS.filter((c) => c.core);
const POLICY_OPTIONS = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'off', label: 'Off' }
] as const;

/** Coworkers whose connectors would carry more tools than one request allows. */
function overBudget(servers: MCPServerConfig[]): { name: string; count: number }[] {
  return COWORKERS.map((c) => ({
    name: c.name,
    count: servers
      .filter((s) => s.enabled && servesRun(s.coworkers, { coworkerId: c.id, department: c.department }))
      .reduce((n, s) => n + (s.tools ?? []).filter((t) => toolAction(s, t) !== 'off').length, 0)
  })).filter((x) => x.count > CONNECTOR_TOOL_BUDGET);
}

/** Manage one connector: its sign-in, who uses it, and what each of its tools may do. */
export function ConnectorDialog({
  serverId,
  onClose,
  onEdit
}: {
  serverId: string;
  onClose: () => void;
  /** Opens the connection form (custom connectors). */
  onEdit: (server: MCPServerConfig) => void;
}) {
  const server = useApp((s) => s.data?.mcpServers.find((m) => m.id === serverId));
  const all = useApp((s) => s.data?.mcpServers ?? []);
  const [coworkers, setCoworkers] = useState<string[]>(server?.coworkers ?? []);
  const [policy, setPolicy] = useState<Record<string, McpToolPolicy>>(server?.toolPolicy ?? {});
  const [trust, setTrust] = useState(!!server?.trustAnnotations);
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  if (!server) return null;
  const entry = connectorById(server.catalogId);
  const draft: MCPServerConfig = {
    ...server,
    enabled,
    coworkers,
    toolPolicy: policy,
    trustAnnotations: trust
  };
  const over = overBudget(all.map((s) => (s.id === server.id ? draft : s)));
  const tools = server.tools ?? [];

  const reconnect = async () => {
    setError('');
    setWaiting(true);
    try {
      await window.axon.connectorReconnect(server.id);
      await useApp.getState().refresh();
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setWaiting(false);
    }
  };
  const save = () =>
    void perform(() => window.axon.mcpServerSave(draft), `${server.name} saved`).then(onClose);
  const remove = () => {
    if (confirm(`Remove ${server.name}? Coworkers lose its tools and its sign-in is forgotten.`))
      void perform(() => window.axon.mcpServerDelete(server.id), `${server.name} removed`).then(onClose);
  };

  return (
    <Modal
      title={server.name}
      description={entry?.description ?? 'A custom connector.'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      submitLabel="Save"
      footerStart={
        <label className="switch-label">
          <Switch checked={enabled} label={`${server.name} on`} onChange={setEnabled} />
          On
        </label>
      }
    >
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <section className="connector-status-row">
        <ConnectorMark name={server.name} catalogId={server.catalogId} size={18} />
        <div className="connector-status-text">
          {waiting ? 'Waiting for your browser…' : statusText(server)}
        </div>
        {waiting ? (
          <Button size="sm" variant="ghost" onClick={() => void window.axon.connectorSignInCancel()}>
            Cancel
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={() => void reconnect()}>
              {server.status === 'needs-sign-in' ? 'Sign in' : 'Reconnect'}
            </Button>
            {server.signedIn && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void perform(() => window.axon.connectorSignOut(server.id), `Signed out of ${server.name}`)
                }
              >
                Sign out
              </Button>
            )}
            {!entry && (
              <Button size="sm" variant="ghost" onClick={() => onEdit(server)}>
                Edit connection
              </Button>
            )}
            <Button size="sm" variant="ghost" className="danger-hover" onClick={remove}>
              Remove
            </Button>
          </>
        )}
      </section>

      <section className="connector-section" aria-label="Used by">
        <h4>Used by</h4>
        {over.length > 0 && (
          <p className="connector-warning" role="status">
            Over the {CONNECTOR_TOOL_BUDGET}-tool limit, so some connectors will be left out of their
            requests:{' '}
            {over
              .slice(0, 4)
              .map((x) => `${x.name} (${x.count})`)
              .join(', ')}
            {over.length > 4 ? ` and ${over.length - 4} more` : ''}. Turn some tools off below.
          </p>
        )}
        <label className="connector-check">
          <input
            type="checkbox"
            checked={coworkers.includes('chats')}
            onChange={(e) =>
              setCoworkers(
                e.target.checked ? [...coworkers, 'chats'] : coworkers.filter((a) => a !== 'chats')
              )
            }
          />
          Your own chats
        </label>
        <div className="connector-people">
          {CORE.map((c) => (
            <label className="connector-check" key={c.id}>
              <input
                type="checkbox"
                checked={servesRun(coworkers, { coworkerId: c.id, department: c.department })}
                onChange={(e) => setCoworkers(assign(coworkers, c, e.target.checked))}
              />
              {c.name}
            </label>
          ))}
        </div>
        <div className="connector-departments">
          {SPECIALIST_GROUPS.map((group) => {
            const members = COWORKERS.filter((c) => !c.core && c.department === group);
            return (
              <div className="connector-department" key={group}>
                <label className="connector-check">
                  <input
                    type="checkbox"
                    checked={coworkers.includes(`group:${group}`)}
                    onChange={(e) =>
                      setCoworkers(
                        assignGroup(
                          coworkers,
                          group,
                          members.map((m) => m.id),
                          e.target.checked
                        )
                      )
                    }
                  />
                  {group} <span className="connector-count">{members.length}</span>
                </label>
                <button
                  type="button"
                  className="connector-disclose"
                  aria-expanded={openGroup === group}
                  onClick={() => setOpenGroup(openGroup === group ? null : group)}
                >
                  {openGroup === group ? 'Hide people' : 'People'}
                </button>
                {openGroup === group && (
                  <div className="connector-members">
                    {members.map((m) => (
                      <label className="connector-check" key={m.id}>
                        <input
                          type="checkbox"
                          checked={servesRun(coworkers, { coworkerId: m.id, department: m.department })}
                          onChange={(e) => setCoworkers(assign(coworkers, m, e.target.checked))}
                        />
                        {m.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="connector-section" aria-label="Tools">
        <h4>Tools</h4>
        {!entry && (
          <label className="switch-label connector-trust">
            <Switch checked={trust} label="Trust this server's read-only marks" onChange={setTrust} />
            Trust this server's read-only marks (otherwise every tool asks first)
          </label>
        )}
        {tools.length ? (
          <ul className="connector-tools">
            {tools.map((tool) => {
              const auto = toolAction({ ...draft, toolPolicy: {} }, tool);
              return (
                <li key={tool.name}>
                  <div className="connector-tool-text">
                    <strong>{tool.annotations?.title ?? tool.name}</strong>
                    {tool.description && <span title={tool.description}>{tool.description}</span>}
                    <em>{auto === 'allow' ? 'Runs on its own' : 'Asks first'}</em>
                  </div>
                  <Segmented
                    label={`${tool.name}: allow, ask or off`}
                    value={policy[tool.name] ?? auto}
                    options={POLICY_OPTIONS}
                    onChange={(value) => setPolicy({ ...policy, [tool.name]: value })}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="connector-empty">Its tools show here once it's connected.</p>
        )}
      </section>
    </Modal>
  );
}
