import { useState } from 'react';
import {
  WEB_PROVIDERS,
  isWebKeyProvider,
  normalWebAccess,
  type WebAccessSettings,
  type WebSearchProvider
} from '../../../shared/webAccess';
import { perform, useApp } from '../state';
import { Button, Icon, IconLock } from '../ui';
import { LinkButton } from './AccountsSection';
import { Segmented, SettingRow, SettingsGroup, Switch } from './controls';

const PROVIDER_OPTIONS = WEB_PROVIDERS.map((p) => ({ value: p.id, label: p.label }));

/**
 * Settings → Web access: whether coworkers (and your own chats) may search the web and read public
 * pages, which search service they use, and its key when it needs one. The key goes to the system
 * key store and never comes back to this window; only whether one is saved does.
 */
export function WebAccessSection() {
  const settings = useApp((s) => s.data!.settings);
  const savedKeys = useApp((s) => s.data!.webKeys ?? []);
  const web = normalWebAccess(settings.webAccess);
  const info = WEB_PROVIDERS.find((p) => p.id === web.provider) ?? WEB_PROVIDERS[0];
  const [key, setKey] = useState('');
  const hasKey = isWebKeyProvider(web.provider) && savedKeys.includes(web.provider);

  const save = (patch: Partial<WebAccessSettings>) =>
    void perform(() => window.axon.settingsSave({ ...settings, webAccess: { ...web, ...patch } }));
  const saveKey = () => {
    if (!isWebKeyProvider(web.provider) || !key.trim()) return;
    const provider = web.provider;
    void perform(async () => {
      await window.axon.webKeySave(provider, key);
      setKey('');
    }, `${info.label} key saved`);
  };
  const removeKey = () => {
    if (!isWebKeyProvider(web.provider)) return;
    const provider = web.provider;
    void perform(() => window.axon.webKeySave(provider, ''), `${info.label} key removed`);
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Web access</h3>
          <p>
            Your coworkers can look things up online: search the web and read public pages, then say where
            they found it. Searches and page requests go to the search service and the sites themselves; your
            files and conversations are not sent.
          </p>
        </div>
      </header>
      <SettingsGroup title="Coworkers on the web">
        <SettingRow
          label="Let coworkers search the web and read pages"
          hint="Every coworker, and your own chats, can find current facts and sources. Each search and page shows in the Activity log. Pages on private or local networks are never opened."
        >
          <Switch
            checked={web.enabled}
            label="Let coworkers search the web and read pages"
            onChange={(enabled) => save({ enabled })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Search service">
        <SettingRow
          label="Search with"
          hint={
            <>
              {info.hint}
              {info.needsKey && !hasKey && (
                <>
                  {' '}
                  <span className="badge badge-warning">No key yet</span> Searches won't work until you add
                  one.
                </>
              )}
            </>
          }
        >
          <Segmented<WebSearchProvider>
            label="Search service"
            value={web.provider}
            options={PROVIDER_OPTIONS}
            onChange={(provider) => {
              setKey('');
              save({ provider });
            }}
          />
        </SettingRow>
        {info.needsKey && (
          <SettingRow
            label={`${info.label} API key`}
            id="web-search-key"
            stacked
            hint={
              <>
                {hasKey
                  ? 'A key is saved. Paste a new one to replace it, or remove it.'
                  : 'Paste your key to turn this service on.'}{' '}
                {info.keyUrl && (
                  <LinkButton url={info.keyUrl}>{`Get a key at ${new URL(info.keyUrl).hostname}`}</LinkButton>
                )}
              </>
            }
          >
            <div className="web-key">
              <input
                id="web-search-key"
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  hasKey ? '•••••••• saved — type to replace' : (info.keyPlaceholder ?? 'Paste your key')
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveKey();
                  }
                }}
              />
              <Button variant="primary" disabled={!key.trim()} onClick={saveKey}>
                Save key
              </Button>
              {hasKey && (
                <Button variant="ghost" className="danger-hover" onClick={removeKey}>
                  Remove
                </Button>
              )}
            </div>
            <p className="web-key-note">
              <Icon icon={IconLock} size="sm" /> Kept in your system key store; sent only to {info.label}.
            </p>
          </SettingRow>
        )}
      </SettingsGroup>
      <p className="settings-footnote">
        What a page says is treated as information, never as instructions: coworkers are told to name their
        sources and not to follow anything a page asks of them.
      </p>
    </div>
  );
}
