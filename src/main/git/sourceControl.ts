import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { within } from '../project';
import type { AccountProfile, PublishInput, ScmDiff, ScmStatus } from '../../shared/scm';
import { gitFailure, gitVersion, runGit, type GitResult } from './run';
import { STARTER_GITIGNORE, parseRepoInput, parseStatus, validBranchName, validRepoName } from './parse';
import { createRepo } from './githubApi';

export interface SourceControlDeps {
  /** The open folder, or null. */
  root(): string | null;
  /** The GitHub token, or null when signed out. */
  token(): string | null;
  /** The GitHub profile, for a commit author when Git has none. */
  profile(): AccountProfile | null;
  /** Clone and push progress, one line at a time. */
  progress(line: string): void;
}
const NETWORK_MS = 10 * 60_000;
const NOT_SIGNED_IN = 'Sign in to GitHub first (Settings → Accounts).';
/** The largest file the diff shows, as the editor's own limit. */
const DIFF_LIMIT = 1_000_000;

/** The Files room's source control: status, diff, stage, commit, sync, branches, clone and publish. */
export class SourceControl {
  private version: string | null | undefined;
  constructor(private readonly deps: SourceControlDeps) {}

  /** The installed Git's version; `recheck` looks again after the user installs it. */
  async git(recheck = false): Promise<string | null> {
    if (recheck || this.version === undefined) this.version = await gitVersion(process.cwd());
    return this.version;
  }
  private root(): string {
    const root = this.deps.root();
    if (!root) throw new Error('Open a folder first.');
    return root;
  }
  private async run(args: string[], fallback: string, options: { network?: boolean; progress?: boolean; cwd?: string } = {}): Promise<GitResult> {
    if (!(await this.git())) throw new Error('Git is not installed. Install it from git-scm.com, then choose Check again.');
    const token = options.network ? this.deps.token() : null;
    const result = await runGit(args, {
      cwd: options.cwd ?? this.root(), token, timeoutMs: options.network ? NETWORK_MS : 60_000,
      onProgress: options.progress ? this.deps.progress : undefined
    });
    if (!result.ok) {
      const message = gitFailure(result, fallback);
      if (options.network && /could not read Username|Authentication failed|terminal prompts disabled|403/i.test(message))
        throw new Error(token ? `GitHub refused access: ${message}` : NOT_SIGNED_IN);
      throw new Error(message);
    }
    return result;
  }
  private async isRepo(root: string): Promise<boolean> {
    const result = await runGit(['rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: 10_000 });
    return result.ok;
  }

  /** The repository's top folder: status paths are relative to it, even when a subfolder is open. */
  private async top(): Promise<string> {
    const result = await this.run(['rev-parse', '--show-toplevel'], 'This folder is not a Git repository.');
    return resolve(result.out.trim());
  }
  private async inside(path: string): Promise<{ top: string; file: string }> {
    const top = await this.top();
    const file = resolve(top, path);
    if (!within(top, file) || file === top) throw new Error('That file is outside the repository.');
    return { top, file };
  }

  async status(): Promise<ScmStatus> {
    const root = this.root();
    const hasGitignore = existsSync(join(root, '.gitignore'));
    if (!(await this.git()) || !(await this.isRepo(root)))
      return { repo: false, branch: null, upstream: null, ahead: 0, behind: 0, remote: null, hasGitignore, files: [] };
    const status = parseStatus((await this.run(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], 'Could not read the changes.')).out);
    const origin = await runGit(['remote', 'get-url', 'origin'], { cwd: root, timeoutMs: 10_000 });
    const url = origin.ok ? origin.out.trim() : '';
    return { ...status, hasGitignore, remote: url ? { url, github: /^(https:\/\/github\.com\/|git@github\.com:)/.test(url) } : null };
  }

  /** The file at the last commit and as it is now. */
  async diff(path: string): Promise<ScmDiff> {
    const { top, file } = await this.inside(path);
    const before = await runGit(['show', `HEAD:${path.replace(/\\/g, '/')}`], { cwd: top, timeoutMs: 20_000 });
    let after = '';
    try {
      const bytes = await readFile(file);
      if (bytes.length > DIFF_LIMIT) return { before: '', after: '', note: 'This file is too large to show.' };
      after = bytes.toString('utf8');
    } catch { /* Deleted: nothing now. */ }
    const old = before.ok ? before.out : '';
    if (old.length > DIFF_LIMIT) return { before: '', after: '', note: 'This file is too large to show.' };
    if (old.includes('\0') || after.includes('\0')) return { before: '', after: '', note: 'This is a binary file.' };
    return { before: old, after };
  }

  async stage(paths: string[]): Promise<void> {
    if (!paths.length) return;
    for (const path of paths) await this.inside(path);
    await this.run(['add', '-A', '--', ...paths], 'Could not stage.', { cwd: await this.top() });
  }
  async unstage(paths: string[]): Promise<void> {
    if (!paths.length) return;
    for (const path of paths) await this.inside(path);
    const top = await this.top();
    const hasHead = (await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: top, timeoutMs: 10_000 })).ok;
    // Before the first commit there is no HEAD to reset to.
    await this.run(hasHead ? ['reset', '-q', 'HEAD', '--', ...paths] : ['rm', '-q', '--cached', '--', ...paths], 'Could not unstage.', { cwd: top });
  }

  /** Commits what is staged, or every change when nothing is (as VS Code does). */
  async commit(message: string): Promise<{ authorSet: boolean }> {
    if (!message.trim()) throw new Error('Write a commit message first.');
    const authorSet = await this.ensureAuthor();
    const staged = await runGit(['diff', '--cached', '--quiet'], { cwd: this.root(), timeoutMs: 20_000 });
    if (staged.code === 0) await this.run(['add', '-A'], 'Could not stage the changes.');
    await this.run(['commit', '-m', message], 'Nothing to commit.');
    return { authorSet };
  }
  /** Git needs a name and email to commit. When it has none, this folder uses your GitHub profile's (and says so). */
  private async ensureAuthor(): Promise<boolean> {
    const root = this.root();
    const name = await runGit(['config', 'user.name'], { cwd: root, timeoutMs: 10_000 });
    const email = await runGit(['config', 'user.email'], { cwd: root, timeoutMs: 10_000 });
    if (name.out.trim() && email.out.trim()) return false;
    const profile = this.deps.profile();
    if (!profile) throw new Error('Git needs your name and email for commits. Sign in to GitHub, or run git config --global user.name and user.email.');
    if (!name.out.trim()) await this.run(['config', 'user.name', profile.name], 'Could not set your name.');
    if (!email.out.trim()) await this.run(['config', 'user.email', profile.email], 'Could not set your email.');
    return true;
  }

  /** Pull, then push: GitHub and this folder end up with each other's commits. */
  async sync(): Promise<void> {
    const status = await this.status();
    if (!status.repo) throw new Error('This folder is not a Git repository yet. Publish it to GitHub first.');
    if (!status.branch) throw new Error('Switch to a branch before syncing.');
    if (!status.remote) throw new Error('This folder has no GitHub repository yet. Publish it first.');
    if (status.remote.github && !this.deps.token()) throw new Error(NOT_SIGNED_IN);
    if (!status.upstream) {
      await this.run(['push', '--progress', '-u', 'origin', 'HEAD'], 'Could not push.', { network: true, progress: true });
      return;
    }
    await this.run(['pull', '--no-rebase', '--no-edit', '--progress'], 'Could not pull.', { network: true, progress: true });
    const after = await this.status();
    if (after.files.some(f => f.code === 'C')) throw new Error('Some files changed both here and on GitHub. Fix the conflicts, then commit.');
    if (after.ahead > 0) await this.run(['push', '--progress'], 'Could not push.', { network: true, progress: true });
  }

  async branches(): Promise<{ current: string | null; local: string[]; remote: string[] }> {
    const root = this.root();
    const local = await runGit(['branch', '--format=%(refname:short)'], { cwd: root, timeoutMs: 20_000 });
    const remote = await runGit(['branch', '-r', '--format=%(refname:short)'], { cwd: root, timeoutMs: 20_000 });
    const current = await runGit(['branch', '--show-current'], { cwd: root, timeoutMs: 10_000 });
    const locals = local.out.split('\n').map(s => s.trim()).filter(Boolean);
    const remotes = remote.out.split('\n').map(s => s.trim()).filter(s => s.startsWith('origin/') && s !== 'origin/HEAD' && s !== 'origin')
      .map(s => s.slice(7)).filter(s => !locals.includes(s));
    return { current: current.out.trim() || null, local: locals, remote: remotes };
  }
  async checkout(name: string): Promise<void> {
    if (!validBranchName(name)) throw new Error('That is not a valid branch name.');
    await this.run(['checkout', name], `Could not switch to ${name}.`);
  }
  async createBranch(name: string): Promise<void> {
    if (!validBranchName(name)) throw new Error('Branch names cannot have spaces or ~ ^ : ? * [ \\, or start with - or a dot.');
    await this.run(['checkout', '-b', name], `Could not create ${name}.`);
  }

  /** Clones a GitHub repository into a new folder inside `parent`; the new folder's path. */
  async clone(input: string, parent: string): Promise<string> {
    const { url, name } = parseRepoInput(input);
    const target = join(parent, name);
    if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} already exists and isn't empty. Choose another place.`);
    await this.run(['clone', '--progress', '--', url, target], `Could not clone ${name}.`, { network: true, progress: true, cwd: parent });
    return target;
  }

  /** Makes a new GitHub repository from the open folder and pushes it; the repository's page. */
  async publish(input: PublishInput): Promise<string> {
    const token = this.deps.token();
    if (!token) throw new Error(NOT_SIGNED_IN);
    if (!validRepoName(input.name)) throw new Error('Repository names may use letters, numbers, dots, dashes and underscores.');
    const root = this.root();
    if (!(await this.git())) throw new Error('Git is not installed. Install it from git-scm.com, then choose Check again.');
    if (!(await this.isRepo(root))) {
      const init = await runGit(['init', '-b', 'main'], { cwd: root, timeoutMs: 20_000 });
      // Git before 2.28 has no -b.
      if (!init.ok) { await this.run(['init'], 'Could not start a repository.'); await this.run(['symbolic-ref', 'HEAD', 'refs/heads/main'], 'Could not name the branch.'); }
    }
    const status = await this.status();
    if (status.remote) throw new Error('This folder is already connected to a repository. Use Sync instead.');
    if (input.gitignore && !status.hasGitignore) await writeFile(join(root, '.gitignore'), STARTER_GITIGNORE, 'utf8');
    await this.ensureAuthor();
    await this.run(['add', '-A'], 'Could not stage the files.');
    const hasHead = (await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: root, timeoutMs: 10_000 })).ok;
    const staged = await runGit(['diff', '--cached', '--quiet'], { cwd: root, timeoutMs: 20_000 });
    if (!hasHead || staged.code !== 0) await this.run(['commit', ...(hasHead ? [] : ['--allow-empty']), '-m', hasHead ? 'Publish from Axon' : 'Initial commit'], 'Could not commit.');
    // The local commit succeeded, so a GitHub repository made now won't be left empty by a local failure.
    const repo = await createRepo(token, { name: input.name, description: input.description, private: input.private });
    await this.run(['remote', 'add', 'origin', repo.cloneUrl], 'Could not connect the folder to GitHub.');
    await this.run(['push', '--progress', '-u', 'origin', 'HEAD'], 'Could not push.', { network: true, progress: true });
    return repo.htmlUrl;
  }
}
