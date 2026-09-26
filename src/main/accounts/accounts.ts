import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountProfile, DeviceCode } from '../../shared/scm';
import { avatarData, me } from '../git/githubApi';

/** Where the GitHub token lives in the vault. */
export const GITHUB_TOKEN = 'account:github';
/** How long a browser sign-in may take before Axon stops waiting. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface AccountsDeps {
  dir: string;
  vault: { get(id: string): string | null; set(id: string, secret: string): void; remove(id: string): void; has(id: string): boolean };
  openExternal(url: string): Promise<void> | void;
  github: { clientId: string };
  google: { clientId: string; clientSecret: string };
  /** Tests shorten GitHub's polling interval. */
  pollScale?: number;
}
type Saved = { github?: AccountProfile; google?: AccountProfile };

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const base64url = (bytes: Buffer) => bytes.toString('base64url');
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Sign-in cancelled.')); }, { once: true });
});

/** GitHub and Google sign-in. Profiles are kept in accounts.json; only GitHub's token is kept, in the OS vault. */
export class Accounts {
  private readonly file: string;
  private saved: Saved;
  private github: { device: string; interval: number; expiresAt: number; abort: AbortController } | null = null;
  private google: { abort: AbortController } | null = null;
  constructor(private readonly deps: AccountsDeps) {
    this.file = join(deps.dir, 'accounts.json');
    this.saved = this.load();
  }
  private load(): Saved {
    try { return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) as Saved : {}; } catch { return {}; }
  }
  private persist(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.saved), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  get githubConfigured(): boolean { return !!this.deps.github.clientId; }
  get googleConfigured(): boolean { return !!this.deps.google.clientId; }
  /** GitHub's profile, only while its token is still in the vault. */
  get githubProfile(): AccountProfile | null { return this.saved.github && this.deps.vault.has(GITHUB_TOKEN) ? this.saved.github : null; }
  get googleProfile(): AccountProfile | null { return this.saved.google ?? null; }
  githubToken(): string | null { return this.githubProfile ? this.deps.vault.get(GITHUB_TOKEN) : null; }

  // ------------------------------------------------------------------ GitHub: device flow

  /** Asks GitHub for a code and opens the page to type it at. */
  async githubStart(): Promise<DeviceCode> {
    if (!this.githubConfigured) throw new Error('GitHub sign-in is not configured in this build of Axon.');
    this.github?.abort.abort();
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.deps.github.clientId, scope: 'repo read:user' }), redirect: 'error', signal: AbortSignal.timeout(30_000)
    });
    const body = await response.json().catch(() => ({})) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error_description?: string };
    if (!response.ok || !body.device_code || !body.user_code) throw new Error(`GitHub: ${body.error_description || 'could not start sign-in.'}`);
    const verificationUri = body.verification_uri?.startsWith('https://github.com/') ? body.verification_uri : 'https://github.com/login/device';
    const expiresAt = Date.now() + (body.expires_in ?? 900) * 1000;
    this.github = { device: body.device_code, interval: (body.interval ?? 5) * 1000, expiresAt, abort: new AbortController() };
    await this.deps.openExternal(verificationUri);
    return { userCode: body.user_code, verificationUri, expiresAt };
  }

  /** Waits for you to approve the code on github.com, then saves the token and your profile. */
  async githubFinish(): Promise<AccountProfile> {
    const flow = this.github;
    if (!flow) throw new Error('Start GitHub sign-in first.');
    let interval = flow.interval;
    try {
      while (Date.now() < flow.expiresAt) {
        await sleep(interval * (this.deps.pollScale ?? 1), flow.abort.signal);
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ client_id: this.deps.github.clientId, device_code: flow.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
          redirect: 'error', signal: AbortSignal.any([flow.abort.signal, AbortSignal.timeout(30_000)])
        });
        const body = await response.json().catch(() => ({})) as { access_token?: string; error?: string; interval?: number; error_description?: string };
        if (body.access_token) return await this.githubSave(body.access_token);
        if (body.error === 'authorization_pending') continue;
        if (body.error === 'slow_down') { interval = (body.interval ? body.interval * 1000 : interval + 5000); continue; }
        if (body.error === 'access_denied') throw new Error('GitHub sign-in was declined.');
        if (body.error === 'expired_token') break;
        throw new Error(`GitHub: ${body.error_description || body.error || 'sign-in failed.'}`);
      }
      throw new Error('The GitHub code expired. Start sign-in again.');
    } finally {
      if (this.github === flow) this.github = null;
    }
  }
  githubCancel(): void { this.github?.abort.abort(); this.github = null; }
  private async githubSave(token: string): Promise<AccountProfile> {
    const user = await me(token);
    this.deps.vault.set(GITHUB_TOKEN, token);
    const profile: AccountProfile = {
      login: user.login, name: user.name || user.login,
      // GitHub's private commit address: commits made in Axon credit you without publishing your email.
      email: `${user.id}+${user.login}@users.noreply.github.com`,
      avatar: await avatarData(user.avatar_url)
    };
    this.saved.github = profile;
    this.persist();
    return profile;
  }
  /** Forgets the token. GitHub keeps the grant until you revoke it at github.com/settings/applications. */
  githubSignOut(): void {
    this.githubCancel();
    this.deps.vault.remove(GITHUB_TOKEN);
    delete this.saved.github;
    this.persist();
  }

  // ------------------------------------------------------------------ Google: browser + loopback + PKCE

  /** Opens Google's sign-in in your browser and waits for it to come back to Axon. Only your name, email and photo are kept. */
  async googleSignIn(): Promise<AccountProfile> {
    if (!this.googleConfigured) throw new Error('Google sign-in is not configured in this build of Axon.');
    this.google?.abort.abort();
    const abort = new AbortController();
    this.google = { abort };
    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    let server: Server | null = null;
    try {
      const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        abort.signal.addEventListener('abort', () => fail(new Error('Sign-in cancelled.')), { once: true });
        const timer = setTimeout(() => fail(new Error('Google sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS);
        abort.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
        let redirectUri = '';
        server = createServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1');
          if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
          const ok = url.searchParams.get('state') === state && !!url.searchParams.get('code');
          response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(ok));
          clearTimeout(timer);
          if (ok) resolve({ code: url.searchParams.get('code')!, redirectUri });
          else fail(new Error(url.searchParams.get('error') === 'access_denied' ? 'Google sign-in was declined.' : 'Google sign-in did not complete. Try again.'));
        });
        server.on('error', fail);
        server.listen(0, '127.0.0.1', () => {
          const port = (server!.address() as { port: number }).port;
          redirectUri = `http://127.0.0.1:${port}/callback`;
          const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          auth.search = form({
            client_id: this.deps.google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
            code_challenge: base64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state, prompt: 'select_account'
          });
          Promise.resolve(this.deps.openExternal(auth.toString())).catch(fail);
        });
      });
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form({
          code, client_id: this.deps.google.clientId, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri,
          ...(this.deps.google.clientSecret ? { client_secret: this.deps.google.clientSecret } : {})
        }),
        redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)])
      });
      const body = await response.json().catch(() => ({})) as { id_token?: string; error_description?: string };
      if (!response.ok || !body.id_token) throw new Error(`Google: ${body.error_description || 'sign-in failed.'}`);
      const claims = idTokenClaims(body.id_token, this.deps.google.clientId);
      // Identity only: Google's tokens are dropped here and never stored.
      const profile: AccountProfile = { login: '', name: claims.name || claims.email, email: claims.email, avatar: claims.picture ? await avatarData(claims.picture) : '' };
      this.saved.google = profile;
      this.persist();
      return profile;
    } finally {
      (server as Server | null)?.close();
      if (this.google?.abort === abort) this.google = null;
    }
  }
  googleCancel(): void { this.google?.abort.abort(); this.google = null; }
  googleSignOut(): void { this.googleCancel(); delete this.saved.google; this.persist(); }
}

/**
 * The claims of an ID token received straight from Google's token endpoint over TLS; OpenID Connect Core 3.1.3.7
 * lets such a token's signature go unchecked. Audience, issuer and expiry are still checked.
 */
export function idTokenClaims(idToken: string, clientId: string, now = Date.now()): { email: string; name: string; picture: string } {
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')); }
  catch { throw new Error('Google sent an unreadable sign-in.'); }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(clientId) || !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
    typeof claims.exp !== 'number' || claims.exp * 1000 < now || typeof claims.email !== 'string')
    throw new Error('Google sent a sign-in meant for another app.');
  return { email: claims.email, name: typeof claims.name === 'string' ? claims.name : '', picture: typeof claims.picture === 'string' ? claims.picture : '' };
}

const page = (ok: boolean) => `<!doctype html><meta charset="utf-8"><title>Axon</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#222">
<p>${ok ? 'Signed in. You can close this tab and go back to Axon.' : 'Sign-in did not complete. Go back to Axon and try again.'}</p></body>`;
