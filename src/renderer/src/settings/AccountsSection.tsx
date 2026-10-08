import { useEffect, useState, type ReactNode } from 'react';
import type { AccountProfile, DeviceCode } from '../../../shared/scm';
import type { ProviderConfig } from '../../../shared/types';
import { errorText, useAccounts } from '../accounts';
import { useApp } from '../state';
import {
  Button,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconGitBranch,
  IconGitHub,
  IconGoogle,
  IconLoader,
  IconKey,
  IconUser
} from '../ui';
import { SettingsGroup } from './controls';
import { AccountAppDialog } from './AccountAppDialog';
import { ClaudeCard } from './ClaudeAccount';
import { ModelIcon } from './ModelIcon';
import { PRESETS } from './ProviderDialog';

/** Settings → Accounts: GitHub for your repositories, Google for who you are, and the Git they both need. */
export function AccountsSection({ onAddProvider }: { onAddProvider: (provider: ProviderConfig) => void }) {
  const { accounts, refresh } = useAccounts();
  /** After signing out of GitHub: how to withdraw Axon's access there too. */
  const [revokeHint, setRevokeHint] = useState(false);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Accounts</h3>
          <p>
            Connect model accounts and the services your coworkers use. Model access and repository sign-ins
            are managed separately.
          </p>
        </div>
      </header>
      <ModelAccounts onAddProvider={onAddProvider} />
      {!accounts ? (
        <p className="account-note">Loading…</p>
      ) : (
        <>
          <SettingsGroup title="GitHub">
            {accounts.github.profile ? (
              <SignedIn
                profile={accounts.github.profile}
                meta={`@${accounts.github.profile.login} · can read and push your repositories`}
                onSignOut={async () => {
                  await window.axon.githubSignOut();
                  setRevokeHint(true);
                  await refresh();
                }}
              />
            ) : (
              <GitHubSignIn
                onDone={refresh}
                configured={accounts.github.configured}
                ownApp={accounts.github.ownApp}
                note={
                  revokeHint && (
                    <>
                      Axon forgot its GitHub key. To withdraw Axon's access on GitHub too, open{' '}
                      <LinkButton url="https://github.com/settings/applications">
                        Authorized OAuth Apps
                      </LinkButton>
                      .
                    </>
                  )
                }
              />
            )}
          </SettingsGroup>
          <SettingsGroup title="Google">
            {accounts.google.profile ? (
              <SignedIn
                profile={accounts.google.profile}
                meta={accounts.google.profile.email}
                actions={<ConnectGmail />}
                onSignOut={async () => {
                  await window.axon.googleSignOut();
                  await refresh();
                }}
              />
            ) : (
              <GoogleSignIn
                onDone={refresh}
                configured={accounts.google.configured}
                ownApp={accounts.google.ownApp}
              />
            )}
          </SettingsGroup>
          <SettingsGroup title="Git">
            <GitRow version={accounts.git} onCheck={refresh} />
          </SettingsGroup>
        </>
      )}
    </div>
  );
}

function ModelAccounts({ onAddProvider }: { onAddProvider: (p: ProviderConfig) => void }) {
  const provider = useApp((s) => s.data?.providers.find((p) => p.auth === 'chatgpt'));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(
    () => () => {
      void window.axon.chatgptCancel();
    },
    []
  );
  const action = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await task();
      await useApp.getState().refresh();
      setNote(success);
    } catch (err) {
      setError(errorText(err));
      await useApp.getState().refresh();
    } finally {
      setBusy(false);
    }
  };
  const addKey = (name: string) => {
    const preset = PRESETS.find((p) => p.name === name)!;
    onAddProvider({
      id: crypto.randomUUID(),
      name: preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      models: preset.models.map((id) => ({ id, displayName: id })),
      enabled: true,
      createdAt: Date.now(),
      hasApiKey: false
    });
  };
  return (
    <section className="settings-group" aria-label="AI model accounts">
      <h4 className="settings-group-title">AI model accounts</h4>
      <div className="subscription-grid">
        <article className="subscription-card">
          <header>
            <span className="preset-mark tint-openai">
              <ModelIcon name="ChatGPT" size={22} />
            </span>
            <h4>ChatGPT</h4>
          </header>
          <p>
            Use an eligible ChatGPT plan through OpenAI’s official sign-in. Available models come from your
            account; requests count toward its limits.
          </p>
          {provider && (
            <p className="subscription-status">
              {provider.accountLabel} · {provider.models.length} models connected
            </p>
          )}
          <div className="subscription-actions">
            <Button
              disabled={busy}
              variant="primary"
              onClick={() =>
                void action(
                  () => window.axon.chatgptSignIn(),
                  'ChatGPT connected. Choose its models in chat.'
                )
              }
            >
              {busy ? (
                <>
                  <IconLoader className="spin" size={14} /> Connecting…
                </>
              ) : (
                <>
                  <ModelIcon name="ChatGPT" size={16} />{' '}
                  {provider ? 'Reconnect ChatGPT' : 'Continue with ChatGPT'}
                </>
              )}
            </Button>
            {busy && <Button onClick={() => void window.axon.chatgptCancel()}>Cancel</Button>}
            {provider && (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(() => window.axon.chatgptRefreshModels(), 'Available models updated.')
                  }
                >
                  Refresh models
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result = await window.axon.chatgptSignOut();
                      if (!result.remoteRevoked)
                        throw new Error(
                          'Signed out locally. Remote revocation was not confirmed; disconnect Axon in ChatGPT settings.'
                        );
                    }, 'ChatGPT disconnected.')
                  }
                >
                  Sign out
                </Button>
              </>
            )}
            {!provider && (
              <Button size="sm" icon={IconKey} onClick={() => addKey('OpenAI')}>
                Use API key
              </Button>
            )}
          </div>
          {(note || error) && (
            <p
              role={error ? 'alert' : 'status'}
              className={error ? 'subscription-error' : 'subscription-status'}
            >
              {error || note}
            </p>
          )}
          <LinkButton url="https://developers.openai.com/siwc/token-sharing-open-source">
            Plan access details
          </LinkButton>
        </article>
        <ClaudeCard onEditModels={onAddProvider} />
      </div>
    </section>
  );
}

