import { useState, type ReactNode } from 'react';
import { errorText } from '../accounts';
import { Button, IconCheck, IconCopy, IconExternalLink, Modal } from '../ui';

/** A value to type into GitHub's or Google's form, with a copy button. */
function Value({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="account-setup-value">
      <span>{label}</span>
      <code>{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? IconCheck : IconCopy}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** Opens a GitHub or Google Cloud page in your browser. */
function Open({ url, children }: { url: string; children: ReactNode }) {
  return (
    <Button size="sm" icon={IconExternalLink} onClick={() => void window.axon.openLink(url)}>
      {children}
    </Button>
  );
}

/**
 * The one-time setup GitHub or Google sign-in needs when this build of Axon has no app of its own:
 * register Axon's app on your account, then paste what it gives you. Kept in your computer's secure storage.
 */
export function AccountAppDialog({
  kind,
  onClose,
  onSaved
}: {
  kind: 'github' | 'google';
  onClose: () => void;
  /** The app is saved: sign-in can start. */
  onSaved: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const github = kind === 'github';
  const save = async () => {
    setError('');
    if (!clientId.trim()) return setError('Paste the Client ID.');
    try {
      await window.axon.accountAppSave(kind, clientId, github ? undefined : secret);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal
      title={github ? 'Set up GitHub sign-in' : 'Set up Google sign-in'}
      description={
        github
          ? 'Once only: register Axon as an app on your GitHub account. It takes a minute.'
          : 'Once only: create Axon’s Google app in Google Cloud. The same app signs you in and connects Gmail, Calendar and Drive.'
      }
      size="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      submitLabel="Save and sign in"
    >
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {github ? (
        <ol className="account-setup">
          <li>
            <p>Open GitHub’s New OAuth App page.</p>
            <Open url="https://github.com/settings/applications/new">Open GitHub</Open>
          </li>
          <li>
            <p>Fill it in with:</p>
            <Value label="Application name" value="Axon" />
            <Value label="Homepage URL" value="http://127.0.0.1" />
            <Value label="Authorization callback URL" value="http://127.0.0.1" />
          </li>
          <li>
            <p>
              Tick <strong>Enable Device Flow</strong>, then click <strong>Register application</strong>.
            </p>
          </li>
          <li>
            <p>
              Copy the <strong>Client ID</strong> GitHub shows and paste it here. No client secret is needed.
            </p>
            <label className="field">
              Client ID
              <input
                className="input"
                autoComplete="off"
                placeholder="Ov23li…"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </label>
          </li>
        </ol>
      ) : (
        <ol className="account-setup">
          <li>
            <p>Create a project in Google Cloud (or pick one you have).</p>
            <Open url="https://console.cloud.google.com/projectcreate">Create a project</Open>
          </li>
          <li>
            <p>Turn on the Gmail, Google Calendar and Google Drive APIs in it.</p>
            <div className="account-setup-links">
              <Open url="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</Open>
              <Open url="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">
                Calendar API
              </Open>
              <Open url="https://console.cloud.google.com/apis/library/drive.googleapis.com">Drive API</Open>
            </div>
            <p className="account-note">
              Google’s Gmail, Calendar and Drive connectors are in preview; their{' '}
              <button
                type="button"
                className="account-link"
                onClick={() =>
                  void window.axon.openLink(
                    'https://developers.google.com/workspace/guides/configure-mcp-servers'
                  )
                }
              >
                setup guide
              </button>{' '}
              lists anything else your project needs for them.
            </p>
          </li>
          <li>
            <p>
              Set up the consent screen: choose <strong>External</strong>, and add your Gmail address as a{' '}
              <strong>test user</strong>.
            </p>
            <Open url="https://console.cloud.google.com/apis/credentials/consent">Consent screen</Open>
          </li>
          <li>
            <p>
              Create credentials → <strong>OAuth client ID</strong> → application type{' '}
              <strong>Desktop app</strong>, named Axon.
            </p>
            <Open url="https://console.cloud.google.com/apis/credentials">Credentials</Open>
          </li>
          <li>
            <p>Paste the Client ID and Client secret Google shows.</p>
            <label className="field">
              Client ID
              <input
                className="input"
                autoComplete="off"
                placeholder="…apps.googleusercontent.com"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </label>
            <label className="field">
              Client secret
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder="GOCSPX-…"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              <span className="field-hint">
                Google calls a desktop app’s secret not confidential; Axon keeps it in your computer’s secure
                storage anyway.
              </span>
            </label>
          </li>
        </ol>
      )}
    </Modal>
  );
}
