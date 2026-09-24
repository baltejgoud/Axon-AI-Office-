import { useState } from 'react';
import { KeyRound, Plus, Trash2, Server } from 'lucide-react';
import type { ProviderConfig, ProviderKind, MCPServerConfig } from '../../shared/types';
import { useApp, perform } from './state';
import { Button, EmptyState, Field, Icon, Kbd, Modal } from './ui';
import { followsTimeOfDay, setFollowsTimeOfDay } from './features/office/scene/room/lighting';

interface PresetInfo {
  kind: ProviderKind;
  baseUrl: string;
  placeholder: string;
  description?: string;
}

const presets: Record<string, PresetInfo> = {
  OpenAI: {
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    placeholder: 'gpt-4o\ngpt-4o-mini'
  },
  Anthropic: {
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    placeholder: 'claude-3-7-sonnet-20250219\nclaude-3-5-haiku-20241022'
  },
  'Google Gemini': {
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    placeholder: 'gemini-2.5-flash\ngemini-2.5-pro'
  },
  DeepSeek: {
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    placeholder: 'deepseek-chat\ndeepseek-reasoner'
  },
  Kimi: {
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    placeholder: 'moonshot-v1-8k\nmoonshot-v1-32k'
  },
  'Union Alpha (Custom Enterprise)': {
    kind: 'openai-compatible',
    baseUrl: '',
    placeholder: 'model-id-1\nmodel-id-2',
    description: 'Internal or self-hosted enterprise OpenAI-compatible gateway'
  },
  Custom: {
    kind: 'openai-compatible',
    baseUrl: '',
    placeholder: 'model-id-1\nmodel-id-2'
  }
};
const protocolLabel: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI compatible',
  anthropic: 'Anthropic Messages',
  gemini: 'Google Gemini'
};
/** Purely cosmetic brand tint for the provider card's icon tile. */
function tileClass(p: ProviderConfig): string {
  if (p.kind === 'anthropic') return 'icon-tile-anthropic';
  if (p.kind === 'gemini') return 'icon-tile-gemini';
  const name = p.name.toLowerCase();
  if (name.includes('openai') || name.includes('gpt')) return 'icon-tile-openai';
  if (name.includes('deepseek')) return 'icon-tile-deepseek';
  if (name.includes('kimi') || name.includes('moonshot')) return 'icon-tile-openai';
  return 'icon-tile-custom';
}
const blank = (): ProviderConfig => ({
  id: crypto.randomUUID(),
  name: '',
  kind: 'openai-compatible',
  baseUrl: '',
  models: [],
  enabled: true,
  createdAt: Date.now(),
  hasApiKey: false
});
const blankMcp = (): MCPServerConfig => ({
  id: crypto.randomUUID(),
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: {},
  headers: {},
  apiKey: '',
  url: '',
  enabled: true
});
const tabs = ['Providers', 'MCP Servers', 'Appearance', 'Skills & roles', 'Security & data'] as const;
type Tab = (typeof tabs)[number];