function Avatar({ profile, size = 40 }: { profile: AccountProfile; size?: number }) {
  return profile.avatar ? (
    <img className="account-avatar" src={profile.avatar} alt="" width={size} height={size} />
  ) : (
    <span
      className="account-avatar account-avatar-blank"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <IconUser size={size / 2} />
    </span>
  );
}

function SignedIn({
  profile,
  meta,
  actions,
  onSignOut
}: {
  profile: AccountProfile;
  meta: string;
  /** More buttons beside Sign out. */
  actions?: ReactNode;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pushToast = useApp((s) => s.pushToast);
  return (
    <div className="settings-item">
      <Avatar profile={profile} />
      <div className="settings-item-main">
        <div className="settings-item-title">{profile.name}</div>
        <div className="settings-item-meta">{meta}</div>
      </div>
      <div className="settings-item-actions">
        {actions}
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSignOut();
              pushToast('Signed out');
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}

function GitHubSignIn({
  onDone,
  note,
  configured,
  ownApp
}: {
  onDone: () => Promise<void>;
  note?: ReactNode;
  /** Axon has a GitHub app to sign in with; without one, the button sets it up first. */
  configured: boolean;
  ownApp: boolean;
}) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [setup, setSetup] = useState(false);
  const pushToast = useApp((s) => s.pushToast);
  // Leaving Settings mid-sign-in stops the wait.
  useEffect(() => () => void window.axon.githubSignInCancel(), []);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const device = await window.axon.githubSignInStart();
      setCode(device);
      const profile = await window.axon.githubSignInFinish();
      pushToast(`Signed in to GitHub as @${profile.login}`);
      await onDone();
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setBusy(false);
      setCode(null);
    }
  };

  if (code)
    return (
      <div className="settings-row is-stacked account-device">
        <div className="settings-row-text">
          <span className="settings-row-label">Enter this code on GitHub</span>
          <p className="settings-row-hint">
            Your browser opened <strong>github.com/login/device</strong>. Type or paste the code there, then
            approve Axon. This page carries on by itself.
          </p>
        </div>
        <div className="account-device-code">
          <code aria-label="Your GitHub sign-in code">{code.userCode}</code>
          <Button
            size="sm"
            icon={copied ? IconCheck : IconCopy}
            onClick={() => {
              void navigator.clipboard.writeText(code.userCode);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={IconExternalLink}
            onClick={() => void window.axon.openLink(code.verificationUri)}
          >
            Open GitHub again
          </Button>
        </div>
        <div className="account-waiting">
          <IconLoader size={14} className="spin" />
          Waiting for you to approve on GitHub…
          <Button size="sm" variant="ghost" onClick={() => void window.axon.githubSignInCancel()}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div className="settings-item">
      <span className="account-mark" aria-hidden="true">
        <IconGitHub size={22} />
      </span>
      <div className="settings-item-main">
        <div className="settings-item-title">Not signed in</div>
        <div className="settings-item-meta">For clone, publish, sync and the GitHub connector.</div>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        {note && <p className="account-note">{note}</p>}
      </div>
      <div className="settings-item-actions">
        {ownApp && (
          <Button size="sm" variant="ghost" onClick={() => setSetup(true)}>
            Change app
          </Button>
        )}
        <Button
          variant="primary"
          icon={IconGitHub}
          disabled={busy}
          onClick={() => (configured ? void start() : setSetup(true))}
        >
          Sign in with GitHub
        </Button>
      </div>
      {setup && (
        <AccountAppDialog
          kind="github"
          onClose={() => setSetup(false)}
          onSaved={() => {
            setSetup(false);
            void start();
          }}
        />
      )}
    </div>
  );
}

function GoogleSignIn({
  onDone,
  configured,
  ownApp
}: {
  onDone: () => Promise<void>;
  /** Axon has a Google app to sign in with; without one, the button sets it up first. */
  configured: boolean;
  ownApp: boolean;
}) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const pushToast = useApp((s) => s.pushToast);
  useEffect(() => () => void window.axon.googleSignInCancel(), []);
  const start = async () => {
    setWaiting(true);
    setError('');
    try {
      const profile = await window.axon.googleSignIn();
      pushToast(`Signed in with Google as ${profile.email}`);
      await onDone();
    } catch (err) {
      const message = errorText(err);
      if (!/cancelled/i.test(message)) setError(message);
    } finally {
      setWaiting(false);
    }
  };
  return (
    <div className="settings-item">
      <span className="account-mark" aria-hidden="true">
        <IconGoogle size={20} />
      </span>
      <div className="settings-item-main">
        <div className="settings-item-title">
          {waiting ? 'Finish signing in in your browser' : 'Not signed in'}
        </div>
        <div className="settings-item-meta">
          {waiting
            ? 'Choose your account on the Google page that opened.'
            : 'Your name, email and photo; then you can connect Gmail.'}
        </div>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="settings-item-actions">
        {waiting ? (
          <Button size="sm" variant="ghost" onClick={() => void window.axon.googleSignInCancel()}>
            Cancel
          </Button>
        ) : (
          <>
            {ownApp && (
              <Button size="sm" variant="ghost" onClick={() => setSetup(true)}>
                Change app
              </Button>
            )}
            <Button className="account-google" onClick={() => (configured ? void start() : setSetup(true))}>
              <IconGoogle size={16} />
              Sign in with Google
            </Button>
          </>
        )}
      </div>
      {setup && (
        <AccountAppDialog
          kind="google"
          onClose={() => setSetup(false)}
          onSaved={() => {
            setSetup(false);
            void start();
          }}
        />
      )}
    </div>
  );
}

