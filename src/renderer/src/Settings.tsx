import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import type { ProviderConfig, ProviderKind } from '../../shared/types';
import { useApp, perform } from './state';
import { Button, EmptyState, Field, Kbd, Modal, PageHeader } from './ui';

const presets: Record<string, [ProviderKind, string]> = {
  OpenAI: ['openai-compatible', 'https://api.openai.com/v1'],
  Anthropic: ['anthropic', 'https://api.anthropic.com/v1'],
  'Google Gemini': ['gemini', 'https://generativelanguage.googleapis.com/v1beta'],
  DeepSeek: ['openai-compatible', 'https://api.deepseek.com/v1'],
  Kimi: ['openai-compatible', 'https://api.moonshot.ai/v1'],
  'Union Alpha': ['openai-compatible', ''],
  Custom: ['openai-compatible', '']
};
const protocolLabel: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI compatible',
  anthropic: 'Anthropic Messages',
  gemini: 'Google Gemini'
};
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
const tabs = ['Providers', 'Appearance', 'Skills & roles', 'Security & data'] as const;
type Tab = (typeof tabs)[number];

export function SettingsPanel() {
  const { data } = useApp();
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState('');
  const [tab, setTab] = useState<Tab>('Providers');
  const settings = data!.settings;

  const edit = (p: ProviderConfig) => {
    setProvider(p);
    setModels(p.models.map((m) => m.id).join('\n'));
    setKey('');
  };
  const close = () => {
    setProvider(null);
    setKey('');
  };
  const saveProvider = () =>
    void perform(async () => {
      const ids = [
        ...new Set(
          models
            .split('\n')
            .map((m) => m.trim())
            .filter(Boolean)
        )
      ];
      await window.axon.providerSave(
        { ...provider!, models: ids.map((id) => ({ id, displayName: id })) },
        key || undefined
      );
      close();
    });

  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader title="Settings" description="Providers, appearance and local data." />

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
                      <span className="icon-tile">{p.name.slice(0, 1).toUpperCase()}</span>
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
                          void perform(() => window.axon.providerSave({ ...p, enabled: !p.enabled }))
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
                            void perform(() => window.axon.providerDelete(p.id));
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
              Union Alpha needs an endpoint and model IDs from your service; Axon does not assume an official
              API.
            </p>
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
            <Field label="Maximum output tokens" hint="256 – 32,768. Applies to new messages.">
              <input
                className="input"
                type="number"
                min={256}
                max={32768}
                defaultValue={settings.defaultMaxTokens}
                onBlur={(e) =>
                  void perform(() =>
                    window.axon.settingsSave({ ...settings, defaultMaxTokens: Number(e.target.value) })
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
              Name new conversations from the first message
            </label>
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
          <div className="card stack" style={{ maxWidth: 720 }}>
            <h2>Skills &amp; roles</h2>
            <p className="text-small text-secondary">
              Bundled with this version of Axon. Choose them from the composer, or set defaults on a workspace
              or agent profile. Selected skills are added to the system prompt; scripts and tool servers they
              mention do not run here.
            </p>
            <div>
              <h3 className="section-title">Skill sources</h3>
              <div className="document-list">
                {data!.skillSources.map((s) => (
                  <div className="document-row" key={s.slug}>
                    <span className="file-badge">{s.skillCount}</span>
                    <div>
                      <strong className="text-small">{s.slug}</strong>
                      <p className="text-caption">
                        {s.url} · {s.license} · {s.commit.slice(0, 7)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="section-title">Roles</h3>
              <p className="text-caption">
                {data!.roles.length} roles in {new Set(data!.roles.map((r) => r.group)).size} groups, authored
                for Axon. Edit <code>src/roles/roles.json</code> to change them.
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
              <li>No telemetry, plugins, shell execution or background agents.</li>
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
          <Field label="Quick setup">
            <select
              className="select"
              defaultValue=""
              onChange={(e) => {
                const [kind, baseUrl] = presets[e.target.value];
                setProvider({
                  ...provider,
                  name: e.target.value === 'Custom' ? '' : e.target.value,
                  kind,
                  baseUrl
                });
              }}
            >
              <option value="" disabled>
                Choose a template
              </option>
              {Object.keys(presets).map((p) => (
                <option key={p}>{p}</option>
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
              placeholder={'gpt-4o\ngpt-4o-mini'}
              value={models}
              onChange={(e) => setModels(e.target.value)}
            />
          </Field>
          <p className="text-caption">
            Your key and messages are sent to this endpoint. Only connect services you trust.
          </p>
        </Modal>
      )}
    </div>
  );
}
