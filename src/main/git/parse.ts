import type { ScmFile, ScmStatus } from '../../shared/scm';

/** `git status --porcelain=v2 -z --branch` as the office's status (without remote and .gitignore). */
export function parseStatus(out: string): Omit<ScmStatus, 'remote' | 'hasGitignore'> {
  const status: Omit<ScmStatus, 'remote' | 'hasGitignore'> = { repo: true, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  const records = out.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('# branch.head ')) {
      const head = record.slice(14);
      status.branch = head === '(detached)' ? null : head;
    } else if (record.startsWith('# branch.upstream ')) status.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const [, ahead, behind] = /^\+(\d+) -(\d+)$/.exec(record.slice(12)) ?? [];
      status.ahead = Number(ahead) || 0;
      status.behind = Number(behind) || 0;
    } else if (record.startsWith('? ')) status.files.push({ path: record.slice(2), code: 'U', staged: false, unstaged: true });
    else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const renamed = record[0] === '2';
      const fields = record.split(' ');
      // Ordinary: 8 fields before the path; renamed: 9 (the score). The path itself may hold spaces.
      const path = fields.slice(renamed ? 9 : 8).join(' ');
      const [x, y] = fields[1];
      const file: ScmFile = { path, code: renamed ? 'R' : codeOf(y !== '.' ? y : x), staged: x !== '.', unstaged: y !== '.' };
      if (renamed) file.origPath = records[++i];
      status.files.push(file);
    } else if (record.startsWith('u ')) status.files.push({ path: record.split(' ').slice(10).join(' '), code: 'C', staged: false, unstaged: true });
  }
  return status;
}
const codeOf = (letter: string): ScmFile['code'] => (letter === 'A' ? 'A' : letter === 'D' ? 'D' : letter === 'R' || letter === 'C' ? 'R' : 'M');

/** `owner/repo` or a github.com address, as the HTTPS address to clone and the folder name it makes. */
export function parseRepoInput(input: string): { url: string; name: string } {
  const text = input.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(text);
  if (!match || match[2] === '.' || match[2] === '..') throw new Error('Enter a GitHub repository as owner/name or https://github.com/owner/name.');
  return { url: `https://github.com/${match[1]}/${match[2]}.git`, name: match[2] };
}

/** A name GitHub accepts for a new repository. */
export function validRepoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) && name !== '.' && name !== '..';
}

/** A branch name that can't be read as an option and that Git's own rules accept. */
export function validBranchName(name: string): boolean {
  return /^[^-\s~^:?*[\\\x00-\x1f\x7f][^\s~^:?*[\\\x00-\x1f\x7f]{0,199}$/.test(name) &&
    !name.includes('..') && !name.includes('@{') && !name.endsWith('.') && !name.endsWith('/') && !name.endsWith('.lock') &&
    !name.includes('//') && name !== '@' && !name.split('/').some(part => part.startsWith('.'));
}

/** The starter .gitignore Publish offers: dependencies, builds and secrets stay off GitHub. */
export const STARTER_GITIGNORE = ['node_modules/', 'dist/', 'out/', '.env', '.env.*', '*.pem', '*.key', '.DS_Store', 'Thumbs.db', ''].join('\n');