/** Gmail through the Google sign-in's app: connect it, or see how it's doing. */
function ConnectGmail() {
  const gmail = useApp((s) => s.data?.mcpServers.find((m) => m.catalogId === 'gmail'));
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  const pushToast = useApp((s) => s.pushToast);
  if (gmail?.status === 'connected') return <span className="badge badge-accent">Gmail connected</span>;
  if (waiting)
    return (
      <Button size="sm" variant="ghost" onClick={() => void window.axon.connectorSignInCancel()}>
        Cancel Gmail sign-in
      </Button>
    );
  return (
    <>
      {error && (
        <span className="account-error" role="alert">
          {error}
        </span>
      )}
      <Button
        size="sm"
        icon={IconGoogle}
        onClick={async () => {
          setError('');
          setWaiting(true);
          try {
            await window.axon.connectorAdd('gmail');
            await useApp.getState().refresh();
            const server = useApp.getState().data?.mcpServers.find((m) => m.catalogId === 'gmail');
            if (server?.status === 'connected')
              pushToast(`Gmail connected · ${server.tools?.length ?? 0} tools`);
            else if (server)
              setError(server.error || 'Gmail did not connect. Try again from Settings → Connectors.');
          } catch (err) {
            const message = errorText(err);
            if (!/cancelled/i.test(message)) setError(message);
          } finally {
            setWaiting(false);
          }
        }}
      >
        {gmail ? 'Reconnect Gmail' : 'Connect Gmail'}
      </Button>
    </>
  );
}

function GitRow({ version, onCheck }: { version: string | null; onCheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-item">
      <span className="account-mark" aria-hidden="true">
        <IconGitBranch size={20} />
      </span>
      <div className="settings-item-main">
        <div className="settings-item-title">
          {version ? `Git ${version}` : 'Git is not installed'}
          {!version && <span className="badge badge-warning">Needed</span>}
        </div>
        <div className="settings-item-meta">
          {version
            ? 'Axon uses your installed Git for commits, clones and sync.'
            : 'Install Git, then check again.'}
        </div>
      </div>
      <div className="settings-item-actions">
        {!version && (
          <LinkButton url="https://git-scm.com/downloads" button>
            Get Git
          </LinkButton>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await window.axon.gitCheck();
              await onCheck();
            } finally {
              setBusy(false);
            }
          }}
        >
          Check again
        </Button>
      </div>
    </div>
  );
}

/** Opens a GitHub or Git page in your browser. */
export function LinkButton({
  url,
  children,
  button
}: {
  url: string;
  children: ReactNode;
  button?: boolean;
}) {
  return button ? (
    <Button size="sm" icon={IconExternalLink} onClick={() => void window.axon.openLink(url)}>
      {children}
    </Button>
  ) : (
    <button type="button" className="account-link" onClick={() => void window.axon.openLink(url)}>
      {children}
    </button>
  );
}
