// Claude through a Claude Console API key: the key check (free model list, never a message), identity,
// workspaces, cancel, the connection's lifecycle in the service, and what Claude requests report back.
// Every network call here is mocked: no key is real and nothing is billed.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {}, shell: { openExternal() {} }, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkClaudeKey, cleanWorkspaceId, ClaudeConnection, ClaudeKeyError, rateLimitsOf, CLAUDE_PROVIDER_ID } = require('../src/main/accounts/claude.ts');
const { streamChat, listModels, contextModel, lastRateLimits } = require('../src/main/providers.ts');
const { isContextOverflow } = require('../src/main/context.ts');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

const KEY = 'sk-ant-api03-test-key-not-real';
const ORG = '3f2a9c1e-0b7d-4c55-9a1e-6d2f8b4c9e01';
const models = (data, extra = {}) => ({ data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, ...extra });
const opus = { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000, capabilities: { image_input: { supported: true } } };
const haiku = { type: 'model', id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000, max_tokens: 64_000 };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const identity = { 'anthropic-organization-id': ORG, 'anthropic-workspace-id': 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ', 'request-id': 'req_011CSHoEeqs5C35K2UUqR7Fy' };

/** Replaces fetch for one test; every request it saw, with its method and headers. */
function mockFetch(t, respond) {
  const saved = global.fetch;
  const seen = [];
  global.fetch = async (url, init = {}) => {
    const request = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body };
    seen.push(request);
    return respond(request, seen.length, init);
  };
  t.after(() => { global.fetch = saved; });
  return seen;
}
const neverPaid = (seen) => assert.ok(seen.every((r) => r.method === 'GET' && new URL(r.url).pathname === '/v1/models'), 'only the free model list is requested');

test('a key is checked with the free model list only: models, limits, identity, and never the key in what comes back', async (t) => {
  const seen = mockFetch(t, (r, n) => n === 1
    ? json(models([opus], { has_more: true }), 200, identity)
    : json(models([haiku]), 200, identity));
  const checked = await checkClaudeKey(KEY, undefined, new AbortController().signal);
  neverPaid(seen);
  assert.equal(seen.length, 2, 'follows the model list onto its next page');
  assert.equal(new URL(seen[1].url).searchParams.get('after_id'), 'claude-opus-5-5');
  assert.equal(seen[0].headers['x-api-key'], KEY);
  assert.equal(seen[0].headers['anthropic-version'], '2023-06-01');
  assert.equal('anthropic-workspace-id' in seen[0].headers, false);
  assert.equal('Authorization' in seen[0].headers, false, 'no OAuth bearer token is involved');
  assert.deepEqual(checked, {
    organizationId: ORG,
    workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ',
    models: [
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsVision: true },
      { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', contextWindow: 200_000, maxOutputTokens: 64_000 }
    ]
  });
  assert.ok(!JSON.stringify(checked).includes(KEY));
});

test('a refused key says what to do, with the request ID, and never shows the key', async (t) => {
  mockFetch(t, () => json({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }, 401, { 'request-id': 'req_abc123' }));
  await assert.rejects(checkClaudeKey(KEY, undefined, new AbortController().signal), (error) => {
    assert.ok(error instanceof ClaudeKeyError);
    assert.match(error.message, /did not accept this API key/);
    assert.match(error.message, /Claude Console → API keys/);
    assert.match(error.message, /req_abc123/);
    assert.doesNotMatch(error.message, new RegExp(KEY));
    assert.equal(error.needsWorkspace, false);
    return true;
  });
});

