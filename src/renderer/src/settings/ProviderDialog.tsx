import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  CircleCheck,
  Info,
  ListPlus,
  LoaderCircle,
  PlugZap,
  Plus,
  Search,
  X
} from 'lucide-react';
import type { ProviderConfig, ProviderKind } from '../../../shared/types';
import type { ProviderModelsResult, ProviderTestResult } from '../../../shared/platform';
import { useApp, perform } from '../state';
import { Button, Icon, Modal } from '../ui';
import { PREFERENCES, chooseModels, serviceFromKey } from './modelChoice';

/** Where set-up from a pasted key stands. */
type Setup =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ready'; models: string[]; movedTo?: string }
  | { state: 'failed'; message: string }
  | { state: 'needs-service' };
/** How long after the last keystroke set-up starts, so a pasted key is checked once. */
const SETUP_DELAY_MS = 600;
const isLocal = (url?: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(url ?? '');
const spec = (id: string) => ({ id, displayName: id });

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
      'Paste a key from platform.moonshot.ai or platform.moonshot.cn: Axon finds the right address for it, and gives Kimi room to think before it answers.',
    tint: 'kimi'
  },
  {
    name: 'Qwen',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen-plus'],
    description:
      'Alibaba Model Studio. Keys work only in the region they were made in; Axon tries Singapore, the US, Beijing and Hong Kong and keeps the one that accepts yours.',
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

/** What set-up found out, under the key field. */
function SetupStatus({ setup, service, isKeyless }: { setup: Setup; service: string; isKeyless?: boolean }) {
  switch (setup.state) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <div className="setup-status span-2" role="status">
          <Icon icon={LoaderCircle} size="sm" className="spin" />
          <span>
            {isKeyless
              ? `Connecting${service ? ` to ${service}` : ''} and finding models…`
              : `Checking your key${service ? ` with ${service}` : ''} and finding its models…`}
          </span>
        </div>
      );
    case 'needs-service':
      return (
        <div className="setup-status span-2" role="status">
          <Icon icon={Info} size="sm" />
          <span>Choose the service this key is for, above.</span>
        </div>
      );
    case 'ready':
      return (
        <div className="setup-status span-2 is-ready" role="status">
          <Icon icon={CircleCheck} size="sm" />
          <span>
            {isKeyless ? 'Connected.' : 'Key works.'} Ready to use: {setup.models.join(', ')}.
            {setup.movedTo &&
              ` This key belongs to ${new URL(setup.movedTo).host}, so Axon uses that address.`}
          </span>
        </div>
      );
    case 'failed':
      return (
        <div className="setup-status span-2 is-failed" role="alert">
          <Icon icon={CircleAlert} size="sm" />
          <span>{setup.message}</span>
        </div>
      );
  }
}

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
  const [setup, setSetup] = useState<Setup>({ state: 'idle' });
  /** Only the latest set-up may report; an older one finishing late is ignored. */
  const runs = useRef(0);
  /** The endpoint and key set-up last finished for, so a region move does not start it again. */
  const settled = useRef('');
  /** While Save runs its own check, the automatic one stands down. */
  const saving = useRef(false);

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

  /**
   * Set-up from the pasted key: finds the service's address that takes it (another region if need
   * be), picks models the key can use, and checks they answer. Returns what to save, or null.
   */
  type Connected = { ok: true; baseUrl: string; models: string[] } | { ok: false; message: string };
  const connect = async (): Promise<Connected | null> => {
    const target = provider;
    if (!target.baseUrl?.trim()) return null;
    const run = ++runs.current;
    const fail = (message: string): Connected => {
      if (run === runs.current) setSetup({ state: 'failed', message });
      return { ok: false, message };
    };
    const typed = key || undefined;
    setSetup({ state: 'checking' });
    try {
      const connected = await window.axon.providerConnect({ ...target, models: models.map(spec) }, typed);
      if (run !== runs.current) return null;
      const baseUrl = connected.baseUrl;
      let next = models;
      if (connected.models) {
        setFound({
          form: JSON.stringify([target.kind, baseUrl, key]),
          result: { models: connected.models, savedKeyWithheld: connected.savedKeyWithheld }
        });
        next = chooseModels(
          connected.models,
          models,
          PREFERENCES[preset?.name ?? 'Custom'] ?? PREFERENCES.Custom
        );
      }
      if (!next.length)
        return fail(
          isLocal(baseUrl)
            ? 'Connected, but this endpoint lists no chat models. Pull a model in Ollama or add a model ID below.'
            : 'The key works, but this endpoint lists no chat models. Add a model ID below.'
        );
      const tested = await window.axon.providerTest({ ...target, baseUrl, models: next.map(spec) }, typed);
      if (run !== runs.current) return null;
      const working = tested.results.filter((r) => r.ok).map((r) => r.modelId);
      if (!working.length) return fail(tested.results[0]?.error ?? 'None of the models answered.');
      settled.current = JSON.stringify([target.kind, baseUrl, key]);
      if (baseUrl !== target.baseUrl) setProvider((p) => ({ ...p, baseUrl }));
      setModels(working);
      setSetup({
        state: 'ready',
        models: working,
        movedTo: baseUrl !== target.baseUrl ? baseUrl : undefined
      });
      return { ok: true, baseUrl, models: working };
    } catch (err) {
      return fail(errorText(err));
    }
  };

  // Paste a key and the rest follows: once typing stops, set-up runs by itself. A key that names its
  // service picks the tile; a plain one waits for a tile. A local server (Ollama) needs no key.
  useEffect(() => {
    const typed = key.trim();
    if (!typed && !(isNew && isLocal(provider.baseUrl))) return setSetup({ state: 'idle' });
    if (!preset && isNew) {
      const named = PRESETS.find((p) => p.name === serviceFromKey(typed));
      if (named) return choosePreset(named);
      if (!provider.baseUrl?.trim()) return setSetup({ state: 'needs-service' });
    }
    if (settled.current === JSON.stringify([provider.kind, provider.baseUrl, key])) return;
    const timer = setTimeout(() => {
      if (!saving.current) void connect();
    }, SETUP_DELAY_MS);
    return () => clearTimeout(timer);
    // Set-up follows the service, the endpoint and the key; the model list is its output.
  }, [key, preset?.name, provider.kind, provider.baseUrl]);

  const save = async () => {
    saving.current = true;
    try {
      await saveChecked();
    } finally {
      saving.current = false;
    }
  };
  const saveChecked = async () => {
    setError('');
    if (!provider.baseUrl?.trim()) return setError('Choose a service above, or enter its endpoint.');
    if (isNew && !key.trim() && !isLocal(provider.baseUrl)) return setError('Paste your API key first.');
    if (!provider.name.trim()) return setError('Give this provider a name.');
    let target = { baseUrl: provider.baseUrl, models };
    // Not checked yet (or still checking): check now, so what is saved is what works.
    if (setup.state !== 'ready' && (key.trim() || (isNew && isLocal(provider.baseUrl)))) {
      const done = await connect();
      if (done?.ok) target = done;
      // A key the service refuses is not saved; other trouble (offline, a slow server) can be.
      else if (done && /\bHTTP 40[13]\b/.test(done.message))
        return setError(
          'The service did not accept this key. Check it (details under the key) and try again.'
        );
    }
    if (!target.models.length) return setError('Add at least one model.');
    try {
      await window.axon.providerSave(
        { ...provider, baseUrl: target.baseUrl, name: provider.name.trim(), models: target.models.map(spec) },
        key || undefined
      );
      await useApp.getState().refresh();
      // A provider just added is the one to use next.
      if (isNew) useApp.getState().patch({ model: `${provider.id}::${target.models[0]}` });
      useApp.getState().pushToast(isNew ? `${provider.name.trim()} is ready` : 'Provider saved');
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
                'Paste it as you copied it. Axon checks it and picks the models for you.'
              )}
            </span>
          </label>
          <SetupStatus
            setup={setup}
            service={preset?.name ?? provider.name}
            isKeyless={isLocal(provider.baseUrl)}
          />
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
            <span className="field-hint">
              Filled in by the service you choose. HTTPS, or http://localhost for a server on this computer.
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
