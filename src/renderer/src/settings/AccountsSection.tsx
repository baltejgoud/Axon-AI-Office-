import { useEffect, useState, type ReactNode } from 'react';
import type { AccountProfile, DeviceCode } from '../../../shared/scm';
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
  IconUser
} from '../ui';
import { SettingsGroup } from './controls';

/** Settings → Accounts: GitHub for your repositories, Google for who you are, and the Git they both need. */
export function AccountsSection() {
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
            Sign in with GitHub to clone your repositories, publish folders and sync your work. Signing in
            with Google shows who you are in Axon; nothing else is shared.
          </p>
        </div>
      </header>
      {!accounts ? (
        <p className="account-note">Loading…</p>
      ) : (
        <>
          <SettingsGroup title="GitHub">
            {!accounts.github.configured ? (
              <NotConfigured service="GitHub" variable="AXON_GITHUB_CLIENT_ID" />
            ) : accounts.github.profile ? (
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
            {!accounts.google.configured ? (
              <NotConfigured service="Google" variable="AXON_GOOGLE_CLIENT_ID" />
            ) : accounts.google.profile ? (
              <SignedIn
                profile={accounts.google.profile}
                meta={accounts.google.profile.email}
                onSignOut={async () => {
                  await window.axon.googleSignOut();
                  await refresh();
                }}
              />
            ) : (
              <GoogleSignIn onDone={refresh} />
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
  onSignOut
}: {
  profile: AccountProfile;
  meta: string;
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

function GitHubSignIn({ onDone, note }: { onDone: () => Promise<void>; note?: ReactNode }) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
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
        <div className="settings-item-meta">Clone, publish and sync need your GitHub account.</div>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        {note && <p className="account-note">{note}</p>}
      </div>
      <div className="settings-item-actions">
        <Button variant="primary" icon={IconGitHub} disabled={busy} onClick={() => void start()}>
          Sign in with GitHub
        </Button>
      </div>
    </div>
  );
}

function GoogleSignIn({ onDone }: { onDone: () => Promise<void> }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
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
            : 'Only your name, email and photo are used.'}
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
          <Button className="account-google" onClick={() => void start()}>
            <IconGoogle size={16} />
            Sign in with Google
          </Button>
        )}
      </div>
    </div>
  );
}

function NotConfigured({ service, variable }: { service: string; variable: string }) {
  return (
    <div className="settings-item">
      <div className="settings-item-main">
        <div className="settings-item-title">{service} sign-in isn't set up in this build</div>
        <p className="account-note">
          Add the OAuth app's client ID in <code>src/main/accounts/clients.ts</code>, or set{' '}
          <code>{variable}</code> when running Axon.
        </p>
      </div>
    </div>
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
