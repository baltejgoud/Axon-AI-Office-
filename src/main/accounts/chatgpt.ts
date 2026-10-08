import { createPublicKey, verify, randomUUID, type JsonWebKey } from 'node:crypto';
import type { ModelSpec } from '../../shared/types';
import { loopbackAuthorize, pkcePair, randomState } from './loopback';
import { catalogModelLimits, publishedOpenAILimits } from '../model-limits';

export const CHATGPT_PROVIDER_ID = 'chatgpt-plan';
const CREDENTIAL = 'account:chatgpt';
const HOST = 'account:chatgpt-host';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
interface Credentials {
  clientId: string;
  subject: string;
  label: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
}
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}
interface Claims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  name?: string;
}
interface PublicJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}
interface Deps {
  vault: { get(id: string): string | null; set(id: string, value: string): void; remove(id: string): void };
  openExternal(url: string): Promise<void> | void;
}

/** Verify identity before trusting any profile data or making it the active registration. */
export function verifyChatGPTIdentity(
  token: string,
  keys: PublicJwk[],
  clientId: string,
  nonce?: string
): Claims {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 64_000)
    throw new Error('ChatGPT returned an invalid identity token.');
  let header: { alg?: string; kid?: string }, claims: Claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    throw new Error('ChatGPT returned an invalid identity token.');
  }
  if (!['RS256', 'ES256'].includes(header.alg ?? '') || !header.kid)
    throw new Error('ChatGPT identity signature is unsupported.');
  const jwk = keys.find(
    (key) => key.kid === header.kid && (!key.use || key.use === 'sig') && (!key.alg || key.alg === header.alg)
  );
  if (!jwk || (header.alg === 'RS256' ? jwk.kty !== 'RSA' : jwk.kty !== 'EC' || jwk.crv !== 'P-256'))
    throw new Error('ChatGPT identity signing key was not found.');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (
    !verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2], 'base64url')
    )
  )
    throw new Error('ChatGPT identity signature did not validate.');
  const now = Date.now() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== ISSUER ||
    !audiences.includes(clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now - 5 ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + 5 ||
    !claims.sub ||
    typeof claims.sub !== 'string' ||
    (nonce !== undefined && claims.nonce !== nonce)
  )
    throw new Error('ChatGPT identity claims did not validate.');
  return claims;
}

async function jsonRequest(url: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    // Never reflect token-response bodies, authorization codes or credentials into the renderer.
    if (response.status === 401 || response.status === 403)
      throw new Error('ChatGPT access was declined or expired. Sign in again and allow ChatGPT plan usage.');
    throw new Error(
      `ChatGPT connection returned HTTP ${response.status}. Try again or check access in ChatGPT settings.`
    );
  }
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error('ChatGPT returned an oversized response.');
  return JSON.parse(raw);
}

/** Official public-client registration; no borrowed client ID, browser cookies or API-key billing fallback. */
export class ChatGPTAccount {
  private signingIn: AbortController | null = null;
  private refreshing: Promise<string> | null = null;
  private epoch = 0;
  constructor(private readonly deps: Deps) {}
  private saved(): Credentials | null {
    const raw = this.deps.vault.get(CREDENTIAL);
    if (!raw) return null;
    try {
      const record = JSON.parse(raw);
      return record.clientId && record.subject ? record : null;
    } catch {
      return null;
    }
  }
  get connected(): boolean {
    return Boolean(this.saved()?.accessToken);
  }
  private store(record: Credentials) {
    this.deps.vault.set(CREDENTIAL, JSON.stringify(record));
  }
  cancel() {
    this.signingIn?.abort();
  }

