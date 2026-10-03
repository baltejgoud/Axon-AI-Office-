import './settings/settings.css';
import { useState, type ComponentType, type ReactNode } from 'react';
import type { MCPServerConfig, ProviderConfig, Settings } from '../../shared/types';
import { useApp, perform } from './state';
import {
  Button,
  EmptyState,
  Icon,
  IconBook,
  IconChartBar,
  IconCompose,
  IconCopy,
  IconHistory,
  IconKey,
  IconMic,
  IconMonitor,
  IconPalette,
  IconPlug,
  IconPlus,
  IconShield,
  IconSparkle,
  IconTrash,
  IconUser,
  Kbd,
  type AppIconProps
} from './ui';
import { followsTimeOfDay, setFollowsTimeOfDay } from './features/office/scene/room/lighting';
import {
  qualityPreference,
  setQualityPreference,
  type QualityMode
} from './features/office/scene/render/quality';
import {
  NumberSetting,
  Segmented,
  SettingRow,
  SettingsGroup,
  SliderSetting,
  Switch
} from './settings/controls';
import { ProviderDialog, protocolLabel, tintOf } from './settings/ProviderDialog';
import { McpDialog } from './settings/McpDialog';
import { ModelIcon } from './settings/ModelIcon';
import { AccountsSection } from './settings/AccountsSection';
import { ConnectorsSection } from './settings/ConnectorsSection';
import { ConnectorDialog } from './settings/ConnectorDialog';
import { UsageSection } from './settings/UsageSection';
import { ActivitySection } from './settings/ActivitySection';
import { RestorePoints } from './settings/RestorePoints';
import { useOfficeStore } from './features/office/store/officeStore';
import { DEFAULT_VOICE, SPEECH_LANGUAGES, chosenEngine, speechEngines } from '../../shared/speech';

type Section =
  | 'accounts'
  | 'models'
  | 'voice'
  | 'usage'
  | 'activity'
  | 'tools'
  | 'appearance'
  | 'system'
  | 'skills'
  | 'privacy';
const SECTIONS: readonly { id: Section; label: string; icon: ComponentType<AppIconProps> }[] = [
  { id: 'accounts', label: 'Accounts', icon: IconUser },
  { id: 'models', label: 'Models', icon: IconSparkle },
  { id: 'voice', label: 'Voice typing', icon: IconMic },
  { id: 'usage', label: 'Usage', icon: IconChartBar },
  { id: 'activity', label: 'Activity log', icon: IconHistory },
  { id: 'tools', label: 'Connectors', icon: IconPlug },
  { id: 'appearance', label: 'Appearance', icon: IconPalette },
  { id: 'system', label: 'System', icon: IconMonitor },
  { id: 'skills', label: 'Skills & roles', icon: IconBook },
  { id: 'privacy', label: 'Privacy & security', icon: IconShield }
];

const blankProvider = (): ProviderConfig => ({
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
  transport: 'http',
  command: '',
  args: [],
  env: {},
  headers: {},
  apiKey: '',
  url: '',
  enabled: true,
  coworkers: ['chats']
});

/** Settings, as a sheet over the office: sections on the left, the chosen one on the right. */
export function SettingsPanel() {
  const [section, setSection] = useState<Section>(
    () => (useOfficeStore.getState().settingsSection as Section | null) ?? 'models'
  );
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [mcpServer, setMcpServer] = useState<MCPServerConfig | null>(null);
  /** The connector whose Manage dialog is open. */
  const [managed, setManaged] = useState<string | null>(null);
  const needsSignIn = useApp(
    (s) => s.data?.mcpServers.some((m) => m.enabled && m.status === 'needs-sign-in') ?? false
  );

  return (
    <div className="settings">
      <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`settings-tab-${s.id}`}
            aria-controls="settings-content"
            aria-selected={s.id === section}
            className="settings-nav-item"
            onClick={() => setSection(s.id)}
          >
            <Icon icon={s.icon} size="md" />
            {s.label}
            {s.id === 'tools' && needsSignIn && (
              <span className="settings-nav-dot" title="A connector needs you to sign in" />
            )}
          </button>
        ))}
      </nav>
      <div
        className="settings-content"
        id="settings-content"
        role="tabpanel"
        aria-labelledby={`settings-tab-${section}`}
        key={section}
      >
        {section === 'accounts' && <AccountsSection />}
        {section === 'models' && <ModelsSection onEdit={setProvider} />}
        {section === 'voice' && <VoiceSection onModels={() => setSection('models')} />}
        {section === 'usage' && <UsageSection />}
        {section === 'activity' && <ActivitySection />}
        {section === 'tools' && (
          <ConnectorsSection onCustom={() => setMcpServer(blankMcp())} onManage={setManaged} />
        )}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'system' && <SystemSection />}
        {section === 'skills' && <SkillsSection />}
        {section === 'privacy' && <PrivacySection />}
      </div>
      {provider && <ProviderDialog initial={provider} onClose={() => setProvider(null)} />}
      {mcpServer && <McpDialog initial={mcpServer} onClose={() => setMcpServer(null)} />}
      {managed && (
        <ConnectorDialog
          serverId={managed}
          onClose={() => setManaged(null)}
          onEdit={(server) => {
            setManaged(null);
            setMcpServer(server);
          }}
        />
      )}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="settings-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

