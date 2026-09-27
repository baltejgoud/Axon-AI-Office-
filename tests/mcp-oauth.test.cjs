// Signing in to MCP servers: discovery, registration, PKCE through the loopback, refresh, and keeping tokens fresh.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const oauth = require('../src/main/mcp/oauth.ts');

/**
 * A resource server and authorization server on one loopback port. Options: header (the 401 names
 * the metadata), prm (protected resource metadata exists), register (a registration endpoint),
 * refreshFails.
 */
function authServer(t, options = {}) {
  const o = { header: true, prm: true, register: true, refreshFails: false, ...options };
  const log = { registered: [], authorize: [], token: [] };
  let base = '';
  const challenges = new Map();
  const meta = (issuer) => ({
    issuer,
    authorization_endpoint: `${base}/auth/authorize`,
    token_endpoint: `${base}/auth/token`,
    ...(o.register ? { registration_endpoint: `${base}/auth/register` } : {}),
    code_challenge_methods_supported: ['S256']
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, base);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/mcp')
        return send(401, {}, o.header
          ? { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="notes.read"` }
          : { 'WWW-Authenticate': 'Bearer' });
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && o.prm)
        return send(200, { resource: `${base}/mcp`, authorization_servers: [`${base}/auth`], scopes_supported: ['read', 'write'] });
      if (url.pathname === '/.well-known/oauth-authorization-server/auth' && o.prm) return send(200, meta(`${base}/auth`));
      if (url.pathname === '/.well-known/openid-configuration' && !o.prm) return send(200, meta(base));
      if (url.pathname === '/auth/register' && o.register) {
        const reg = JSON.parse(body);
        log.registered.push(reg);
        return send(201, { client_id: 'dyn-1', redirect_uris: reg.redirect_uris });
      }
      if (url.pathname === '/auth/authorize') {
        log.authorize.push(url.searchParams);
        challenges.set('abc', url.searchParams.get('code_challenge'));
        const back = new URL(url.searchParams.get('redirect_uri'));
        back.search = new URLSearchParams({ code: 'abc', state: url.searchParams.get('state') }).toString();
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
      if (url.pathname === '/auth/token') {
        const form = new URLSearchParams(body);
        log.token.push(form);
        if (form.get('grant_type') === 'authorization_code') {
          const expected = crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url');
          if (challenges.get(form.get('code')) !== expected) return send(400, { error: 'invalid_grant' });
          return send(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' });
        }
        if (o.refreshFails) return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' });
      }
      send(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => { server.closeAllConnections(); server.close(); });
    resolve({ base, serverUrl: `${base}/mcp`, log });
  }));
}
/** The browser: follows the authorization page's redirect back to Axon's loopback. */
const browser = (url) => { setTimeout(() => void fetch(url).catch(() => {}), 5); };

test('sign-in: discovery, registration for the exact redirect, PKCE, state, resource and scope', async (t) => {
  const { serverUrl, log } = await authServer(t);
  const before = Date.now();
  const tokens = await oauth.signIn({ serverUrl, openExternal: browser, signal: new AbortController().signal });
  assert.equal(tokens.access, 'at-1');
  assert.equal(tokens.refresh, 'rt-1');
  assert.ok(tokens.expiresAt >= before + 3_590_000);
  assert.equal(tokens.clientId, 'dyn-1');
  assert.equal(tokens.resource, serverUrl);
  const [reg] = log.registered;
  assert.equal(reg.client_name, 'Axon');
  assert.equal(reg.token_endpoint_auth_method, 'none');
  assert.deepEqual(reg.grant_types, ['authorization_code', 'refresh_token']);
  const auth = log.authorize[0];
  assert.equal(auth.get('response_type'), 'code');
  assert.equal(auth.get('client_id'), 'dyn-1');
  assert.equal(auth.get('code_challenge_method'), 'S256');
  assert.equal(auth.get('resource'), serverUrl);
  assert.equal(auth.get('scope'), 'notes.read');
  assert.deepEqual(reg.redirect_uris, [auth.get('redirect_uri')]);
  assert.match(auth.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const token = log.token[0];
  assert.equal(token.get('resource'), serverUrl);
  assert.equal(token.get('client_id'), 'dyn-1');
  assert.equal(token.get('redirect_uri'), auth.get('redirect_uri'));
});

test('discovery falls back to the well-known URLs, then to the server origin', async (t) => {
  const withPrm = await authServer(t, { header: false });
  const found = await oauth.discover(withPrm.serverUrl);
  assert.equal(found.tokenEndpoint, `${withPrm.base}/auth/token`);
  assert.equal(found.scope, 'read write');
  const bare = await authServer(t, { header: false, prm: false });
  const origin = await oauth.discover(bare.serverUrl);
  assert.equal(origin.authorizationEndpoint, `${bare.base}/auth/authorize`);
});

test('an app registered ahead of time signs in without registering, and sends its secret', async (t) => {
  const { serverUrl, log } = await authServer(t, { register: false });
  const tokens = await oauth.signIn({ serverUrl, client: { clientId: 'app-1', clientSecret: 's3cret' }, openExternal: browser, signal: new AbortController().signal });
  assert.equal(log.registered.length, 0);
  assert.equal(log.token[0].get('client_secret'), 's3cret');
  assert.equal(tokens.clientSecret, 's3cret');
  // Without an app, a server that can't register one says so before any browser opens.
  let opened = false;
  await assert.rejects(oauth.signIn({ serverUrl, openExternal: () => { opened = true; }, signal: new AbortController().signal }), /registered as an app/);
  assert.equal(opened, false);
});

test('refresh keeps the refresh token when none comes back; a refused refresh is null', async (t) => {
  const { serverUrl, base, log } = await authServer(t);
  const tokens = { access: 'at-1', refresh: 'rt-1', expiresAt: Date.now(), tokenEndpoint: `${base}/auth/token`, clientId: 'dyn-1', resource: serverUrl };
  const fresh = await oauth.refreshTokens(tokens);
  assert.equal(fresh.access, 'at-2');
  assert.equal(fresh.refresh, 'rt-1');
  const sent = log.token.at(-1);
  assert.equal(sent.get('grant_type'), 'refresh_token');
  assert.equal(sent.get('resource'), serverUrl);
  const refused = await authServer(t, { refreshFails: true });
  assert.equal(await oauth.refreshTokens({ ...tokens, tokenEndpoint: `${refused.base}/auth/token` }), null);
  assert.equal(await oauth.refreshTokens({ ...tokens, refresh: undefined }), null);
});

test('TokenKeeper refreshes a token about to expire, once for callers at the same time', async (t) => {
  const { serverUrl, base, log } = await authServer(t);
  let saved = { access: 'at-1', refresh: 'rt-1', expiresAt: Date.now() + 30_000, tokenEndpoint: `${base}/auth/token`, clientId: 'dyn-1', resource: serverUrl };
  const keeper = new oauth.TokenKeeper(() => saved, (tokens) => { saved = tokens; });
  const [a, b] = await Promise.all([keeper.token(), keeper.token()]);
  assert.equal(a, 'at-2');
  assert.equal(b, 'at-2');
  assert.equal(log.token.filter((f) => f.get('grant_type') === 'refresh_token').length, 1);
  assert.equal(saved.access, 'at-2');
  assert.equal(await keeper.token(), 'at-2', 'a fresh token is used as it is');
});

test('an authorization server on plain HTTP elsewhere is refused', async () => {
  const fakeFetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/mcp')) return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"' } });
    if (u.includes('oauth-protected-resource')) return Response.json({ authorization_servers: ['https://mcp.example'] });
    return Response.json({ authorization_endpoint: 'http://evil.example/authorize', token_endpoint: 'https://mcp.example/token' });
  };
  await assert.rejects(oauth.discover('https://mcp.example/mcp', fakeFetch), /doesn't say how to sign in/);
});
