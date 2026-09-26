import './scm.css';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ScmDiff, ScmFile, ScmStatus } from '../../../../../shared/scm';
import { errorText, useAccounts } from '../../../accounts';
import { useApp } from '../../../state';
import {
  Button,
  IconCaretDown,
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconGitBranch,
  IconGitHub,
  IconPlus,
  IconRefresh
} from '../../../ui';
import { DiffViewer } from '../../../ui/DiffViewer';
import { useEscape } from '../../../ui/escape';
import { Overlay } from '../shell/Overlay';
import { useOfficeStore } from '../store/officeStore';

const openAccounts = () => useOfficeStore.getState().openOverlay('settings', 'accounts');
const baseName = (path: string) => path.split('/').pop() ?? path;
const dirName = (path: string) => path.split('/').slice(0, -1).join('/');
const CODE_TITLE: Record<ScmFile['code'], string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  U: 'New, not tracked yet',
  C: 'Conflict: changed here and on GitHub'
};
/** How often the changes are read again while the room is open. */
const REFRESH_MS = 8000;

/**
 * The open folder's source control, as in VS Code: the branch, Sync with GitHub, the changes with
 * their diffs, and a commit box. A folder that isn't on GitHub yet gets Publish instead of Sync.
 */
export function SourceControl({ root, onFilesChanged }: { root: string; onFilesChanged: () => void }) {
  const git = useAccounts((s) => s.accounts?.git);
  const signedIn = useAccounts((s) => !!s.accounts?.github.profile);
  const refreshAccounts = useAccounts((s) => s.refresh);
  const pushToast = useApp((s) => s.pushToast);
  const [status, setStatus] = useState<ScmStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState('');
  const [diff, setDiff] = useState<{ file: ScmFile; diff: ScmDiff } | null>(null);
  const [published, setPublished] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await window.axon.scmStatus());
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    setStatus(null);
    setError('');
    setPublished('');
    void load();
  }, [root, load]);
  // Files change outside Axon (and coworkers edit them): look again now and then, and on coming back.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void load();
    }, REFRESH_MS);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load, busy]);
  useEffect(
    () =>
      window.axon.onStream((event) => {
        if (event.channel === 'git') setProgress(event.line);
      }),
    []
  );

  /** Runs one Git action: one at a time, its error shown, and the changes read again after. */
  const act = async (label: string, task: () => Promise<unknown>, filesMoved = false) => {
    setBusy(label);
    setError('');
    setProgress('');
    try {
      await task();
      return true;
    } catch (err) {
      setError(errorText(err));
      if (/signed you out|Sign in to GitHub/i.test(errorText(err))) void refreshAccounts();
      return false;
    } finally {
      setBusy('');
      setProgress('');
      await load();
      if (filesMoved) onFilesChanged();
    }
  };

  if (git === null)
    return (
      <section className="office-scm" aria-label="Source control">
        <Heading />
        <div className="office-scm-card">
          <p>Git isn't installed, so this folder can't be committed or synced.</p>
          <div className="office-scm-row">
            <Button
              size="sm"
              icon={IconExternalLink}
              onClick={() => void window.axon.openLink('https://git-scm.com/downloads')}
            >
              Get Git
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await window.axon.gitCheck();
                await refreshAccounts();
                await load();
              }}
            >
              Check again
            </Button>
          </div>
        </div>
      </section>
    );
  if (!status)
    return (
      <section className="office-scm" aria-label="Source control">
        <Heading />
        {error ? (
          <p className="office-files-error">{error}</p>
        ) : (
          <p className="office-files-empty">Reading changes…</p>
        )}
      </section>
    );

  const changes = status.files;
  const stagedCount = changes.filter((f) => f.staged).length;
  const commit = async () => {
    if (!message.trim() || busy) return;
    const ok = await act('Committing…', async () => {
      const result = await window.axon.scmCommit(message);
      if (result.authorSet) pushToast('Commits in this folder use your GitHub name and private email');
    });
    if (ok) {
      setMessage('');
      pushToast('Committed');
    }
  };

  return (
    <section className="office-scm" aria-label="Source control">
      <Heading
        extra={
          <button
            className="office-scm-icon"
            title="Look for changes again"
            aria-label="Refresh changes"
            onClick={() => void load()}
          >
            <IconRefresh size={14} />
          </button>
        }
      />
      {status.repo && (
        <div className="office-scm-row office-scm-top">
          <BranchPicker
            current={status.branch}
            disabled={!!busy}
            onSwitch={(name, create) =>
              void act(
                create ? 'Creating branch…' : 'Switching…',
                () => (create ? window.axon.scmCreateBranch(name) : window.axon.scmCheckout(name)),
                true
              )
            }
          />
          {status.remote && (
            <Button
              size="sm"
              icon={IconRefresh}
              disabled={!!busy}
              title={
                status.upstream ? `Pull from and push to ${status.upstream}` : 'Push this branch to GitHub'
              }
              onClick={() =>
                void act(
                  'Syncing…',
                  async () => {
                    await window.axon.scmSync();
                    pushToast('In sync with GitHub');
                  },
                  true
                )
              }
            >
              {busy === 'Syncing…'
                ? 'Syncing…'
                : status.upstream
                  ? `Sync ↓${status.behind} ↑${status.ahead}`
                  : 'Push branch'}
            </Button>
          )}
        </div>
      )}

      {status.repo && (
        <>
          <div className="office-scm-changes-heading">
            <span>
              {changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'No changes'}
            </span>
            {changes.length > 0 && (
              <button
                className="office-scm-link"
                disabled={!!busy}
                onClick={() =>
                  void act('Staging…', () =>
                    stagedCount === changes.length
                      ? window.axon.scmUnstage(changes.map((f) => f.path))
                      : window.axon.scmStage(changes.map((f) => f.path))
                  )
                }
              >
                {stagedCount === changes.length ? 'Unstage all' : 'Stage all'}
              </button>
            )}
          </div>
          {changes.length > 0 && (
            <ul className="office-scm-changes">
              {changes.map((file) => (
                <li key={file.path}>
                  <input
                    type="checkbox"
                    aria-label={`Stage ${file.path}`}
                    checked={file.staged}
                    ref={(el) => {
                      if (el) el.indeterminate = file.staged && file.unstaged && file.code !== 'U';
                    }}
                    disabled={!!busy || file.code === 'C'}
                    onChange={() =>
                      void act('Staging…', () =>
                        file.staged && !file.unstaged
                          ? window.axon.scmUnstage([file.path])
                          : window.axon.scmStage([file.path])
                      )
                    }
                  />
                  <button
                    className="office-scm-file"
                    title={`${file.path} · ${CODE_TITLE[file.code]}`}
                    onClick={async () => {
                      try {
                        setDiff({ file, diff: await window.axon.scmDiff(file.path) });
                      } catch (err) {
                        setError(errorText(err));
                      }
                    }}
                  >
                    <span className="office-scm-name">{baseName(file.path)}</span>
                    <span className="office-scm-dir">{dirName(file.path)}</span>
                  </button>
                  <span className={`office-scm-code code-${file.code}`} title={CODE_TITLE[file.code]}>
                    {file.code}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="office-scm-commit">
            <textarea
              aria-label="Commit message"
              placeholder={`Message (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to commit)`}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
            />
            <Button
              variant="primary"
              size="sm"
              icon={IconCheck}
              disabled={!message.trim() || !changes.length || !!busy}
              onClick={() => void commit()}
            >
              {busy === 'Committing…'
                ? 'Committing…'
                : stagedCount
                  ? `Commit ${stagedCount} staged`
                  : 'Commit all'}
            </Button>
          </div>
        </>
      )}

      {(!status.repo || !status.remote) && !published && (
        <PublishCard
          root={root}
          status={status}
          signedIn={signedIn}
          busy={!!busy}
          onPublish={(input) =>
            void act(
              'Publishing…',
              async () => {
                const page = await window.axon.scmPublish(input);
                setPublished(page);
                pushToast('Published to GitHub');
              },
              true
            )
          }
        />
      )}
      {published && (
        <p className="office-scm-done">
          <IconGitHub size={14} />
          On GitHub now.
          <button className="office-scm-link" onClick={() => void window.axon.openLink(published)}>
            Open the repository
          </button>
        </p>
      )}

      {busy && (
        <p className="office-scm-progress" aria-live="polite">
          {progress || busy}
        </p>
      )}
      {error && (
        <p className="office-files-error" role="alert">
          <span>{error}</span>
          {/Sign in to GitHub|signed you out/i.test(error) && <button onClick={openAccounts}>Sign in</button>}
        </p>
      )}

      {diff &&
        // Over the whole office, as Settings is, not inside the side panel.
        createPortal(
          <Overlay title={diff.file.path} onClose={() => setDiff(null)} wide>
            {diff.diff.note ? (
              <p className="office-files-empty">{diff.diff.note}</p>
            ) : (
              <DiffViewer oldText={diff.diff.before} newText={diff.diff.after} fileName={diff.file.path} />
            )}
          </Overlay>,
          document.querySelector('.office-container') ?? document.body
        )}
    </section>
  );
}

function Heading({ extra }: { extra?: ReactNode }) {
  return (
    <div className="activity-section-heading">
      <IconGitBranch size={15} />
      <h4>Source control</h4>
      {extra}
    </div>
  );
}

/** The current branch; opens a list to switch to another, or to start a new one. */
function BranchPicker({
  current,
  disabled,
  onSwitch
}: {
  current: string | null;
  disabled: boolean;
  onSwitch: (name: string, create: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<{ local: string[]; remote: string[] } | null>(null);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    void window.axon.scmBranches().then(setBranches);
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const choose = (branch: string, create: boolean) => {
    setOpen(false);
    setName('');
    if (branch !== current) onSwitch(branch, create);
  };
  return (
    <div className="office-scm-branch" ref={box}>
      <button
        className="office-scm-branch-button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch branch"
        onClick={() => setOpen(!open)}
      >
        <IconGitBranch size={14} />
        <span>{current ?? 'Detached'}</span>
        <IconCaretDown size={12} />
      </button>
      {open && (
        <div
          className="office-scm-branch-menu"
          role="listbox"
          aria-label="Branches"
          // The room scrolls; bring the whole list into view rather than open it below the fold.
          ref={(el) => el?.scrollIntoView({ block: 'nearest' })}
        >
          <form
            className="office-scm-branch-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) choose(name.trim(), true);
            }}
          >
            <IconPlus size={13} />
            <input
              autoFocus
              aria-label="New branch name"
              placeholder="New branch…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </form>
          {!branches && <p className="office-files-empty">Loading…</p>}
          {branches?.local.map((branch) => (
            <button
              key={branch}
              role="option"
              aria-selected={branch === current}
              onClick={() => choose(branch, false)}
            >
              {branch === current ? <IconCheck size={12} /> : <span className="office-scm-spacer" />}
              {branch}
            </button>
          ))}
          {!!branches?.remote.length && <div className="office-department-heading">On GitHub</div>}
          {branches?.remote.map((branch) => (
            <button
              key={`r-${branch}`}
              role="option"
              aria-selected={false}
              onClick={() => choose(branch, false)}
            >
              <span className="office-scm-spacer" />
              {branch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Make a GitHub repository from this folder: its name, whether it's private, and a .gitignore to keep secrets home. */
function PublishCard({
  root,
  status,
  signedIn,
  busy,
  onPublish
}: {
  root: string;
  status: ScmStatus;
  signedIn: boolean;
  busy: boolean;
  onPublish: (input: { name: string; description: string; private: boolean; gitignore: boolean }) => void;
}) {
  const folder = root.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  const [name, setName] = useState(folder.replace(/[^A-Za-z0-9._-]+/g, '-'));
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(true);
  const [gitignore, setGitignore] = useState(true);
  const validName = /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
  return (
    <form
      className="office-scm-card office-scm-publish"
      onSubmit={(e) => {
        e.preventDefault();
        if (validName && signedIn && !busy)
          onPublish({ name, description, private: isPrivate, gitignore: gitignore && !status.hasGitignore });
      }}
    >
      <strong>
        <IconCloudUpload size={15} />
        Publish to GitHub
      </strong>
      <p>
        {status.repo
          ? 'This repository has no GitHub copy yet.'
          : 'Put this folder on GitHub as a new repository.'}
      </p>
      {!signedIn ? (
        <Button size="sm" icon={IconGitHub} onClick={openAccounts}>
          Sign in to GitHub
        </Button>
      ) : (
        <>
          <label className="office-scm-field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!validName} />
          </label>
          <label className="office-scm-field">
            Description <small>(optional)</small>
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={350} />
          </label>
          <label className="office-scm-check">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
            Private: only you and people you invite can see it
          </label>
          {!status.hasGitignore && (
            <label className="office-scm-check">
              <input type="checkbox" checked={gitignore} onChange={(e) => setGitignore(e.target.checked)} />
              Add a .gitignore so .env files, keys and node_modules stay off GitHub
            </label>
          )}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={IconCloudUpload}
            disabled={!validName || busy}
          >
            {busy ? 'Publishing…' : `Publish ${isPrivate ? 'private' : 'public'} repository`}
          </Button>
        </>
      )}
    </form>
  );
}
