import type { RepoSummary } from '../../shared/scm';

/** GitHub no longer accepts the token: it was revoked, or the OAuth app was removed. */
export class SignedOutError extends Error {
  constructor() { super('GitHub signed you out. Sign in to GitHub again in Settings → Accounts.'); }
}
export interface GitHubUser { id: number; login: string; name: string | null; email: string | null; avatar_url: string }

const API = 'https://api.github.com';
async function call<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Axon',
      ...(init.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 401) throw new SignedOutError();
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string; errors?: { message?: string }[] } | null;
    const reason = detail?.errors?.map(e => e.message).filter(Boolean).join('; ') || detail?.message || response.statusText;
    throw Object.assign(new Error(`GitHub: ${reason}`), { status: response.status });
  }
  return response.json() as Promise<T>;
}

export const me = (token: string) => call<GitHubUser>(token, '/user');

/** Your repositories and those you work on, most recently updated first (up to 500). */
export async function listRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await call<{ full_name: string; description: string | null; private: boolean; fork: boolean; updated_at: string }[]>(
      token, `/user/repos?sort=updated&per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`);
    repos.push(...batch.map(r => ({ fullName: r.full_name, description: r.description ?? '', private: r.private, fork: r.fork, updatedAt: r.updated_at })));
    if (batch.length < 100) break;
  }
  return repos;
}

/** Creates an empty repository under your account; its HTTPS clone address and page. */
export async function createRepo(token: string, input: { name: string; description: string; private: boolean }): Promise<{ cloneUrl: string; htmlUrl: string }> {
  try {
    const repo = await call<{ clone_url: string; html_url: string }>(token, '/user/repos', { method: 'POST', body: { ...input, auto_init: false } });
    return { cloneUrl: repo.clone_url, htmlUrl: repo.html_url };
  } catch (error) {
    if ((error as { status?: number }).status === 422) throw new Error(`You already have a repository called ${input.name} on GitHub. Choose another name.`);
    throw error;
  }
}

/** A profile picture as a `data:` URL, from GitHub's or Google's image hosts only; '' when it can't be had. */
export async function avatarData(url: string): Promise<string> {
  try {
    const host = new URL(url).hostname;
    if (!url.startsWith('https://') || !/(^|\.)(githubusercontent\.com|googleusercontent\.com)$/.test(host)) return '';
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !/^image\/(png|jpeg|gif|webp)/.test(type)) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 1_000_000 ? '' : `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  } catch { return ''; }
}
