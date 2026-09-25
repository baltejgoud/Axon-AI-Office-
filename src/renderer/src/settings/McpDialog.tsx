import { useState } from 'react';
import type { MCPServerConfig } from '../../../shared/types';
import { useApp } from '../state';
import { Modal } from '../ui';
import { Switch } from './controls';

const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);

const lines = (entries: Record<string, string> | undefined, separator: string) =>
  Object.entries(entries || {})
    .map(([k, v]) => `${k}${separator}${v}`)
    .join('\n');

/** Pairs typed one per line, split at the first `separator`. */
function pairs(text: string, separator: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(separator);
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** Add or edit an MCP server: a local command, or a remote URL. */
export function McpDialog({ initial, onClose }: { initial: MCPServerConfig; onClose: () => void }) {
  const isNew = !useApp((s) => s.data?.mcpServers?.some((server) => server.id === initial.id));
  const [server, setServer] = useState(initial);
  const [args, setArgs] = useState((initial.args || []).join(' '));
  const [env, setEnv] = useState(lines(initial.env, '='));
  const [headers, setHeaders] = useState(lines(initial.headers, ': '));
  const [apiKey, setApiKey] = useState(initial.apiKey || '');
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (!server.name?.trim()) return setError('Give the server a name.');
    if (server.transport === 'stdio' && !server.command?.trim())
      return setError('Enter the command that starts it.');
    if (server.transport === 'sse' && !server.url?.trim()) return setError('Enter the server URL.');
    try {
      await window.axon.mcpServerSave({
        ...server,
        name: server.name.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        env: pairs(env, '='),
        headers: pairs(headers, ':'),
        apiKey: apiKey.trim() || undefined
      });
      await useApp.getState().refresh();
      useApp.getState().pushToast('MCP server saved');
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Modal
      title={isNew ? 'Add an MCP server' : server.name || 'MCP server'}
      description="MCP servers give your coworkers tools: files, GitHub, databases and more."
      size="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      submitLabel={isNew ? 'Add server' : 'Save changes'}
      footerStart={
        <label className="switch-label">
          <Switch
            checked={server.enabled}
            label="Enable this server"
            onChange={(enabled) => setServer({ ...server, enabled })}
          />
          Enabled
        </label>
      }
    >
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          Name
          <input
            className="input"
            required
            placeholder="e.g. github"
            value={server.name}
            onChange={(e) => setServer({ ...server, name: e.target.value })}
          />
        </label>
        <label className="field">
          Runs as
          <select
            className="select"
            value={server.transport}
            onChange={(e) => setServer({ ...server, transport: e.target.value as 'stdio' | 'sse' })}
          >
            <option value="stdio">Local process (stdio)</option>
            <option value="sse">Remote server (HTTP / SSE)</option>
          </select>
        </label>
        {server.transport === 'stdio' ? (
          <>
            <label className="field">
              Command
              <input
                className="input"
                required
                placeholder="npx"
                value={server.command || ''}
                onChange={(e) => setServer({ ...server, command: e.target.value })}
              />
              <span className="field-hint">e.g. npx, node, uvx, python</span>
            </label>
            <label className="field">
              Arguments
              <input
                className="input"
                placeholder="-y @modelcontextprotocol/server-filesystem D:\files"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
              />
              <span className="field-hint">Separated by spaces</span>
            </label>
            <label className="field span-2">
              Environment variables
              <textarea
                className="textarea"
                rows={3}
                placeholder={'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...\nNODE_ENV=production'}
                value={env}
                onChange={(e) => setEnv(e.target.value)}
              />
              <span className="field-hint">One KEY=value per line</span>
            </label>
          </>
        ) : (
          <>
            <label className="field span-2">
              Server URL
              <input
                className="input"
                required
                type="url"
                placeholder="http://localhost:8000/sse"
                value={server.url || ''}
                onChange={(e) => setServer({ ...server, url: e.target.value })}
              />
            </label>
            <label className="field span-2">
              API key or bearer token
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={server.hasApiKey ? '•••••••• saved — type to replace' : 'Optional'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <span className="field-hint">Sent in the Authorization header.</span>
            </label>
            <label className="field span-2">
              Custom HTTP headers
              <textarea
                className="textarea"
                rows={2}
                placeholder={'X-Custom-Auth: secret\nUser-Agent: Axon-Client'}
                value={headers}
                onChange={(e) => setHeaders(e.target.value)}
              />
              <span className="field-hint">One Header: value per line</span>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
