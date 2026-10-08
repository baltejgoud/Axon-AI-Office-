import { useEffect, useState } from 'react';
import type { ClaudeRateLimits, ProviderConfig, RateLimit } from '../../../shared/types';
import { errorText } from '../accounts';
import { timeAgo } from '../format';
import { useApp } from '../state';
import {
  Button,
  Icon,
  IconAlertCircle,
  IconExternalLink,
  IconInfo,
  IconKey,
  IconLoader,
  IconLock,
  Modal
} from '../ui';
import { ModelIcon } from './ModelIcon';

/**
 * Anthropic's own pages, the only sources for what this card claims about sign-in and billing.
 * Third-party apps may not offer Claude account sign-in or use Claude plan limits; Max and Team
 * plans include monthly API credits once a Console organization is linked.
 */
const LINKS = {
  policy: 'https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use',
  credits: 'https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers',
  keys: 'https://platform.claude.com/settings/keys',
  billing: 'https://platform.claude.com/settings/billing',
  limits: 'https://platform.claude.com/usage/limits',
  workspaces: 'https://platform.claude.com/settings/workspaces'
};

const open = (url: string) => void window.axon.openLink(url);
const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const short = (id: string, length = 13) => (id.length > length + 1 ? `${id.slice(0, length)}…` : id);

function Link({ url, children }: { url: string; children: string }) {
  return (
    <button type="button" className="account-link" onClick={() => open(url)}>
      {children}
    </button>
  );
}

