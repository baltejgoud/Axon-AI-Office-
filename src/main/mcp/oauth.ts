import { loopbackAuthorize, pkcePair, randomState } from '../accounts/loopback';
import { CLIENT_INFO, PROTOCOL_VERSION, type BearerSource } from './client-manager';
import { isSecureMcpUrl } from '../../shared/connectors';

/** The client Axon signs in as: registered on the spot, or an app registered ahead of time. */
export interface OAuthClient {
  clientId: string;
  clientSecret?: string;
}
/** A server's sign-in, kept in the vault under `mcp-oauth:<server id>`. */
export interface McpTokens {
  access: string;
  refresh?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  /** The MCP server the tokens are for (RFC 8707). */
  resource: string;
}
export interface AuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scope?: string;
}
type Fetch = typeof fetch;

async function getJson(url: string, fetchImpl: Fetch): Promise<Record<string, any> | null> {
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const body = await response.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
/** The first of these URLs that answers with a JSON object. */
async function first(urls: string[], fetchImpl: Fetch): Promise<Record<string, any> | null> {
  for (const url of [...new Set(urls)]) {
    const found = await getJson(url, fetchImpl);
    if (found) return found;
  }
  return null;
}

/**
 * How a server wants to be signed in to: its protected-resource metadata (named by its 401, else
 * the path-aware well-known URL, else the root one), then its authorization server's metadata.
 * Without resource metadata, the server's origin is taken as the authorization server.
 */
export async function discover(serverUrl: string, fetchImpl: Fetch = fetch): Promise<AuthServer> {
  const url = new URL(serverUrl);
  const path = url.pathname.replace(/\/$/, '');
  let hinted: string | undefined;
  let scope: string | undefined;
  try {
    const probe = await fetchImpl(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } }),
      signal: AbortSignal.timeout(15_000)
    });
    const challenge = probe.headers.get('www-authenticate') ?? '';
    hinted = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    scope = /scope="([^"]+)"/.exec(challenge)?.[1];
    await probe.body?.cancel();
  } catch {
    /* The well-known URLs below still work. */
  }
  const resource = await first([
    ...(hinted && isSecureMcpUrl(hinted) ? [hinted] : []),
    `${url.origin}/.well-known/oauth-protected-resource${path}`,
    `${url.origin}/.well-known/oauth-protected-resource`
  ], fetchImpl);
  const listed = resource?.authorization_servers?.[0];
  const issuer = typeof listed === 'string' && isSecureMcpUrl(listed) ? listed : url.origin;
  if (!scope && Array.isArray(resource?.scopes_supported) && resource.scopes_supported.length)
    scope = resource.scopes_supported.filter((s: unknown) => typeof s === 'string').join(' ');
  const iss = new URL(issuer);
  const issuerPath = iss.pathname.replace(/\/$/, '');
  const meta = await first([
    `${iss.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    `${iss.origin}/.well-known/openid-configuration${issuerPath}`,
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  ], fetchImpl);
  if (!meta || !isSecureMcpUrl(meta.authorization_endpoint) || !isSecureMcpUrl(meta.token_endpoint))
    throw new Error(`${url.host} doesn't say how to sign in.`);
  return {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    ...(isSecureMcpUrl(meta.registration_endpoint) ? { registrationEndpoint: meta.registration_endpoint } : {}),
    ...(scope ? { scope } : {})
  };
}

/** Registers Axon as a public native client for one exact loopback redirect. */
export async function registerClient(endpoint: string, redirectUri: string, fetchImpl: Fetch = fetch): Promise<OAuthClient> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Axon',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok || typeof body.client_id !== 'string')
    throw new Error(`Couldn't register Axon with ${new URL(endpoint).host}: ${body.error_description || body.error || `HTTP ${response.status}`}.`);
  return { clientId: body.client_id, ...(typeof body.client_secret === 'string' ? { clientSecret: body.client_secret } : {}) };
}

async function tokenCall(endpoint: string, fields: Record<string, string>, client: OAuthClient, fetchImpl: Fetch, signal?: AbortSignal) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ ...fields, client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) }).toString(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any> };
}

function tokensFrom(body: Record<string, any>, keep: { tokenEndpoint: string; client: OAuthClient; resource: string; refresh?: string }): McpTokens {
  const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : keep.refresh;
  return {
    access: body.access_token,
    ...(refresh ? { refresh } : {}),
    ...(typeof body.expires_in === 'number' ? { expiresAt: Date.now() + body.expires_in * 1000 } : {}),
    tokenEndpoint: keep.tokenEndpoint,
    clientId: keep.client.clientId,
    ...(keep.client.clientSecret ? { clientSecret: keep.client.clientSecret } : {}),
    resource: keep.resource
  };
}