  async signIn(): Promise<{ label: string; models: ModelSpec[] }> {
    this.cancel();
    const abort = new AbortController();
    this.signingIn = abort;
    const old = this.saved();
    const state = randomState(),
      nonce = randomState(),
      pkce = pkcePair();
    let host = this.deps.vault.get(HOST);
    if (!host) {
      host = `urn:uuid:${randomUUID()}`;
      this.deps.vault.set(HOST, host);
    }
    try {
      const callback = await loopbackAuthorize({
        state,
        signal: abort.signal,
        callbackPath: '/auth/callback',
        ignoreInvalidState: true,
        openExternal: this.deps.openExternal,
        messages: {
          declined: 'ChatGPT sign-in was declined.',
          failed: 'ChatGPT sign-in did not validate. Try again.',
          timedOut: 'ChatGPT sign-in timed out. Try again.'
        },
        authorizationUrl: (redirectUri) => {
          const url = new URL(`${ISSUER}/api/accounts/authorize`);
          url.search = new URLSearchParams({
            client_id: old?.clientId ?? 'dynamic_agent_client',
            ext_agent_host_id: host!,
            ...(!old ? { agent_name_hint: 'Axon' } : {}),
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
            resource: RESOURCE,
            state,
            nonce,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            ...(old?.idToken ? { id_token_hint: old.idToken } : {})
          }).toString();
          return url.href;
        }
      });
      const clientId = old?.clientId ?? callback.clientId;
      if (
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        (old && callback.clientId && callback.clientId !== old.clientId)
      )
        throw new Error('ChatGPT did not return the expected client registration. Start sign-in again.');
      const tokens: TokenResponse = await jsonRequest(
        TOKEN_ENDPOINT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code: callback.code,
            code_verifier: pkce.verifier,
            redirect_uri: callback.redirectUri,
            resource: RESOURCE
          })
        },
        abort.signal
      );
      if (!tokens.id_token) throw new Error('ChatGPT returned no identity token.');
      const jwks = await jsonRequest(`${ISSUER}/.well-known/jwks.json`, {}, abort.signal);
      const claims = verifyChatGPTIdentity(tokens.id_token, jwks.keys ?? [], clientId, nonce);
      if (old && claims.sub !== old.subject)
        throw new Error(
          'The signed-in ChatGPT account differs from this registration. Sign in with the previously connected account.'
        );
      const record = this.record(tokens, {
        clientId,
        subject: claims.sub!,
        label: claims.email ?? claims.name ?? 'ChatGPT account',
        accessToken: '',
        refreshToken: '',
        idToken: '',
        expiresAt: 0,
        scopes: []
      });
      const models = await this.catalog(record.accessToken, abort.signal);
      abort.signal.throwIfAborted();
      this.epoch++;
      this.store(record);
      return { label: record.label, models };
    } finally {
      if (this.signingIn === abort) this.signingIn = null;
    }
  }

  private record(tokens: TokenResponse, previous: Credentials): Credentials {
    const scopes = tokens.scope === undefined ? previous.scopes : tokens.scope.split(/\s+/);
    if (!scopes.includes(PLAN_SCOPE) || !scopes.includes('resource.invoke'))
      throw new Error('ChatGPT plan usage was not authorized. Sign in again and allow plan usage.');
    if (
      !tokens.access_token ||
      typeof tokens.expires_in !== 'number' ||
      tokens.expires_in <= 0 ||
      !Number.isFinite(tokens.expires_in) ||
      tokens.token_type?.toLowerCase() !== 'bearer'
    )
      throw new Error('ChatGPT returned incomplete access credentials.');
    return {
      ...previous,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous.refreshToken,
      idToken: tokens.id_token ?? previous.idToken,
      scopes,
      expiresAt: Date.now() + tokens.expires_in * 1000
    };
  }

  async accessToken(): Promise<string> {
    const saved = this.saved();
    if (!saved?.accessToken || !saved.scopes.includes(PLAN_SCOPE))
      throw new Error('Connect your ChatGPT account in Settings → Accounts.');
    if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken;
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch;
    this.refreshing = (async () => {
      if (!saved.refreshToken) throw new Error('ChatGPT access expired. Sign in again.');
      const tokens: TokenResponse = await jsonRequest(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: saved.clientId,
          refresh_token: saved.refreshToken,
          resource: RESOURCE
        })
      });
      if (tokens.id_token) {
        const jwks = await jsonRequest(`${ISSUER}/.well-known/jwks.json`, {});
        const claims = verifyChatGPTIdentity(tokens.id_token, jwks.keys ?? [], saved.clientId);
        if (claims.sub !== saved.subject)
          throw new Error('ChatGPT identity changed during renewal. Sign in again.');
      }
      const next = this.record(tokens, saved);
      if (this.epoch !== epoch) throw new Error('ChatGPT account changed during renewal. Try again.');
      this.store(next);
      return next.accessToken;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  async models(): Promise<ModelSpec[]> {
    return this.catalog(await this.accessToken());
  }
  private async catalog(token: string, signal?: AbortSignal): Promise<ModelSpec[]> {
    const body = await jsonRequest(
      `${RESOURCE}/models`,
      { headers: { Authorization: `Bearer ${token}` } },
      signal
    );
    if (!Array.isArray(body.models)) throw new Error('ChatGPT did not return its model catalog.');
    const models = body.models
      .filter((m: any) => m?.visibility === 'list' && typeof m.slug === 'string')
      .slice(0, 100)
      .map((m: any) => ({
        id: m.slug,
        displayName: typeof m.display_name === 'string' ? m.display_name : m.slug,
        ...publishedOpenAILimits(m.slug),
        ...catalogModelLimits(m)
      }));
    if (!models.length)
      throw new Error(
        'No models are available to this ChatGPT account. Check your plan and workspace access.'
      );
    return models;
  }

  async signOut(): Promise<{ remoteRevoked: boolean }> {
    this.cancel();
    if (this.refreshing) await this.refreshing.catch(() => {});
    this.epoch++;
    const epoch = this.epoch;
    const saved = this.saved();
    let remoteRevoked = !saved?.refreshToken;
    try {
      if (saved?.refreshToken) {
        const discovery = await jsonRequest(`${ISSUER}/.well-known/openid-configuration`, {});
        const revoke = new URL(discovery.revocation_endpoint);
        if (revoke.origin !== ISSUER || revoke.username || revoke.password)
          throw new Error('Unexpected ChatGPT revocation endpoint.');
        const response = await fetch(revoke, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: saved.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: saved.clientId
          })
        });
        remoteRevoked = response.status === 200;
      }
    } catch {
      /* Local sign-out still succeeds; the UI reports remote revocation uncertainty. */
    } finally {
      if (saved && this.epoch === epoch)
        this.store({ ...saved, accessToken: '', refreshToken: '', idToken: '', scopes: [], expiresAt: 0 });
    }
    return { remoteRevoked };
  }
}