/** Settings → Accounts → Claude: a Claude Console API key, said plainly as API access with its own billing. */
export function ClaudeCard({ onEditModels }: { onEditModels: (provider: ProviderConfig) => void }) {
  const provider = useApp((s) => s.data?.providers.find((p) => p.claudeConsole));
  /** An Anthropic key added before this card existed, in Models & API keys. */
  const other = useApp((s) =>
    s.data?.providers.find(
      (p) =>
        !p.claudeConsole &&
        p.kind === 'anthropic' &&
        /^https:\/\/api\.anthropic\.com(\/|$)/.test(p.baseUrl ?? '')
    )
  );
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'status' | 'alert'; link?: boolean } | null>(null);
  const [limits, setLimits] = useState<ClaudeRateLimits | null>(null);
  const identity = provider?.claudeConsole;
  useEffect(() => {
    if (!provider) return setLimits(null);
    void window.axon.claudeLimits().then(setLimits, () => setLimits(null));
  }, [provider?.id, identity?.verifiedAt]);
  useEffect(() => () => void window.axon.claudeCancel(), []);

  const action = async (task: () => Promise<unknown>, success: string, link?: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      await task();
      await useApp.getState().refresh();
      setNote({ text: success, tone: 'status', link });
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setNote({ text: message, tone: 'alert' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="subscription-card claude-card" aria-label="Claude">
      <header>
        <span className="preset-mark tint-anthropic">
          <ModelIcon name="Claude" size={22} />
        </span>
        <h4>Claude</h4>
        <span className={`badge ${provider ? 'badge-accent' : 'badge-outline'}`}>
          {provider ? 'Connected' : 'API key'}
        </span>
      </header>
      {provider && identity ? (
        <dl className="subscription-facts">
          <div>
            <dt>Account</dt>
            <dd>
              <span className="fact-line" title={identity.organizationId}>
                {identity.organizationId
                  ? `Console organization ${short(identity.organizationId, 8)}`
                  : 'Claude Console API key'}
              </span>
              {(provider.workspaceId ?? identity.workspaceId) && (
                <span className="fact-line" title={provider.workspaceId ?? identity.workspaceId}>
                  Workspace {short(provider.workspaceId ?? identity.workspaceId!)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>Billing</dt>
            <dd>
              API usage, billed to this organization. A linked Max or Team plan's monthly API credits go
              first; Claude plan usage limits aren't used.
            </dd>
          </div>
          <div>
            <dt>Limits</dt>
            <dd>
              {limits ? (
                <LimitsLine limits={limits} />
              ) : (
                "Rate limits and the monthly spend cap follow the organization's usage tier."
              )}
            </dd>
          </div>
          <div>
            <dt>Models</dt>
            <dd>
              {provider.models.length} available · checked{' '}
              {timeAgo(identity.verifiedAt) === 'now' ? 'just now' : `${timeAgo(identity.verifiedAt)} ago`}
            </dd>
          </div>
        </dl>
      ) : (
        <>
          <p>
            Anthropic doesn't let third-party apps sign in to Claude accounts or use Claude plan limits, so
            Axon connects with a Claude Console API key. Usage is billed to that Console organization,
            separately from any Claude subscription.
          </p>
          <p className="subscription-tip">
            <Icon icon={IconInfo} size="sm" />
            <span>
              On Max or Team? Your plan includes monthly API credits for a Console organization you link to
              it. <Link url={LINKS.credits}>How to claim them</Link>
            </span>
          </p>
          {other && (
            <p className="subscription-status">
              An Anthropic key is also set up as “{other.name}” in Models & API keys.
            </p>
          )}
        </>
      )}
      <div className="subscription-actions">
        {provider ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void action(() => window.axon.claudeRefreshModels(), 'Models and account checked again.')
              }
            >
              {busy ? (
                <>
                  <IconLoader className="spin" size={14} /> Checking…
                </>
              ) : (
                'Refresh models'
              )}
            </Button>
            {busy && (
              <Button size="sm" variant="ghost" onClick={() => void window.axon.claudeCancel()}>
                Cancel
              </Button>
            )}
            <Button size="sm" icon={IconKey} disabled={busy} onClick={() => setDialog(true)}>
              Replace key
            </Button>
            <Button size="sm" disabled={busy} onClick={() => onEditModels(provider)}>
              Prices & budgets
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="danger-hover"
              disabled={busy}
              onClick={() =>
                void action(
                  () => window.axon.claudeDisconnect(),
                  'Disconnected. Axon deleted its copy of the key; the key itself works until you disable or delete it in Claude Console.',
                  true
                )
              }
            >
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" icon={IconKey} onClick={() => setDialog(true)}>
              Connect Claude API key
            </Button>
            <Button size="sm" variant="ghost" icon={IconExternalLink} onClick={() => open(LINKS.keys)}>
              Get a key
            </Button>
          </>
        )}
      </div>
      {note && (
        <p role={note.tone} className={note.tone === 'alert' ? 'subscription-error' : 'subscription-status'}>
          {note.text} {note.link && <Link url={LINKS.keys}>Open API keys</Link>}
        </p>
      )}
      <div className="subscription-links">
        {provider ? (
          <>
            <Link url={LINKS.billing}>Billing</Link>
            <Link url={LINKS.limits}>Rate limits</Link>
            <Link url={LINKS.keys}>API keys</Link>
          </>
        ) : (
          <Link url={LINKS.policy}>Why not Claude sign-in?</Link>
        )}
      </div>
      {dialog && (
        <ClaudeKeyDialog
          provider={provider}
          onClose={() => setDialog(false)}
          onConnected={(text) => {
            setDialog(false);
            setNote({ text, tone: 'status' });
          }}
        />
      )}
    </article>
  );
}

function LimitsLine({ limits }: { limits: ClaudeRateLimits }) {
  const part = (label: string, l?: RateLimit) =>
    l && `${compact(l.remaining)} of ${compact(l.limit)} ${label}`;
  const parts = [
    part('requests', limits.requests),
    part('input tokens', limits.inputTokens),
    part('output tokens', limits.outputTokens)
  ].filter(Boolean);
  return (
    <>
      {parts.join(' · ')} left per minute for {limits.model}, as of the last request (
      {timeAgo(limits.at) === 'now' ? 'just now' : `${timeAgo(limits.at)} ago`}).
    </>
  );
}

/** Paste a key; Axon checks it with Anthropic's free model list before saving it. No message is sent. */
function ClaudeKeyDialog({
  provider,
  onClose,
  onConnected
}: {
  provider?: ProviderConfig;
  onClose: () => void;
  onConnected: (note: string) => void;
}) {
  const [key, setKey] = useState('');
  const [workspace, setWorkspace] = useState(provider?.workspaceId ?? '');
  const [askWorkspace, setAskWorkspace] = useState(Boolean(provider?.workspaceId));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  /** Anthropic asked which workspace a multi-workspace key should run in. */
  const [workspaceNote, setWorkspaceNote] = useState('');
  const close = () => {
    void window.axon.claudeCancel();
    onClose();
  };
  const connect = async () => {
    if (checking) return;
    if (!key.trim()) return setError('Paste your Claude Console API key first.');
    setChecking(true);
    setError('');
    setWorkspaceNote('');
    try {
      const result = await window.axon.claudeConnect({
        key,
        ...(workspace.trim() ? { workspaceId: workspace } : {})
      });
      if (!result.ok) {
        setAskWorkspace(true);
        setWorkspaceNote(result.message);
        return;
      }
      await useApp.getState().refresh();
      onConnected(
        `Claude connected · ${result.models} model${result.models === 1 ? '' : 's'}. Choose them in chat.` +
          (result.organizationChanged
            ? ' This key belongs to a different Console organization than the last one.'
            : '')
      );
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setChecking(false);
    }
  };
  return (
    <Modal
      title={provider ? 'Replace Claude API key' : 'Connect Claude'}
      description="Paste an API key from Claude Console. Axon checks it with Anthropic's model list, which is free: no message is sent."
      onClose={close}
      onSubmit={() => void connect()}
      submitLabel={checking ? 'Checking…' : provider ? 'Replace key' : 'Connect'}
      submitDisabled={checking}
      footerStart={
        <span className="text-caption">
          <Icon icon={IconLock} size="sm" /> Stored in your system key store; sent only to api.anthropic.com.
        </span>
      }
    >
      {error && (
        <div className="banner-error" role="alert">
          <Icon icon={IconAlertCircle} size="sm" />
          <span>{error}</span>
        </div>
      )}
      <label className="field">
        API key
        <input
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-api03-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <span className="field-hint">
          Create one in <Link url={LINKS.keys}>Claude Console → API keys</Link>. A key from the organization
          linked to your Max or Team plan uses its monthly API credits first.
        </span>
      </label>
      {askWorkspace ? (
        <label className="field">
          Workspace ID
          <input
            className="input"
            spellCheck={false}
            placeholder="wrkspc_…"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          />
          <span className="field-hint">
            Needed only for a key that works in several workspaces. Find it in{' '}
            <Link url={LINKS.workspaces}>Claude Console → Workspaces</Link>.
          </span>
          {workspaceNote && (
            <span className="setup-status claude-workspace-note" role="status">
              <Icon icon={IconInfo} size="sm" />
              <span>{workspaceNote}</span>
            </span>
          )}
        </label>
      ) : (
        <button type="button" className="link-button" onClick={() => setAskWorkspace(true)}>
          My key works in several workspaces
        </button>
      )}
      <div className="claude-billing-note" role="note">
        <strong>Billing:</strong> requests are Claude API usage, billed to the key's Console organization at
        API prices. They don't use your Claude Pro, Max or Team usage limits, and they aren't charged to your
        Claude plan.
      </div>
      {checking && (
        <div className="setup-status" role="status">
          <Icon icon={IconLoader} size="sm" className="spin" />
          <span>Checking the key with Anthropic and finding its models…</span>
        </div>
      )}
    </Modal>
  );
}