/** Signs in to an MCP server in the browser. Without `client`, Axon registers itself first. */
export async function signIn(input: {
  serverUrl: string;
  client?: OAuthClient;
  openExternal: (url: string) => Promise<void> | void;
  signal: AbortSignal;
  fetchImpl?: Fetch;
  timeoutMs?: number;
}): Promise<McpTokens> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const host = new URL(input.serverUrl).host;
  const server = await discover(input.serverUrl, fetchImpl);
  if (!input.client && !server.registrationEndpoint) throw new Error(`${host} needs Axon to be registered as an app first.`);
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  let client = input.client;
  const { code, redirectUri } = await loopbackAuthorize({
    state,
    signal: input.signal,
    openExternal: input.openExternal,
    timeoutMs: input.timeoutMs,
    messages: {
      declined: `Signing in to ${host} was declined.`,
      failed: `Signing in to ${host} didn't complete. Try again.`,
      timedOut: `Signing in to ${host} timed out. Try again.`
    },
    authorizationUrl: async (redirect) => {
      // Registered for this sign-in's exact redirect: servers differ on whether a loopback port may vary.
      client ??= await registerClient(server.registrationEndpoint!, redirect, fetchImpl);
      const auth = new URL(server.authorizationEndpoint);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('client_id', client.clientId);
      auth.searchParams.set('redirect_uri', redirect);
      auth.searchParams.set('code_challenge', challenge);
      auth.searchParams.set('code_challenge_method', 'S256');
      auth.searchParams.set('state', state);
      auth.searchParams.set('resource', input.serverUrl);
      if (server.scope) auth.searchParams.set('scope', server.scope);
      return auth.toString();
    }
  });
  const { status, body } = await tokenCall(
    server.tokenEndpoint,
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource: input.serverUrl },
    client!,
    fetchImpl,
    input.signal
  );
  if (status >= 400 || typeof body.access_token !== 'string')
    throw new Error(`Signing in to ${host} failed: ${body.error_description || body.error || `HTTP ${status}`}.`);
  return tokensFrom(body, { tokenEndpoint: server.tokenEndpoint, client: client!, resource: input.serverUrl });
}

/** Fresh tokens, or null when the server refuses (sign in again). Network trouble throws. */
export async function refreshTokens(tokens: McpTokens, fetchImpl: Fetch = fetch): Promise<McpTokens | null> {
  if (!tokens.refresh) return null;
  const client: OAuthClient = { clientId: tokens.clientId, ...(tokens.clientSecret ? { clientSecret: tokens.clientSecret } : {}) };
  const { status, body } = await tokenCall(tokens.tokenEndpoint, { grant_type: 'refresh_token', refresh_token: tokens.refresh, resource: tokens.resource }, client, fetchImpl);
  if (status >= 400 && status < 500) return null;
  if (status >= 400 || typeof body.access_token !== 'string') throw new Error(`Refreshing the sign-in failed (HTTP ${status}).`);
  return tokensFrom(body, { tokenEndpoint: tokens.tokenEndpoint, client, resource: tokens.resource, refresh: tokens.refresh });
}

/** Within a minute of expiring. */
export const expiresSoon = (tokens: McpTokens, now = Date.now()) => tokens.expiresAt !== undefined && tokens.expiresAt - now < 60_000;

/** A server's tokens from the vault, refreshed shortly before they expire and after a 401. */
export class TokenKeeper implements BearerSource {
  private inflight: Promise<string | null> | null = null;
  constructor(
    private readonly load: () => McpTokens | null,
    private readonly save: (tokens: McpTokens) => void,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now
  ) {}
  async token(): Promise<string | null> {
    const tokens = this.load();
    if (!tokens) return null;
    return expiresSoon(tokens, this.now()) ? (await this.refresh()) ?? tokens.access : tokens.access;
  }
  /** One refresh at a time: callers arriving meanwhile share it. */
  refresh(): Promise<string | null> {
    if (!this.inflight) this.inflight = this.refreshOnce().finally(() => { this.inflight = null; });
    return this.inflight;
  }
  private async refreshOnce(): Promise<string | null> {
    const tokens = this.load();
    if (!tokens) return null;
    try {
      const fresh = await refreshTokens(tokens, this.fetchImpl);
      if (fresh) this.save(fresh);
      return fresh?.access ?? null;
    } catch {
      return null;
    }
  }
}