export function SettingsPanel() {
  const { data } = useApp();
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [providerError, setProviderError] = useState('');

  const [mcpServer, setMcpServer] = useState<MCPServerConfig | null>(null);
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpEnv, setMcpEnv] = useState('');
  const [mcpHeaders, setMcpHeaders] = useState('');
  const [mcpApiKey, setMcpApiKey] = useState('');
  const [mcpError, setMcpError] = useState('');

  const [tab, setTab] = useState<Tab>('Providers');
  const settings = data!.settings;

  const edit = (p: ProviderConfig) => {
    setProvider(p);
    setModels(p.models.map((m) => m.id).join('\n'));
    setKey('');
    setProviderError('');
    setSelectedTemplate(p.name in presets ? p.name : '');
  };
  const close = () => {
    setProvider(null);
    setKey('');
    setProviderError('');
  };
  const saveProvider = async () => {
    setProviderError('');
    if (!provider?.name?.trim()) {
      setProviderError('Please enter a provider name.');
      return;
    }
    if (!provider?.baseUrl?.trim()) {
      setProviderError('Please enter an API endpoint URL.');
      return;
    }
    const ids = [
      ...new Set(
        models
          .split('\n')
          .map((m) => m.trim())
          .filter(Boolean)
      )
    ];
    if (ids.length === 0) {
      setProviderError('Please specify at least one Model ID (one per line).');
      return;
    }
    try {
      await window.axon.providerSave(
        { ...provider, name: provider.name.trim(), models: ids.map((id) => ({ id, displayName: id })) },
        key || undefined
      );
      await useApp.getState().refresh();
      useApp.getState().pushToast('Provider saved');
      close();
    } catch (err: any) {
      const msg =
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(err);
      setProviderError(msg);
    }
  };

  const editMcp = (s: MCPServerConfig) => {
    setMcpServer(s);
    setMcpArgs((s.args || []).join(' '));
    setMcpEnv(
      Object.entries(s.env || {})
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    );
    setMcpHeaders(
      Object.entries(s.headers || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    );
    setMcpApiKey(s.apiKey || '');
    setMcpError('');
  };
  const closeMcp = () => {
    setMcpServer(null);
    setMcpError('');
  };
  const saveMcp = async () => {
    setMcpError('');
    if (!mcpServer?.name?.trim()) {
      setMcpError('Please enter a server name.');
      return;
    }
    if (mcpServer.transport === 'stdio' && !mcpServer.command?.trim()) {
      setMcpError('Please specify a command for stdio transport.');
      return;
    }
    if (mcpServer.transport === 'sse' && !mcpServer.url?.trim()) {
      setMcpError('Please specify a server URL for SSE transport.');
      return;
    }
    const args = mcpArgs.trim() ? mcpArgs.trim().split(/\s+/) : [];
    const env: Record<string, string> = {};
    mcpEnv.split('\n').forEach((line) => {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
    const headers: Record<string, string> = {};
    mcpHeaders.split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
    try {
      await window.axon.mcpServerSave({
        ...mcpServer,
        name: mcpServer.name.trim(),
        args,
        env,
        headers,
        apiKey: mcpApiKey.trim() || undefined
      });
      await useApp.getState().refresh();
      useApp.getState().pushToast('MCP server saved');
      closeMcp();
    } catch (err: any) {
      const msg =
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(err);
      setMcpError(msg);
    }
  };

  return (
    <div className="settings-sheet">
      <div className="settings-sheet-inner">
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" className="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'Providers' && (
          <>
            <div className="row-between">
              <div>
                <h2>Providers</h2>
                <p className="text-small text-secondary">
                  Bring your own API keys. Keys are stored in the OS key store and never shown again.
                </p>
              </div>
              <Button variant="primary" icon={Plus} onClick={() => edit(blank())}>
                Add provider
              </Button>
            </div>

            {data!.providers.length ? (
              <div className="card-grid">
                {data!.providers.map((p) => (
                  <div className="card" key={p.id}>
                    <div className="card-header">
                      <span className={`icon-tile ${tileClass(p)}`}>{p.name.slice(0, 1).toUpperCase()}</span>
                      <span className={p.enabled ? 'badge badge-accent' : 'badge'}>
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <h3 className="card-title">{p.name}</h3>
                    <p className="text-small text-secondary">{protocolLabel[p.kind]}</p>
                    <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>
                      {p.models.length} model{p.models.length === 1 ? '' : 's'} ·{' '}
                      {p.hasApiKey ? 'Key saved' : 'No key'}
                    </p>
                    <div className="card-footer">
                      <Button size="sm" onClick={() => edit(p)}>
                        Configure
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          void perform(
                            () => window.axon.providerSave({ ...p, enabled: !p.enabled }),
                            p.enabled ? 'Provider disabled' : 'Provider enabled'
                          )
                        }
                      >
                        {p.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        iconOnly
                        aria-label={`Remove ${p.name}`}
                        onClick={() => {
                          if (confirm(`Remove ${p.name} and its saved key?`))
                            void perform(() => window.axon.providerDelete(p.id), 'Provider removed');
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={KeyRound}
                title="No providers yet"
                description="Connect OpenAI, Anthropic, Gemini, DeepSeek, Kimi or any OpenAI-compatible endpoint."
                action={
                  <Button variant="primary" icon={Plus} onClick={() => edit(blank())}>
                    Add provider
                  </Button>
                }
              />
            )}
            <p className="text-caption">
              Union Alpha (Custom Enterprise) connects to internal or self-hosted OpenAI-compatible gateways.
              Provide your custom endpoint URL and model IDs.
            </p>
          </>
        )}

        {tab === 'MCP Servers' && (
          <>
            <div className="row-between">
              <div>
                <h2>MCP Servers</h2>
                <p className="text-small text-secondary">
                  Model Context Protocol servers provide external tools over stdio or SSE. Discovered tools
                  are made available in the Code workspace with approval cards.
                </p>
              </div>
              <Button variant="primary" icon={Plus} onClick={() => editMcp(blankMcp())}>
                Add MCP server
              </Button>
            </div>

            {data!.mcpServers?.length ? (
              <div className="card-grid">
                {data!.mcpServers.map((s) => (
                  <div className="card" key={s.id}>
                    <div className="card-header">
                      <span className="icon-tile">
                        <Icon icon={Server} size="md" />
                      </span>
                      <span className={s.enabled ? 'badge badge-accent' : 'badge'}>
                        {s.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <h3 className="card-title">{s.name}</h3>
                    <p className="text-small text-secondary" style={{ wordBreak: 'break-all' }}>
                      <span className="badge badge-outline" style={{ marginRight: 'var(--space-2)' }}>
                        {s.transport}
                      </span>
                      {s.transport === 'stdio' ? `${s.command} ${(s.args || []).join(' ')}` : s.url}
                    </p>
                    <div className="card-footer">
                      <Button size="sm" onClick={() => editMcp(s)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          void perform(
                            async () => {
                              await window.axon.mcpServerSave({ ...s, enabled: !s.enabled });
                            },
                            s.enabled ? 'MCP server disabled' : 'MCP server enabled'
                          )
                        }
                      >
                        {s.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        iconOnly
                        aria-label={`Delete ${s.name}`}
                        onClick={() => {
                          if (confirm(`Remove MCP server "${s.name}"?`)) {
                            void perform(() => window.axon.mcpServerDelete(s.id), 'MCP server removed');
                          }
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Server}
                title="No MCP servers yet"
                description="Connect Model Context Protocol servers (e.g. GitHub, Postgres, Puppeteer) via stdio command or SSE URL."
                action={
                  <Button variant="primary" icon={Plus} onClick={() => editMcp(blankMcp())}>
                    Add MCP server
                  </Button>
                }
              />
            )}
          </>
        )}

        {tab === 'Appearance' && (
          <div className="card stack" style={{ maxWidth: 560 }}>
            <h2>Appearance</h2>
            <Field label="Theme">
              <select
                className="select"
                value={settings.theme}
                onChange={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({ ...settings, theme: e.target.value as typeof settings.theme })
                  )
                }
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Match system</option>
              </select>
            </Field>
            <OfficeLightingField />
            <Field label="Maximum output tokens" hint="256 – 32,768. Applies to new messages.">
              <input
                className="input"
                type="number"
                min={256}
                max={32768}
                value={settings.defaultMaxTokens}
                onChange={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({
                      ...settings,
                      defaultMaxTokens: Math.max(256, Math.min(32768, Number(e.target.value) || 4096))
                    })
                  )
                }
              />
            </Field>
            <Field label="Default sampling temperature" hint="0.0 (exact) to 2.0 (creative).">
              <input
                className="input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={settings.defaultTemperature}
                onChange={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({
                      ...settings,
                      defaultTemperature: Math.max(0, Math.min(2, Number(e.target.value) || 0.7))
                    })
                  )
                }
              />
            </Field>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.autoTitleConversations}
                onChange={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({ ...settings, autoTitleConversations: e.target.checked })
                  )
                }
              />
              Auto-title new conversations from your first prompt
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.allowShellExecution}
                onChange={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({ ...settings, allowShellExecution: e.target.checked })
                  )
                }
              />
              Allow shell execution (asks for confirmation in project workspace)
            </label>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={settings.keepInTray}
                  onChange={(e) =>
                    void perform(() =>
                      window.axon.settingsSave({ ...settings, keepInTray: e.target.checked })
                    )
                  }
                />
                Keep running in the tray when the window is closed
              </label>
              <p className="text-caption">Reminders only arrive while Axon is running.</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={settings.startWithWindows}
                  disabled={!data?.startWithWindowsAvailable}
                  onChange={(e) =>
                    void perform(() =>
                      window.axon.settingsSave({ ...settings, startWithWindows: e.target.checked })
                    )
                  }
                />
                Start with Windows, in the tray
              </label>
              {!data?.startWithWindowsAvailable && (
                <p className="text-caption">Available in the installed app.</p>
              )}
            </div>
            <div>
              <h3 className="section-title">Keyboard shortcuts</h3>
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <div className="row-between text-small">
                  <span>New conversation</span>
                  <Kbd keys="Mod N" />
                </div>
                <div className="row-between text-small">
                  <span>Search conversations</span>
                  <Kbd keys="Mod K" />
                </div>
                <div className="row-between text-small">
                  <span>Settings</span>
                  <Kbd keys="Mod ," />
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'Skills & roles' && (
          <div className="card stack" style={{ maxWidth: 640 }}>
            <h2>Skills &amp; roles</h2>
            <p className="text-small text-secondary">
              Bundled catalogs authored for Axon. Skills and roles are attached per-workspace or
              per-conversation and run entirely on the provider you choose.
            </p>
            <div>
              <h3 className="section-title">Skills</h3>
              <p className="text-caption">
                {data!.skills.length} skills in {new Set(data!.skills.map((s) => s.category)).size}{' '}
                categories. Bundled with Axon under open licenses; prompt injection protections apply.
              </p>
            </div>
            <div>
              <h3 className="section-title">Roles</h3>
              <p className="text-caption">
                {data!.roles.length} roles in {new Set(data!.roles.map((r) => r.group)).size} groups, authored
                for Axon. Roles are bundled with the app.
              </p>
            </div>
            <p className="text-caption">
              License texts for each source are in <code>src/skills/LICENSES.md</code>.
            </p>
          </div>
        )}

        {tab === 'Security & data' && (
          <div className="card stack" style={{ maxWidth: 640 }}>
            <h2>Security &amp; data</h2>
            <ul className="bullet-list">
              <li>API keys are encrypted with the operating system key store.</li>
              <li>
                Conversations and knowledge are stored locally and are not encrypted. Use full-disk
                encryption.
              </li>
              <li>
                Messages, attachments, shared editor content and retrieved passages go to your selected
                provider.
              </li>
              <li>
                No telemetry or third-party tracking. Shell execution is disabled by default and requires
                explicit confirmation. Background agents run locally on scheduled intervals.
              </li>
              <li>
                Project writes require a native confirmation. Sensitive filenames and symbolic links are
                blocked.
              </li>
            </ul>
            <div>
              <h3 className="section-title">Local data directory</h3>
              <code className="code-path">{data!.dataPath}</code>
              <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>
                Close Axon before backing up this folder. OS-protected keys are not portable. Delete the
                folder to reset all local data.
              </p>
            </div>
            <div>
              <h3 className="section-title">Release status</h3>
              <p className="text-small text-secondary">
                Local beta. Import only trusted documents. Code signing and a security review are required
                before public distribution.
              </p>
            </div>
          </div>
        )}
      </div>

      {provider && (
        <Modal
          title={provider.name || 'Add provider'}
          onClose={close}
          onSubmit={saveProvider}
          submitLabel="Save provider"
        >
          {providerError && (
            <div className="banner-error" style={{ marginBottom: 'var(--space-3)' }} role="alert">
              <span>{providerError}</span>
            </div>
          )}
          <Field label="Quick setup" hint={presets[selectedTemplate]?.description}>
            <select
              className="select"
              value={selectedTemplate}
              onChange={(e) => {
                const choice = e.target.value;
                setSelectedTemplate(choice);
                const p = presets[choice];
                if (p) {
                  setProvider({
                    ...provider,
                    name: choice === 'Custom' ? '' : choice,
                    kind: p.kind,
                    baseUrl: p.baseUrl
                  });
                  if (!models.trim()) {
                    setModels(p.placeholder);
                  }
                }
              }}
            >
              <option value="" disabled>
                Choose a template
              </option>
              {Object.keys(presets).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              className="input"
              required
              value={provider.name}
              onChange={(e) => setProvider({ ...provider, name: e.target.value })}
            />
          </Field>
          <Field label="API protocol">
            <select
              className="select"
              value={provider.kind}
              onChange={(e) => setProvider({ ...provider, kind: e.target.value as ProviderKind })}
            >
              {(Object.keys(protocolLabel) as ProviderKind[]).map((k) => (
                <option key={k} value={k}>
                  {protocolLabel[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base endpoint" hint="HTTPS only, except http://localhost for local servers.">
            <input
              className="input"
              required
              type="url"
              placeholder="https://your-provider.example/v1"
              value={provider.baseUrl || ''}
              onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
            />
          </Field>
          <Field
            label="API key"
            hint={provider.hasApiKey ? 'A key is saved. Leave blank to keep it.' : undefined}
          >
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          {provider.hasApiKey && (
            <div>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  void perform(async () => {
                    await window.axon.providerSave(provider, '');
                    setProvider({ ...provider, hasApiKey: false });
                  })
                }
              >
                Remove saved key
              </Button>
            </div>
          )}
          <Field label="Model IDs" hint="One per line, exactly as your provider names them.">
            <textarea
              className="textarea"
              required
              rows={4}
              placeholder={presets[selectedTemplate]?.placeholder || 'gpt-4o\ngpt-4o-mini'}
              value={models}
              onChange={(e) => setModels(e.target.value)}
            />
          </Field>
          <p className="text-caption">
            Your key and messages are sent to this endpoint. Only connect services you trust.
          </p>
        </Modal>
      )}

      {mcpServer && (
        <Modal
          title={mcpServer.name ? 'Edit MCP server' : 'New MCP server'}
          onClose={closeMcp}
          onSubmit={saveMcp}
          submitLabel="Save server"
        >
          {mcpError && (
            <div className="banner-error" style={{ marginBottom: 'var(--space-3)' }} role="alert">
              <span>{mcpError}</span>
            </div>
          )}
          <Field label="Server name" hint="A short identifier, e.g. github, filesystem, rube">
            <input
              className="input"
              required
              value={mcpServer.name}
              onChange={(e) => setMcpServer({ ...mcpServer, name: e.target.value })}
            />
          </Field>
          <Field label="Transport">
            <select
              className="select"
              value={mcpServer.transport}
              onChange={(e) => setMcpServer({ ...mcpServer, transport: e.target.value as 'stdio' | 'sse' })}
            >
              <option value="stdio">Local process (stdio)</option>
              <option value="sse">Remote HTTP / SSE</option>
            </select>
          </Field>
          {mcpServer.transport === 'stdio' ? (
            <>
              <Field label="Command" hint="Executable command, e.g. npx, node, uvx, python">
                <input
                  className="input"
                  required
                  placeholder="npx"
                  value={mcpServer.command || ''}
                  onChange={(e) => setMcpServer({ ...mcpServer, command: e.target.value })}
                />
              </Field>
              <Field label="Arguments" hint="Command arguments separated by spaces">
                <input
                  className="input"
                  placeholder="-y @modelcontextprotocol/server-filesystem D:\my-files"
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                />
              </Field>
              <Field label="Environment variables" hint="KEY=VALUE per line">
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder={'GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...\nNODE_ENV=production'}
                  value={mcpEnv}
                  onChange={(e) => setMcpEnv(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Server URL" hint="SSE endpoint URL">
                <input
                  className="input"
                  required
                  type="url"
                  placeholder="http://localhost:8000/sse"
                  value={mcpServer.url || ''}
                  onChange={(e) => setMcpServer({ ...mcpServer, url: e.target.value })}
                />
              </Field>
              <Field label="API Key / Bearer token" hint="Optional token sent in Authorization header">
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="Bearer token or API key"
                  value={mcpApiKey}
                  onChange={(e) => setMcpApiKey(e.target.value)}
                />
              </Field>
              <Field label="Custom HTTP headers" hint="Header: Value per line">
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder={'X-Custom-Auth: secret\nUser-Agent: Axon-Client'}
                  value={mcpHeaders}
                  onChange={(e) => setMcpHeaders(e.target.value)}
                />
              </Field>
            </>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={mcpServer.enabled}
              onChange={(e) => setMcpServer({ ...mcpServer, enabled: e.target.checked })}
            />
            <span>Enable this MCP server</span>
          </label>
        </Modal>
      )}
    </div>
  );
}

/** The office follows the clock (golden evenings, lamps on at night) unless switched off here. */
function OfficeLightingField() {
  const [on, setOn] = useState(followsTimeOfDay);
  return (
    <Field
      label="Office lighting"
      hint="Warm mornings, golden evenings and lamps at night, following your clock."
    >
      <label className="row" style={{ gap: 'var(--space-2)' }}>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setFollowsTimeOfDay(e.target.checked);
          }}
        />
        <span>Follow the time of day</span>
      </label>
    </Field>
  );
}
