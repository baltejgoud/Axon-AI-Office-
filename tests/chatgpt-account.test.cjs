const ts = require('typescript');
const fs = require('node:fs');
const crypto = require('node:crypto');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ChatGPTAccount, verifyChatGPTIdentity } = require('../src/main/accounts/chatgpt.ts');
const { loopbackAuthorize } = require('../src/main/accounts/loopback.ts');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const claims = () => ({ iss: 'https://auth.openai.com', aud: 'issued-client', sub: 'user-1', nonce: 'nonce-1', exp: Date.now() / 1000 + 600, iat: Date.now() / 1000, email: 'user@example.test' });
function jwt(body, header = { alg: 'RS256', kid: 'test-key' }) {
  const payload = [header, body].map((v) => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${payload}.${crypto.sign('sha256', Buffer.from(payload), privateKey).toString('base64url')}`;
}
const credentials = () => ({ clientId: 'issued-client', subject: 'user-1', label: 'user@example.test', accessToken: 'expired', refreshToken: 'refresh-1', idToken: '', scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'], expiresAt: 0 });
function account(record = credentials()) {
  const records = new Map(record ? [['account:chatgpt', JSON.stringify(record)]] : []);
  return { records, auth: new ChatGPTAccount({ vault: { get: (id) => records.get(id) ?? null, set: (id, value) => records.set(id, value), remove: (id) => records.delete(id) }, openExternal() {} }) };
}

test('identity requires a valid signature, issuer, audience, nonce and expiry', () => {
  assert.equal(verifyChatGPTIdentity(jwt(claims()), [jwk], 'issued-client', 'nonce-1').sub, 'user-1');
  for (const patch of [{ iss: 'https://evil.test' }, { aud: 'other-client' }, { nonce: 'other' }, { exp: 1 }])
    assert.throws(() => verifyChatGPTIdentity(jwt({ ...claims(), ...patch }), [jwk], 'issued-client', 'nonce-1'), /claims/);
  assert.throws(() => verifyChatGPTIdentity(jwt(claims()).slice(0, -8) + 'tampered', [jwk], 'issued-client', 'nonce-1'), /signature/);
  assert.throws(() => verifyChatGPTIdentity(jwt(claims(), { alg: 'none', kid: 'test-key' }), [jwk], 'issued-client'), /unsupported/);
});

test('loopback uses the required callback path and ignores unsolicited states', async () => {
  const result = await loopbackAuthorize({ state: 'expected', signal: new AbortController().signal, callbackPath: '/auth/callback', ignoreInvalidState: true, timeoutMs: 2000,
    messages: { declined: 'declined', failed: 'failed', timedOut: 'timeout' }, authorizationUrl: (uri) => uri,
    async openExternal(uri) {
      const wrong = await fetch(`${uri}?state=wrong&code=bad`); assert.equal(wrong.status, 400);
      await fetch(`${uri}?state=expected&code=valid&client_id=issued-client`);
    }
  });
  assert.equal(result.code, 'valid'); assert.equal(result.clientId, 'issued-client'); assert.match(result.redirectUri, /127\.0\.0\.1:\d+\/auth\/callback$/);
});

test('expired tokens refresh once across concurrent requests and keep the rotating replacement', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  const { auth, records } = account(); let requests = 0;
  global.fetch = async (url, init) => {
    requests++; assert.equal(url, 'https://auth.openai.com/api/accounts/oauth/token');
    assert.equal(init.body.get('client_id'), 'issued-client'); assert.equal(init.body.get('refresh_token'), 'refresh-1');
    assert.equal(init.body.get('scope'), null);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Response.json({ access_token: 'renewed', refresh_token: 'refresh-2', expires_in: 3600, token_type: 'Bearer' });
  };
  assert.deepEqual(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]), ['renewed', 'renewed', 'renewed']);
  assert.equal(requests, 1); assert.equal(JSON.parse(records.get('account:chatgpt')).refreshToken, 'refresh-2');
});

test('identity-only grants do not authorize inference', async () => {
  const { auth } = account({ ...credentials(), expiresAt: Date.now() + 3600000, scopes: ['openid'] });
  await assert.rejects(auth.accessToken(), /Connect your ChatGPT/);
});

test('browser registration validates identity, discovers account models and keeps credentials in the vault', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  const records = new Map(); let authorization;
  const auth = new ChatGPTAccount({ vault: { get: (id) => records.get(id) ?? null, set: (id, value) => records.set(id, value), remove: (id) => records.delete(id) }, async openExternal(url) {
    authorization = new URL(url);
    assert.equal(authorization.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(authorization.searchParams.get('agent_name_hint'), 'Axon');
    assert.match(authorization.searchParams.get('ext_agent_host_id'), /^urn:uuid:/);
    const callback = new URL(authorization.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ code: 'browser-code', state: authorization.searchParams.get('state'), client_id: 'issued-client' }).toString();
    await oldFetch(callback);
  } });
  global.fetch = async (url, init) => {
    if (url === 'https://auth.openai.com/api/accounts/oauth/token') {
      assert.equal(init.body.get('client_id'), 'issued-client'); assert.equal(init.body.get('code'), 'browser-code');
      assert.equal(crypto.createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'));
      assert.equal(init.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'));
      return Response.json({ access_token: 'plan-access', refresh_token: 'plan-refresh', id_token: jwt({ ...claims(), nonce: authorization.searchParams.get('nonce') }), token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile offline_access resource.invoke chatgpt.tokens.use.direct' });
    }
    if (url.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
    if (url === 'https://api.openai.com/v1/models') {
      assert.equal(init.headers.Authorization, 'Bearer plan-access');
      return Response.json({ models: [{ slug: 'account-model', display_name: 'Account model', visibility: 'list' }, { slug: 'private', visibility: 'hide' }] });
    }
    throw new Error('Unexpected network request');
  };
  const result = await auth.signIn();
  assert.deepEqual(result, { label: 'user@example.test', models: [{ id: 'account-model', displayName: 'Account model' }] });
  assert.ok(!JSON.stringify(result).includes('plan-access')); assert.equal(auth.connected, true);
  assert.equal(await auth.accessToken(), 'plan-access');
});

test('sign-out clears local credentials even when remote revocation fails, retaining the registration', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  global.fetch = async () => { throw new Error('offline'); };
  const { auth, records } = account();
  assert.deepEqual(await auth.signOut(), { remoteRevoked: false });
  const saved = JSON.parse(records.get('account:chatgpt'));
  assert.equal(saved.accessToken, ''); assert.equal(saved.refreshToken, ''); assert.equal(saved.clientId, 'issued-client');
  assert.equal(auth.connected, false);
});