test('a key that spans workspaces asks for one, and the workspace then goes on every request', async (t) => {
  const seen = mockFetch(t, (r) => r.headers['anthropic-workspace-id']
    ? json(models([opus]), 200, identity)
    : json({ type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace this request acts in.' } }, 400));
  await assert.rejects(checkClaudeKey(KEY, undefined, new AbortController().signal), (error) => error.needsWorkspace && /more than one workspace/.test(error.message));
  const checked = await checkClaudeKey(KEY, 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ', new AbortController().signal);
  assert.equal(seen.at(-1).headers['anthropic-workspace-id'], 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  assert.equal(checked.models.length, 1);
  assert.equal(cleanWorkspaceId('  wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ '), 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  assert.equal(cleanWorkspaceId(''), undefined);
  assert.throws(() => cleanWorkspaceId('workspace one'), /starts with wrkspc_/);
});

test('a key whose workspace has no models is not connected', async (t) => {
  mockFetch(t, () => json(models([]), 200, identity));
  await assert.rejects(checkClaudeKey(KEY, undefined, new AbortController().signal), /can't use any Claude models/);
});

test('Cancel stops a key check under way', async (t) => {
  mockFetch(t, (r, n, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
  const connection = new ClaudeConnection();
  const pending = connection.check(KEY);
  setTimeout(() => connection.cancel(), 20);
  await assert.rejects(pending, /cancelled/);
});

test('rate limits are read from Anthropic\'s headers, and absent ones stay absent', () => {
  const headers = new Headers({
    'anthropic-ratelimit-requests-limit': '1000', 'anthropic-ratelimit-requests-remaining': '999', 'anthropic-ratelimit-requests-reset': '2026-10-08T17:00:00Z',
    'anthropic-ratelimit-input-tokens-limit': '2000000', 'anthropic-ratelimit-input-tokens-remaining': '1998000',
    'anthropic-ratelimit-output-tokens-limit': 'many', 'anthropic-ratelimit-output-tokens-remaining': '1'
  });
  assert.deepEqual(rateLimitsOf(headers, 'claude-opus-5-5', 5), {
    model: 'claude-opus-5-5', at: 5,
    requests: { limit: 1000, remaining: 999, reset: '2026-10-08T17:00:00Z' },
    inputTokens: { limit: 2_000_000, remaining: 1_998_000 }
  });
  assert.equal(rateLimitsOf(new Headers(), 'm'), null);
});

// ------------------------------------------------------------------ Requests through the connection

const claude = { id: CLAUDE_PROVIDER_ID, kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: [], workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ' };
const sse = (...events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

test('a Claude request names its workspace, counts cached prompt tokens, and keeps the reported rate limits', async (t) => {
  const seen = mockFetch(t, () => new Response(sse(
    { type: 'message_start', message: { usage: { input_tokens: 12, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 42 } }
  ), { headers: { 'anthropic-ratelimit-requests-limit': '1000', 'anthropic-ratelimit-requests-remaining': '998' } }));
  const result = await streamChat(claude, KEY, { model: 'claude-opus-5-5', maxTokens: 100, messages: [{ role: 'user', content: 'Hi' }] }, () => {});
  assert.equal(seen[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen[0].headers['anthropic-workspace-id'], 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  assert.equal(result.promptTokens, 4312, 'input, cache writes and cache reads together are the prompt');
  assert.equal(result.cachedPromptTokens, 4000);
  assert.equal(result.completionTokens, 42);
  assert.deepEqual(lastRateLimits(CLAUDE_PROVIDER_ID).requests, { limit: 1000, remaining: 998 });
});

test('an empty credit balance says where Claude API credits come from, with the request ID', async (t) => {
  mockFetch(t, () => json({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }, 400, { 'request-id': 'req_low' }));
  await assert.rejects(streamChat(claude, KEY, { model: 'claude-opus-5-5', maxTokens: 10, messages: [{ role: 'user', content: 'Hi' }] }, () => {}), (error) => {
    assert.match(error.message, /Claude Console → Settings → Billing/);
    assert.match(error.message, /Max or Team plan/);
    assert.match(error.message, /Claude plan usage limits do not apply/);
    assert.match(error.message, /req_low/);
    return true;
  });
});

test('the monthly spend cap is not retried, and says when access returns', async (t) => {
  const seen = mockFetch(t, () => json({ type: 'error', error: { type: 'rate_limit_error', message: 'You have reached your API usage limits.', details: { error_code: 'enforced_spend_limit_reached' } } }, 429));
  await assert.rejects(streamChat(claude, KEY, { model: 'claude-opus-5-5', maxTokens: 10, messages: [{ role: 'user', content: 'Hi' }] }, () => {}), /monthly spend cap/);
  assert.equal(seen.length, 1);
});

test('an expired or deleted key points to the Claude card', async (t) => {
  mockFetch(t, () => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
  await assert.rejects(streamChat(claude, KEY, { model: 'claude-opus-5-5', maxTokens: 10, messages: [{ role: 'user', content: 'Hi' }] }, () => {}), /Settings → Accounts → Claude/);
});

test('Anthropic\'s context-limit errors start Axon\'s condensing retry', () => {
  assert.equal(isContextOverflow(new Error('Provider returned HTTP 400: prompt is too long: 1000001 tokens > 1000000 maximum.')), true);
  assert.equal(isContextOverflow(new Error('input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000')), true);
});

test('an Anthropic key added in Models & API keys learns each model\'s limits from the model list', async (t) => {
  mockFetch(t, () => json(models([opus])));
  const generic = { id: 'anthropic-generic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: [] };
  assert.deepEqual(await listModels(generic, KEY), ['claude-opus-5-5']);
  const spec = contextModel(generic, 'claude-opus-5-5');
  assert.equal(spec.contextWindow, 1_000_000);
  assert.equal(spec.maxOutputTokens, 128_000);
});

// ------------------------------------------------------------------ The connection in the service

function service(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-claude-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const secrets = new Map();
  const vault = { has: (id) => secrets.has(id), get: (id) => secrets.get(id) ?? null, set: (id, s) => (s ? secrets.set(id, s) : secrets.delete(id)), remove: (id) => secrets.delete(id) };
  const svc = new Service(repo, vault, dir, () => {}, 'worker');
  t.after(() => { svc.shutdown(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  return { svc, repo, secrets };
}

test('connecting saves the key in the vault and a Claude provider with identity and models; nothing secret is in state', async (t) => {
  const seen = mockFetch(t, () => json(models([opus, haiku]), 200, identity));
  const { svc, repo, secrets } = service(t);
  const result = await svc.claudeConnect({ key: `  ${KEY}\n` });
  neverPaid(seen);
  assert.deepEqual(result, { ok: true, models: 2, organizationChanged: false });
  assert.equal(secrets.get(CLAUDE_PROVIDER_ID), KEY, 'stored cleaned, in the vault');
  const provider = repo.state.providers.find((p) => p.id === CLAUDE_PROVIDER_ID);
  assert.equal(provider.kind, 'anthropic');
  assert.equal(provider.baseUrl, 'https://api.anthropic.com/v1');
  assert.equal(provider.hasApiKey, true);
  assert.equal(provider.auth, undefined, 'an API key is never presented as a subscription account');
  assert.equal(provider.claudeConsole.organizationId, ORG);
  assert.deepEqual(provider.models.map((m) => m.id), ['claude-opus-5-5', 'claude-haiku-4-5-20251001']);
  assert.ok(!JSON.stringify(repo.state).includes(KEY));
});

test('a refused key leaves the saved connection as it was; a multi-workspace key asks instead of failing', async (t) => {
  const { svc, repo, secrets } = service(t);
  mockFetch(t, () => json(models([opus]), 200, identity));
  await svc.claudeConnect({ key: KEY });
  global.fetch = async () => json({ type: 'error', error: { message: 'invalid x-api-key' } }, 401);
  await assert.rejects(svc.claudeConnect({ key: 'sk-ant-api03-other' }), /did not accept this API key/);
  assert.equal(secrets.get(CLAUDE_PROVIDER_ID), KEY);
  global.fetch = async () => json({ type: 'error', error: { message: 'anthropic-workspace-id is required when authenticating with an identity-linked API key' } }, 400);
  const asked = await svc.claudeConnect({ key: 'sk-ant-api03-other' });
  assert.equal(asked.ok, false);
  assert.equal(asked.needsWorkspace, true);
  assert.equal(secrets.get(CLAUDE_PROVIDER_ID), KEY);
  assert.equal(repo.state.providers.filter((p) => p.id === CLAUDE_PROVIDER_ID).length, 1);
});

test('replacing the key reports a different organization; refresh keeps your prices', async (t) => {
  const { svc, repo } = service(t);
  mockFetch(t, () => json(models([opus]), 200, identity));
  await svc.claudeConnect({ key: KEY });
  const provider = repo.state.providers.find((p) => p.id === CLAUDE_PROVIDER_ID);
  await svc.providerSave({ ...provider, models: provider.models.map((m) => ({ ...m, contextWindow: 200_000, pricePerMillionInputTokens: 4, pricePerMillionOutputTokens: 20 })) });
  await svc.claudeRefreshModels();
  const refreshed = repo.state.providers.find((p) => p.id === CLAUDE_PROVIDER_ID);
  assert.equal(refreshed.models[0].pricePerMillionInputTokens, 4);
  assert.equal(refreshed.models[0].contextWindow, 200_000, 'a lower context window you chose is kept');
  assert.equal(refreshed.models[0].maxOutputTokens, 128_000);
  assert.equal(refreshed.claudeConsole.organizationId, ORG);
  global.fetch = async () => json(models([opus]), 200, { ...identity, 'anthropic-organization-id': '9d8c7b6a-0000-4000-8000-000000000002' });
  const replaced = await svc.claudeConnect({ key: 'sk-ant-api03-second' });
  assert.equal(replaced.organizationChanged, true);
});

test('Settings cannot repoint the connection or swap its key outside its card, but can turn it off', async (t) => {
  const { svc, repo, secrets } = service(t);
  mockFetch(t, () => json(models([opus]), 200, identity));
  await svc.claudeConnect({ key: KEY, workspaceId: 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ' });
  const provider = repo.state.providers.find((p) => p.id === CLAUDE_PROVIDER_ID);
  await assert.rejects(svc.providerSave({ ...provider, baseUrl: 'https://proxy.example/v1' }), /only uses Anthropic's API/);
  await assert.rejects(svc.providerSave({ ...provider }, 'sk-ant-api03-swapped'), /Settings → Accounts/);
  await assert.rejects(svc.providerSave({ ...provider, id: CLAUDE_PROVIDER_ID, claudeConsole: undefined }, ''), /Settings → Accounts/);
  await svc.providerSave({ ...provider, enabled: false, claudeConsole: { organizationId: 'forged', verifiedAt: 1 }, workspaceId: 'wrkspc_forged0000' });
  const saved = repo.state.providers.find((p) => p.id === CLAUDE_PROVIDER_ID);
  assert.equal(saved.enabled, false);
  assert.equal(saved.claudeConsole.organizationId, ORG, 'identity comes only from Anthropic');
  assert.equal(saved.workspaceId, 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ');
  assert.equal(secrets.get(CLAUDE_PROVIDER_ID), KEY);
});

test('disconnecting forgets the key and the provider, as removing it in Settings does', async (t) => {
  const { svc, repo, secrets } = service(t);
  mockFetch(t, () => json(models([opus]), 200, identity));
  await svc.claudeConnect({ key: KEY });
  await svc.claudeDisconnect();
  assert.equal(secrets.has(CLAUDE_PROVIDER_ID), false);
  assert.equal(repo.state.providers.some((p) => p.id === CLAUDE_PROVIDER_ID), false);
  await svc.claudeConnect({ key: KEY });
  await svc.providerDelete(CLAUDE_PROVIDER_ID);
  assert.equal(secrets.has(CLAUDE_PROVIDER_ID), false);
  await assert.rejects(svc.claudeRefreshModels(), /Connect Claude first/);
});
