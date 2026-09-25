import { useMemo, useState } from 'react';
import { Check, ListPlus, PlugZap, Plus, Search, X } from 'lucide-react';
import type { ProviderConfig, ProviderKind } from '../../../shared/types';
import type { ProviderModelsResult, ProviderTestResult } from '../../../shared/platform';
import { useApp, perform } from '../state';
import { Button, Icon, Modal } from '../ui';

interface Preset {
  /** The provider's name once saved, and the tile's label. */
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Suggested models, filled in while the list is empty. */
  models: string[];
  /** Setup notes for this service: where keys come from, regional endpoints. */
  description?: string;
  /** Brand tint for the tile's letter. */
  tint: string;
}

export const PRESETS: readonly Preset[] = [
  {
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
    tint: 'openai'
  },
  {
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    tint: 'anthropic'
  },
  {
    name: 'Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    tint: 'gemini'
  },
  {
    name: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    tint: 'deepseek'
  },
  {
    name: 'Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: ['kimi-k3', 'kimi-k2.6'],
    description:
      'Keys from platform.moonshot.ai. A China account (platform.moonshot.cn) uses https://api.moonshot.cn/v1. Kimi models think before they answer: set Max tokens to 16,000 or more.',
    tint: 'kimi'
  },
  {
    name: 'Qwen',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen-plus'],
    description:
      'Alibaba Model Studio. A key works only in the region it was made in: this address is Singapore; US keys use https://dashscope-us.aliyuncs.com/compatible-mode/v1, Beijing keys https://dashscope.aliyuncs.com/compatible-mode/v1.',
    tint: 'qwen'
  },
  {
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['moonshotai/kimi-k3', 'qwen/qwen3.8-max-0902'],
    description: 'One key for Kimi, Qwen, DeepSeek, Llama and hundreds more. Model IDs name their maker.',
    tint: 'openrouter'
  },
  {
    name: 'Ollama',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen3', 'llama3.2'],
    description:
      'Models running on this computer through Ollama. No key needed; pull a model in Ollama first.',
    tint: 'ollama'
  },
  {
    name: 'Union Alpha',
    kind: 'openai-compatible',
    baseUrl: '',
    models: [],
    description: 'Your internal or self-hosted OpenAI-compatible gateway: enter its endpoint and model IDs.',
    tint: 'custom'
  },
  {
    name: 'Custom',
    kind: 'openai-compatible',
    baseUrl: '',
    models: [],
    description: 'Any OpenAI-compatible, Anthropic or Gemini endpoint.',
    tint: 'custom'
  }
];

const PROTOCOLS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI compatible',
  anthropic: 'Anthropic Messages',
  gemini: 'Google Gemini'
};
export const protocolLabel = (kind: ProviderKind) => PROTOCOLS[kind];

/** The preset a saved provider came from: by its endpoint, else by its name. */
function presetOf(p: ProviderConfig): Preset | undefined {
  return (
    PRESETS.find((preset) => preset.baseUrl && preset.baseUrl === p.baseUrl && preset.kind === p.kind) ??
    PRESETS.find((preset) => preset.name === p.name)
  );
}

/** Brand tint for a provider's letter tile (cosmetic). */
export function tintOf(p: ProviderConfig): string {
  return presetOf(p)?.tint ?? 'custom';
}

/** A main-process error without Electron's "Error invoking remote method" wrapper. */
const errorText = (err: unknown) =>
  err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(err);

/** Found models shown at once; a search narrows longer lists (OpenRouter offers hundreds). */
const MODELS_SHOWN = 80;

