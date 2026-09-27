import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountProfile, DeviceCode } from '../../shared/scm';
import { avatarData, me } from '../git/githubApi';
import { loopbackAuthorize, pkcePair, randomState } from './loopback';

export { SIGN_IN_TIMEOUT_MS } from './loopback';
/** Where the GitHub token lives in the vault. */
export const GITHUB_TOKEN = 'account:github';

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
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    try {
      const { code, redirectUri } = await loopbackAuthorize({
        state,
        signal: abort.signal,
        openExternal: (url) => this.deps.openExternal(url),
        messages: {
          declined: 'Google sign-in was declined.',
          failed: 'Google sign-in did not complete. Try again.',
          timedOut: 'Google sign-in timed out. Try again.'
        },
        authorizationUrl: (redirectUri) => {
          const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
          auth.search = form({
            client_id: this.deps.google.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
            code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account'
          });
          return auth.toString();
        }
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
