import { lstat, realpath, readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, extname } from 'node:path';
import { execFile } from 'node:child_process';
const excluded = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'vendor', '.venv', '.ssh', '.aws']);
/** Whole directories never worth walking, named by their path from the project root: full copies of this repo, and run output. */
const excludedPaths = new Set(['.claude/worktrees', 'test-results', 'brag-output']);
/** Whether a project-relative slash path is one of those, or sits inside one. */
function underExcluded(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/');
  for (const p of excludedPaths) if (norm === p || norm.startsWith(p + '/')) return true;
  return false;
}
/** How many files one listing walks before it stops, and how many matches one search returns. */
export const LIST_CAP = 5000;
export const SEARCH_HITS = 150;
/** A sample that reaches every top-level folder first, so the map is not 100 lines of whichever one sorts first. */
function representative(files: string[], limit: number): string {
  const seen = new Set<string>(), first: string[] = [], rest: string[] = [];
  for (const f of files) { const top = f.split('/')[0]; if (seen.has(top)) rest.push(f); else { seen.add(top); first.push(f); } }
  return first.concat(rest).slice(0, limit).join('\n');
}
export function allowedName(name: string): boolean {
  return !excluded.has(name) && !/^\.env($|\.)/i.test(name) && !/\.(pem|key|pfx|p12|exe|dll|zip|png|jpg|jpeg|gif|ico|mp4|pdf|docx|xlsx)$/i.test(name);
}
export function within(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export class Project {
  root: string | null = null;
  /** Set when a listing stopped at a cap, so a caller can say so instead of looking empty. */
  listTruncated: boolean = false;
  async choose(path: string): Promise<void> { this.root = await realpath(path); }
  async safe(path: string, create = false): Promise<string> {
    if (!this.root) throw new Error('Choose a project first.');
    const target = resolve(this.root, path);
    if (!within(this.root, target) || target === this.root || path.includes(':')) throw new Error('Path outside project.');
    const parts = relative(this.root, target).split(/[\\/]/);
    if (parts.some(p => !allowedName(p))) throw new Error('Sensitive or unsupported path.');
    let current = this.root;
    for (const part of parts) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !within(this.root, await realpath(current))) throw new Error('Symbolic links and junctions are not permitted.');
      } catch (error) { if (create && (error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    return target;
  }
  /**
   * The project's files as slash paths, or only those under one folder: that folder is walked on its own,
   * so a big sibling can't use up the cap before it is reached. A missing folder lists nothing.
   */
  async list(under?: string, cap = LIST_CAP): Promise<string[]> {
    if (!this.root) return [];
    const root = this.root, files: string[] = []; this.listTruncated = false;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 15 || files.length >= cap) { this.listTruncated = true; return; }
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (files.length >= cap) { this.listTruncated = true; break; }
        if (!allowedName(entry.name) || entry.isSymbolicLink()) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory() && !underExcluded(relative(root, path))) await walk(path, depth + 1);
        else if (entry.isFile()) files.push(relative(root, path).replace(/\\/g, '/'));
      }
    };
    const folder = under?.trim().replace(/^[\\/]+|[\\/]+$/g, '');
    if (!folder) await walk(root, 0);
    else {
      const start = resolve(root, folder);
      if (!within(root, start) || folder.split(/[\\/]/).some(p => !allowedName(p))) return [];
      let stat;
      try { stat = await lstat(start); } catch { return []; }
      // A file's own path lists that file.
      if (stat.isFile()) return [relative(root, start).replace(/\\/g, '/')];
      if (!stat.isDirectory()) return [];
      await walk(start, 0);
    }
    return files.sort();
  }
  async read(path: string): Promise<string> {
    const target = await this.safe(path);
    if ((await lstat(target)).size > 1_000_000) throw new Error('File exceeds the 1 MB editor limit.');
    const text = await readFile(target, 'utf8');
    if (text.includes('\0')) throw new Error('Binary files are not supported.');
    return text;
  }
  /** Whether the file is there, by the same checks as reading it. */
  async exists(path: string): Promise<boolean> {
    try {
      await lstat(await this.safe(path));
      return true;
    } catch {
      return false;
    }
  }
  /** Deletes a file inside the project (undoing one a coworker created). Same checks as reading it. */
  async remove(path: string): Promise<void> {
    const target = await this.safe(path);
    if ((await lstat(target)).isDirectory()) throw new Error('Only files can be removed.');
    await unlink(target);
  }
  async write(path: string, text: string): Promise<void> {
    if (text.length > 1_000_000) throw new Error('File too large.');
    const target = await this.safe(path, true);
    await mkdir(dirname(target), { recursive: true });
    await this.safe(path, true);
    await writeFile(target, text, 'utf8');
  }
  async search(query: string): Promise<{ path: string; line: number; text: string }[]> {
    if (!query.trim()) return [];
    const hits: { path: string; line: number; text: string }[] = [];
    for (const path of await this.list()) {
      try { (await this.read(path)).split('\n').forEach((text, i) => {
        if (hits.length < SEARCH_HITS && text.toLowerCase().includes(query.toLowerCase())) hits.push({ path, line: i + 1, text: text.slice(0, 250) });
      }); } catch { /* Skip unsupported/unreadable files. */ }
      if (hits.length >= SEARCH_HITS) break;
    }
    return hits;
  }
  async getGitContext(): Promise<string> {
    if (!this.root) return '';
    const execGit = (args: string[]): Promise<string> =>
      new Promise((resolvePromise) => {
        execFile('git', args, { cwd: this.root!, timeout: 5000 }, (err, stdout) => {
          if (err) resolvePromise('');
          else resolvePromise(stdout.trim());
        });
      });

    try {
      const branch = await execGit(['branch', '--show-current']);
      const status = await execGit(['status', '--short']);
      const diffStat = await execGit(['diff', '--stat']);

      if (!branch && !status && !diffStat) return '';

      return [
        '### Git Context',
        branch ? `Branch: ${branch}` : '',
        status ? `Status:\n${status.slice(0, 1000)}` : '',
        diffStat ? `Diff:\n${diffStat.slice(0, 1000)}` : ''
      ].filter(Boolean).join('\n');
    } catch {
      return '';
    }
  }
  async getProjectMap(): Promise<string> {
    if (!this.root) return '';
    const files = await this.list();
    const sample = representative(files, 100);
    const totalFiles = files.length;
    return `### Project Structure (${totalFiles} files)\n\`\`\`\n${sample}${totalFiles > 100 ? `\n... and ${totalFiles - 100} more files` : ''}\n\`\`\``;
  }
  async getProjectContext(): Promise<string> {
    if (!this.root) return '';
    const parts: string[] = [`## Open Project: ${this.root}`];

    for (const manifest of ['package.json', 'Cargo.toml', 'pyproject.toml']) {
      try {
        const content = await this.read(manifest);
        parts.push(`### ${manifest}\n\`\`\`\n${content.slice(0, 3000)}\n\`\`\``);
        break;
      } catch {}
    }

    for (const directive of ['AGENTS.md', 'CLAUDE.md', '.cursorrules']) {
      try {
        const content = await this.read(directive);
        parts.push(`### Directives (${directive})\n${content.slice(0, 6000)}`);
      } catch {}
    }

    try {
      const memory = await this.read('.axon/MEMORY.md');
      if (memory.trim()) {
        parts.push(`### Persistent Project Memory (.axon/MEMORY.md)\n${memory.slice(0, 6000)}`);
      }
    } catch {}

    const git = await this.getGitContext();
    if (git) parts.push(git);

    const map = await this.getProjectMap();
    if (map) parts.push(map);

    return parts.join('\n\n');
  }
}