/** Add or edit a model provider: which service, how to reach it, and which of its models to use. */
export function ProviderDialog({ initial, onClose }: { initial: ProviderConfig; onClose: () => void }) {
  const isNew = !useApp((s) => s.data?.providers.some((p) => p.id === initial.id));
  const [provider, setProvider] = useState(initial);
  const [preset, setPreset] = useState<Preset | undefined>(() => (isNew ? undefined : presetOf(initial)));
  const [key, setKey] = useState('');
  const [models, setModels] = useState<string[]>(initial.models.map((m) => m.id));
  const [newModel, setNewModel] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ form: string; result: ProviderTestResult } | null>(null);
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<{ form: string; result: ProviderModelsResult } | null>(null);
  const [search, setSearch] = useState('');

  const endpointForm = JSON.stringify([provider.kind, provider.baseUrl, key]);
  const form = JSON.stringify([endpointForm, models]);
  const shownTest = test?.form === form ? test.result : null;
  const shownModels = found?.form === endpointForm ? found.result : null;
  const chosen = new Set(models);
  const withModels = () => ({ ...provider, models: models.map((id) => ({ id, displayName: id })) });

  const choosePreset = (next: Preset) => {
    const previous = preset;
    setPreset(next);
    setProvider({
      ...provider,
      // Keep a name the user typed; replace one a preset filled in.
      name:
        !provider.name.trim() || provider.name === previous?.name
          ? next.name === 'Custom'
            ? ''
            : next.name
          : provider.name,
      kind: next.kind,
      baseUrl: next.baseUrl
    });
    // Swap suggested models too, unless the list is the user's own.
    if (!models.length || (previous && models.join('\n') === previous.models.join('\n')))
      setModels(next.models);
  };

  const addModel = (raw: string) => {
    const ids = raw
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter((id) => id && !chosen.has(id));
    if (ids.length) setModels([...models, ...new Set(ids)]);
    setNewModel('');
  };
  const toggleModel = (id: string) =>
    setModels(chosen.has(id) ? models.filter((m) => m !== id) : [...models, id]);

  const testConnection = async () => {
    if (!models.length) return setError('Add at least one model to test.');
    setError('');
    setTesting(true);
    try {
      const result = await window.axon.providerTest(withModels(), key || undefined);
      setTest({ form, result });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setTesting(false);
    }
  };

  const findModels = async () => {
    setError('');
    setFinding(true);
    try {
      const result = await window.axon.providerModels(withModels(), key || undefined);
      setFound({ form: endpointForm, result });
      setSearch('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setFinding(false);
    }
  };

  const save = async () => {
    setError('');
    if (!provider.name.trim()) return setError('Give this provider a name.');
    if (!provider.baseUrl?.trim()) return setError('Enter the endpoint URL.');
    if (!models.length) return setError('Add at least one model.');
    try {
      await window.axon.providerSave({ ...withModels(), name: provider.name.trim() }, key || undefined);
      await useApp.getState().refresh();
      useApp.getState().pushToast('Provider saved');
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const needle = search.trim().toLowerCase();
  const matches = useMemo(
    () => (shownModels?.models ?? []).filter((id) => id.toLowerCase().includes(needle)),
    [shownModels, needle]
  );

  return (
    <Modal
      title={isNew ? 'Add a model provider' : provider.name || 'Provider'}
      description="Connect a service with your own API key. Your key is stored in the system key store."
      size="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      submitLabel={isNew ? 'Add provider' : 'Save changes'}
      footerStart={<span className="text-caption">Your key and messages go only to this endpoint.</span>}
    >
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <section className="provider-section">
        <h3 className="provider-section-title">Service</h3>
        <div className="preset-grid" role="radiogroup" aria-label="Service">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              role="radio"
              aria-checked={preset?.name === p.name}
              className="preset-tile"
              onClick={() => choosePreset(p)}
            >
              <span className={`preset-mark tint-${p.tint}`} aria-hidden="true">
                {p.name === 'Custom' ? <Icon icon={Plus} size="sm" /> : p.name.slice(0, 1)}
              </span>
              <span className="preset-name">{p.name}</span>
            </button>
          ))}
        </div>
        {preset?.description && <p className="provider-note">{preset.description}</p>}
      </section>

      <section className="provider-section">
        <h3 className="provider-section-title">Connection</h3>
        <div className="form-grid">
          <label className="field">
            Name
            <input
              className="input"
              required
              placeholder="e.g. Kimi"
              value={provider.name}
              onChange={(e) => setProvider({ ...provider, name: e.target.value })}
            />
          </label>
          <label className="field">
            API protocol
            <select
              className="select"
              value={provider.kind}
              onChange={(e) => setProvider({ ...provider, kind: e.target.value as ProviderKind })}
            >
              {(Object.keys(PROTOCOLS) as ProviderKind[]).map((k) => (
                <option key={k} value={k}>
                  {PROTOCOLS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            Endpoint
            <input
              className="input"
              required
              type="url"
              placeholder="https://api.example.com/v1"
              value={provider.baseUrl || ''}
              onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
            />
            <span className="field-hint">HTTPS, or http://localhost for a server on this computer.</span>
          </label>
          <label className="field span-2">
            API key
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={provider.hasApiKey ? '•••••••• saved — type to replace' : 'Paste your key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="field-hint">
              {provider.hasApiKey ? (
                <>
                  A key is saved. Leave this empty to keep it, or{' '}
                  <button
                    type="button"
                    className="link-button danger"
                    onClick={() =>
                      void perform(async () => {
                        await window.axon.providerSave(provider, '');
                        setProvider({ ...provider, hasApiKey: false });
                      }, 'Saved key removed')
                    }
                  >
                    remove it
                  </button>
                  .
                </>
              ) : (
                'Spaces, quotes and a "Bearer " prefix are removed for you.'
              )}
            </span>
          </label>
        </div>
      </section>

      <section className="provider-section">
        <div className="provider-section-head">
          <h3 className="provider-section-title">Models</h3>
          <Button size="sm" icon={ListPlus} disabled={finding} onClick={() => void findModels()}>
            {finding ? 'Finding…' : 'Find models'}
          </Button>
        </div>
        {models.length ? (
          <ul className="model-tokens" aria-label="Models to use">
            {models.map((id) => (
              <li key={id} className="model-token">
                <span>{id}</span>
                <button type="button" aria-label={`Remove ${id}`} onClick={() => toggleModel(id)}>
                  <Icon icon={X} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="provider-empty">No models yet. Find the ones your key can use, or add an ID.</p>
        )}
        <div className="model-add">
          <input
            className="input"
            aria-label="Add a model ID"
            placeholder="Add a model ID, e.g. kimi-k3"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addModel(newModel);
              }
            }}
          />
          <Button icon={Plus} disabled={!newModel.trim()} onClick={() => addModel(newModel)}>
            Add
          </Button>
        </div>

        {shownModels && (
          <div className="model-browser">
            <div className="model-browser-head">
              <span>
                {shownModels.models.length} available
                {chosen.size ? ` · ${shownModels.models.filter((id) => chosen.has(id)).length} chosen` : ''}
              </span>
              {shownModels.models.length > 8 && (
                <label className="model-search">
                  <Icon icon={Search} size="sm" />
                  <input
                    type="search"
                    aria-label="Search models"
                    placeholder="Search models"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  />
                </label>
              )}
            </div>
            {shownModels.models.length === 0 ? (
              <p className="provider-empty">The endpoint lists no models for this key.</p>
            ) : (
              <ul className="model-options" aria-label="Models this key can use">
                {matches.slice(0, MODELS_SHOWN).map((id) => (
                  <li key={id}>
                    <label className="model-option">
                      <input type="checkbox" checked={chosen.has(id)} onChange={() => toggleModel(id)} />
                      <span>{id}</span>
                    </label>
                  </li>
                ))}
                {!matches.length && <li className="provider-empty">No model matches “{search}”.</li>}
              </ul>
            )}
            {matches.length > MODELS_SHOWN && (
              <p className="text-caption">
                Showing {MODELS_SHOWN} of {matches.length}. Search to narrow the list.
              </p>
            )}
            {shownModels.savedKeyWithheld && (
              <p className="text-caption">
                Listed without the saved key, because the endpoint changed. Type the key to list with it.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="provider-section">
        <div className="provider-section-head">
          <h3 className="provider-section-title">Check</h3>
          <Button size="sm" icon={PlugZap} disabled={testing} onClick={() => void testConnection()}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
        {shownTest ? (
          <ul className="test-results" aria-live="polite">
            {shownTest.results.map((r) => (
              <li key={r.modelId} className={r.ok ? 'is-ok' : 'is-failed'}>
                <Icon icon={r.ok ? Check : X} size="sm" />
                <span className="test-model">{r.modelId}</span>
                <span className="test-detail">
                  {r.ok ? `answered in ${((r.ms ?? 0) / 1000).toFixed(1)} s` : r.error}
                </span>
              </li>
            ))}
            {shownTest.savedKeyWithheld && (
              <li className="text-caption">
                Tested without the saved key, because the endpoint changed. Type the key to test with it.
              </li>
            )}
            {shownTest.untested > 0 && (
              <li className="text-caption">
                Tested the first {shownTest.results.length} models; {shownTest.untested} more not tested.
              </li>
            )}
          </ul>
        ) : (
          <p className="provider-empty">Sends a tiny request to each model to check the key and model IDs.</p>
        )}
      </section>
    </Modal>
  );
}
