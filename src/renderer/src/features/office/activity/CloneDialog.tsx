import { useEffect, useMemo, useState } from 'react';
import type { RepoSummary } from '../../../../../shared/scm';
import { errorText, useAccounts } from '../../../accounts';
import { Button, IconGitHub, IconLock, IconSearch, Modal } from '../../../ui';
import { useOfficeStore } from '../store/officeStore';

/** Paste an address, or it's one of yours: owner/name, or a github.com link. */
const looksLikeRepo = (text: string) =>
  /^(https:\/\/github\.com\/)?[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(\.git)?\/?$/.test(text.trim());
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days < 1
    ? 'today'
    : days === 1
      ? 'yesterday'
      : days < 30
        ? `${days} days ago`
        : new Date(iso).toLocaleDateString();
};

/** Clone from GitHub: your repositories, newest first, or any address you paste. */
export function CloneDialog({
  onClose,
  onCloned
}: {
  onClose: () => void;
  onCloned: (folder: string) => void;
}) {
  const signedIn = useAccounts((s) => !!s.accounts?.github.profile);
  const refreshAccounts = useAccounts((s) => s.refresh);
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!signedIn) return;
    window.axon
      .githubRepos()
      .then(setRepos)
      .catch((err) => {
        setError(errorText(err));
        void refreshAccounts();
      });
  }, [signedIn, refreshAccounts]);
  useEffect(
    () =>
      window.axon.onStream((event) => {
        if (event.channel === 'git') setProgress(event.line);
      }),
    []
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? [])
      .filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .slice(0, 100);
  }, [repos, query]);
  const target = chosen || (looksLikeRepo(query) ? query.trim() : '');

  const clone = async (repo = target) => {
    if (!repo || busy) return;
    setBusy(true);
    setError('');
    try {
      const folder = await window.axon.scmClone(repo);
      if (folder) onCloned(folder);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <Modal
      title="Clone from GitHub"
      description="Pick a repository, or paste its address. You'll choose where the folder goes next."
      onClose={onClose}
      onSubmit={() => void clone()}
      submitLabel={
        busy
          ? 'Cloning…'
          : target
            ? `Clone ${target.replace(/^https:\/\/github\.com\//, '').replace(/\.git\/?$/, '')}`
            : 'Clone'
      }
      submitDisabled={!target || busy}
      size="lg"
    >
      <label className="office-department-search office-clone-search">
        <IconSearch size={15} />
        <input
          aria-label="Search your repositories, or paste an address"
          placeholder={
            signedIn
              ? 'Search your repositories, or paste owner/name'
              : 'Paste owner/name or a github.com address'
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setChosen('');
          }}
        />
      </label>
      {!signedIn ? (
        <div className="office-clone-signin">
          <p>
            Sign in to GitHub to see your repositories and clone private ones. Public repositories clone
            without it.
          </p>
          <Button
            size="sm"
            icon={IconGitHub}
            onClick={() => useOfficeStore.getState().openOverlay('settings', 'accounts')}
          >
            Sign in to GitHub
          </Button>
        </div>
      ) : (
        <ul className="office-clone-list" role="listbox" aria-label="Your repositories">
          {!repos && !error && <li className="office-files-empty">Loading your repositories…</li>}
          {repos && !shown.length && <li className="office-files-empty">No repositories match.</li>}
          {shown.map((repo) => (
            <li key={repo.fullName}>
              <button
                type="button"
                role="option"
                aria-selected={chosen === repo.fullName}
                className={chosen === repo.fullName ? 'chosen' : ''}
                onClick={() => setChosen(repo.fullName)}
                onDoubleClick={() => void clone(repo.fullName)}
              >
                <span className="office-clone-name">
                  {repo.fullName}
                  {repo.private && <IconLock size={12} aria-label="Private" />}
                  {repo.fork && <small>fork</small>}
                </span>
                <span className="office-clone-meta">
                  {repo.description || 'No description'} · updated {ago(repo.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="office-scm-progress">{progress || 'Cloning…'}</p>}
      {error && (
        <p className="office-files-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