/** Saves one change to the app settings. */
function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const settings = useApp((s) => s.data!.settings);
  return [settings, (patch) => void perform(() => window.axon.settingsSave({ ...settings, ...patch }))];
}

// ---------------------------------------------------------------- Models

function ModelsSection({ onEdit }: { onEdit: (p: ProviderConfig) => void }) {
  const providers = useApp((s) => s.data!.providers);
  const [settings, save] = useSettings();
  return (
    <div className="settings-page">
      <SectionHeader
        title="Models"
        description="Connect the AI services your coworkers think with. Bring your own keys: they stay in your system's key store."
        action={
          <Button variant="primary" icon={IconPlus} onClick={() => onEdit(blankProvider())}>
            Add provider
          </Button>
        }
      />
      {providers.length ? (
        <SettingsGroup title="Providers">
          {providers.map((p) => (
            <div className="settings-item" key={p.id}>
              <span className={`preset-mark tint-${tintOf(p)}`} aria-hidden="true">
                <ModelIcon name={p.name} size={18} fallback={p.name.slice(0, 1).toUpperCase()} />
              </span>
              <div className="settings-item-main">
                <div className="settings-item-title">
                  {p.name}
                  {!p.hasApiKey && !/localhost|127\.0\.0\.1/.test(p.baseUrl ?? '') && (
                    <span className="badge badge-warning">No key</span>
                  )}
                </div>
                <div className="settings-item-meta">
                  {protocolLabel(p.kind)} · {p.models.length} model{p.models.length === 1 ? '' : 's'}
                  {p.models.length ? `: ${p.models.map((m) => m.id).join(', ')}` : ''}
                </div>
              </div>
              <div className="settings-item-actions">
                <Switch
                  checked={p.enabled}
                  label={`${p.name} enabled`}
                  onChange={() =>
                    void perform(
                      () => window.axon.providerSave({ ...p, enabled: !p.enabled }),
                      p.enabled ? `${p.name} turned off` : `${p.name} turned on`
                    )
                  }
                />
                <Button size="sm" variant="ghost" icon={IconCompose} onClick={() => onEdit(p)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={IconTrash}
                  iconOnly
                  className="danger-hover"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    if (confirm(`Remove ${p.name} and its saved key?`))
                      void perform(() => window.axon.providerDelete(p.id), 'Provider removed');
                  }}
                />
              </div>
            </div>
          ))}
        </SettingsGroup>
      ) : (
        <div className="settings-card settings-empty">
          <EmptyState
            icon={IconKey}
            title="No models connected yet"
            description="Add Kimi, Qwen, OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, a local Ollama, or any OpenAI-compatible service."
            action={
              <Button variant="primary" icon={IconPlus} onClick={() => onEdit(blankProvider())}>
                Add provider
              </Button>
            }
          />
        </div>
      )}
      <SettingsGroup title="Answers">
        <SettingRow
          label="Quick replies"
          hint="Models skip their thinking where they can, so answers come back in seconds. Some, like Stealth, always think. Turn off for harder work."
        >
          <Switch
            checked={settings.quickReplies !== false}
            label="Quick replies"
            onChange={(quickReplies) => save({ quickReplies })}
          />
        </SettingRow>
        <SettingRow
          label="Max tokens"
          id="setting-max-tokens"
          hint="The longest answer a model may write. Models that think first (Kimi, DeepSeek Reasoner) always get at least 16,384."
        >
          <NumberSetting
            id="setting-max-tokens"
            value={settings.defaultMaxTokens}
            min={256}
            max={128000}
            step={256}
            onCommit={(defaultMaxTokens) => save({ defaultMaxTokens })}
          />
        </SettingRow>
        <SettingRow
          label="Temperature"
          hint="Lower is more exact, higher is more varied. Some models fix their own."
        >
          <SliderSetting
            label="Temperature"
            value={settings.defaultTemperature}
            min={0}
            max={2}
            step={0.1}
            onCommit={(defaultTemperature) => save({ defaultTemperature })}
          />
        </SettingRow>
        <SettingRow label="Name conversations" hint="Title each new conversation from your first message.">
          <Switch
            checked={settings.autoTitleConversations}
            label="Name conversations"
            onChange={(autoTitleConversations) => save({ autoTitleConversations })}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

// ---------------------------------------------------------------- Voice typing

function VoiceSection({ onModels }: { onModels: () => void }) {
  const providers = useApp((s) => s.data!.providers);
  const [settings, save] = useSettings();
  const voice = { ...DEFAULT_VOICE, ...settings.voice };
  const engines = speechEngines(providers);
  const engine = chosenEngine(providers, settings.voice);
  return (
    <div className="settings-page">
      <SectionHeader
        title="Voice typing"
        description="Speak in any chat box and your words are typed out for you to check before sending. Click the microphone or press Ctrl+M; press Enter when you're done."
      />
      {engine ? (
        <SettingsGroup title="Transcription">
          <SettingRow
            label="Engine"
            id="setting-voice-engine"
            hint="The service that turns your speech into text, with a key you added in Models. The first choice for each service is its most accurate."
          >
            <select
              id="setting-voice-engine"
              className="select"
              value={`${engine.providerId}::${engine.model.id}`}
              onChange={(e) => {
                const [providerId, ...model] = e.target.value.split('::');
                save({ voice: { ...voice, providerId, model: model.join('::') } });
              }}
            >
              {engines.map((e) => (
                <option key={`${e.providerId}::${e.model.id}`} value={`${e.providerId}::${e.model.id}`}>
                  {e.providerName} · {e.model.label}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label="Language"
            id="setting-voice-language"
            hint="The language you speak. Naming it is more accurate than detecting it, especially for short messages."
          >
            <select
              id="setting-voice-language"
              className="select"
              value={voice.language}
              onChange={(e) => save({ voice: { ...voice, language: e.target.value } })}
            >
              {SPEECH_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingsGroup>
      ) : (
        <div className="settings-card settings-empty">
          <EmptyState
            icon={IconMic}
            title="Voice typing needs a transcription key"
            description="Add a Groq key (Whisper large v3) or an OpenAI key (GPT-4o Transcribe) in Models. Groq is fast and costs about 11 cents an hour of speech."
            action={
              <Button variant="primary" icon={IconSparkle} onClick={onModels}>
                Open Models
              </Button>
            }
          />
        </div>
      )}
      <SettingsGroup title="Keys">
        <SettingRow label="Start, or finish and type it out">
          <Kbd keys="Ctrl M" />
        </SettingRow>
        <SettingRow label="Finish and type it out">
          <Kbd keys="Enter" />
        </SettingRow>
        <SettingRow label="Cancel the recording">
          <Kbd keys="Esc" />
        </SettingRow>
      </SettingsGroup>
      <p className="settings-footnote">
        Each recording goes to {engine ? engine.providerName : 'the service you choose'} to be transcribed,
        along with a short list of names and terms from the conversation so they are spelled right. Axon does
        not keep the recording.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Appearance

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
] as const;
const QUALITIES = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'balanced', label: 'Balanced' }
] as const;

function AppearanceSection() {
  const [settings, save] = useSettings();
  const [followClock, setFollowClock] = useState(followsTimeOfDay);
  const [quality, setQuality] = useState<QualityMode>(qualityPreference);
  return (
    <div className="settings-page">
      <SectionHeader title="Appearance" description="How Axon and the office look." />
      <SettingsGroup title="App">
        <SettingRow label="Theme" hint="System follows your computer's light or dark mode.">
          <Segmented
            label="Theme"
            value={settings.theme}
            options={THEMES}
            onChange={(theme) => save({ theme })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Office">
        <SettingRow
          label="Follow the time of day"
          hint="Morning light, golden evenings and lamps at night, and the office's day: standups, lunch and breaks."
        >
          <Switch
            checked={followClock}
            label="Follow the time of day"
            onChange={(on) => {
              setFollowClock(on);
              setFollowsTimeOfDay(on);
            }}
          />
        </SettingRow>
        <SettingRow
          label="Quality"
          hint="High draws the office sharper, with finer shadows. Auto switches to Balanced if the office runs slowly."
        >
          <Segmented
            label="Office quality"
            value={quality}
            options={QUALITIES}
            onChange={(mode) => {
              setQuality(mode);
              setQualityPreference(mode);
            }}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

// ---------------------------------------------------------------- System

function SystemSection() {
  const [settings, save] = useSettings();
  const startAvailable = useApp((s) => s.data!.startWithWindowsAvailable);
  return (
    <div className="settings-page">
      <SectionHeader title="System" description="How Axon runs on this computer." />
      <SettingsGroup title="Running">
        <SettingRow
          label="Keep running in the tray"
          hint="Closing the window keeps Axon in the tray. Reminders only arrive while Axon is running."
        >
          <Switch
            checked={settings.keepInTray}
            label="Keep running in the tray"
            onChange={(keepInTray) => save({ keepInTray })}
          />
        </SettingRow>
        <SettingRow
          label="Start with Windows"
          hint={startAvailable ? 'Opens in the tray when you sign in.' : 'Available in the installed app.'}
        >
          <Switch
            checked={settings.startWithWindows}
            disabled={!startAvailable}
            label="Start with Windows"
            onChange={(startWithWindows) => save({ startWithWindows })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Keyboard shortcuts">
        <SettingRow label="Find a coworker">
          <Kbd keys="Mod K" />
        </SettingRow>
        <SettingRow label="Open settings">
          <Kbd keys="Mod ," />
        </SettingRow>
        <SettingRow label="Close a sheet or dialog">
          <Kbd keys="Esc" />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

// ---------------------------------------------------------------- Skills & roles

function SkillsSection() {
  const skills = useApp((s) => s.data!.skills);
  const roles = useApp((s) => s.data!.roles);
  const stats = [
    {
      value: skills.length,
      label: 'skills',
      detail: `in ${new Set(skills.map((s) => s.category)).size} categories`
    },
    { value: roles.length, label: 'roles', detail: `in ${new Set(roles.map((r) => r.group)).size} groups` }
  ];
  return (
    <div className="settings-page">
      <SectionHeader
        title="Skills & roles"
        description="Know-how bundled with Axon. Attach skills and roles to a workspace or a conversation; they run on the model you choose."
      />
      <div className="settings-stats">
        {stats.map((stat) => (
          <div className="settings-card settings-stat" key={stat.label}>
            <div className="settings-stat-value">{stat.value.toLocaleString()}</div>
            <div className="settings-stat-label">
              {stat.label} <span>{stat.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="settings-footnote">
        Skills come from open-licensed collections, with prompt-injection protections applied; their licences
        are listed in src/skills/LICENSES.md. Roles are written for Axon.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Privacy & security

function PrivacySection() {
  const [settings, save] = useSettings();
  const dataPath = useApp((s) => s.data!.dataPath);
  return (
    <div className="settings-page">
      <SectionHeader title="Privacy & security" description="What Axon may do, and where your data lives." />
      <SettingsGroup title="Permissions">
        <SettingRow
          label="Allow shell commands"
          hint="Coworkers may run commands in your project folder. Each command asks you first."
        >
          <Switch
            checked={settings.allowShellExecution}
            label="Allow shell commands"
            onChange={(allowShellExecution) => save({ allowShellExecution })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Your data">
        <div className="settings-prose">
          <ul>
            <li>API keys are encrypted with your system's key store and never shown again.</li>
            <li>
              Conversations and your library are stored on this computer, unencrypted: use full-disk
              encryption to protect them.
            </li>
            <li>Messages, attachments and library passages go only to the model provider you choose.</li>
            <li>No telemetry or tracking. Nothing runs on a schedule.</li>
            <li>Writing to project files asks you first; sensitive files and symbolic links are blocked.</li>
          </ul>
        </div>
        <SettingRow
          label="Data folder"
          hint="Close Axon before backing it up. Saved keys don't move to another computer. Delete the folder to reset Axon."
          stacked
        >
          <div className="settings-path">
            <span>{dataPath}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={IconCopy}
              onClick={() =>
                void navigator.clipboard
                  .writeText(dataPath)
                  .then(() => useApp.getState().pushToast('Folder path copied'))
              }
            >
              Copy
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>
      <RestorePoints />
      <p className="settings-footnote">Axon is in beta: import only documents you trust.</p>
    </div>
  );
}
