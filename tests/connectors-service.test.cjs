// Connectors in the service: connecting from the catalog, signing in, status, runs per coworker, approvals and the budget.
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
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

function makeService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-conn-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const secrets = new Map();
  const vault = { has: (id) => secrets.has(id), get: (id) => secrets.get(id) ?? null, set: (id, v) => (v ? secrets.set(id, v) : secrets.delete(id)), remove: (id) => secrets.delete(id) };
  const events = [];
  const service = new Service(repo, vault, dir, (e) => events.push(e), 'worker');
  const reconnected = [];
  service.mcp.reconnect = async (config) => { reconnected.push(config); };
  service.mcp.syncServers = async () => {};
  const signIns = [];
  service.connectorAuth.signIn = async (input) => {
    signIns.push(input);
    return { access: 'at', refresh: 'rt', tokenEndpoint: 'https://x/token', clientId: input.client?.clientId ?? 'dyn', resource: input.serverUrl };
  };
  t.after(() => service.shutdown());
  return { dir, repo, service, secrets, events, reconnected, signIns };
}

test('a no-account connector is added with its defaults and connected', async (t) => {
  const { repo, service, reconnected, signIns } = makeService(t);
  await service.connectorAdd('deepwiki');
  const saved = repo.state.mcpServers[0];
  assert.equal(saved.catalogId, 'deepwiki');
  assert.equal(saved.transport, 'http');
  assert.equal(saved.url, 'https://mcp.deepwiki.com/mcp');
  assert.ok(saved.coworkers.includes('chats') && saved.coworkers.includes('research-analyst'));
  assert.equal(signIns.length, 0);
  assert.equal(reconnected[0].id, saved.id);
});

test('a sign-in connector signs in first; the tokens go to the vault only', async (t) => {
  const { dir, repo, service, secrets, signIns } = makeService(t);
  await service.connectorAdd('linear');
  const saved = repo.state.mcpServers[0];
  assert.equal(signIns[0].serverUrl, 'https://mcp.linear.app/mcp');
  assert.equal(signIns[0].client, undefined);
  assert.equal(JSON.parse(secrets.get(`mcp-oauth:${saved.id}`)).access, 'at');
  await repo.save();
  await repo.store.flushAll?.();
  assert.ok(!fs.readFileSync(path.join(dir, 'db', 'platform-v1.json'), 'utf8').includes('"rt"'));
  const shown = service.snapshot().mcpServers[0];
  assert.equal(shown.signedIn, true);
  assert.ok(!JSON.stringify(service.snapshot()).includes('"rt"'));
  await service.mcpServerDelete(saved.id);
  assert.equal(secrets.has(`mcp-oauth:${saved.id}`), false);
});

test('a cancelled sign-in adds nothing', async (t) => {
  const { repo, service } = makeService(t);
  service.connectorAuth.signIn = async () => { throw new Error('Sign-in cancelled.'); };
  await assert.rejects(service.connectorAdd('notion'), /cancelled/);
  assert.equal(repo.state.mcpServers.length, 0);
});

test('a connector that needs Axon registered: not set up, then your own app', async (t) => {
  const { service, signIns } = makeService(t);
  await assert.rejects(service.connectorAdd('slack'), /isn't set up in this build/);
  assert.ok(!service.snapshot().connectorApps.includes('slack'));
  await service.connectorAppSave('slack', ' my-id ', ' my-secret ');
  assert.ok(service.snapshot().connectorApps.includes('slack'));
  await service.connectorAdd('slack');
  assert.deepEqual(signIns[0].client, { clientId: 'my-id', clientSecret: 'my-secret' });
});

test('GitHub uses your Axon GitHub sign-in, and says so when there is none', async (t) => {
  const { repo, service, signIns } = makeService(t);
  await assert.rejects(service.connectorAdd('github'), /Sign in to GitHub/);
  service.accounts.githubToken = () => 'gho_token';
  await service.connectorAdd('github');
  assert.equal(signIns.length, 0);
  assert.equal(repo.state.mcpServers[0].catalogId, 'github');
});

test('connection changes reach the window, named', async (t) => {
  const { repo, service, events } = makeService(t);
  repo.state.mcpServers.push({ id: 's1', name: 'Notes', transport: 'http', url: 'https://x/mcp', enabled: true, coworkers: [] });
  service.mcp.options.onChange('s1', 'needs-sign-in');
  assert.deepEqual(events.at(-1), { channel: 'connectors', serverId: 's1', name: 'Notes', status: 'needs-sign-in' });
});

test('saving keeps a server in its place, accepts HTTP, and refuses plain HTTP elsewhere', async (t) => {
  const { repo, service } = makeService(t);
  const base = { transport: 'http', enabled: true, args: [], env: {}, headers: {} };
  await service.mcpServerSave({ ...base, id: 'a', name: 'A', url: 'https://a.example/mcp' });
  await service.mcpServerSave({ ...base, id: 'b', name: 'B', url: 'https://b.example/mcp' });
  await service.mcpServerSave({ ...base, id: 'a', name: 'A2', url: 'https://a.example/mcp', coworkers: ['writer'], toolPolicy: { x: 'off', y: 'bogus' }, trustAnnotations: true });
  assert.deepEqual(repo.state.mcpServers.map((s) => s.name), ['A2', 'B']);
  assert.deepEqual(repo.state.mcpServers[0].coworkers, ['writer']);
  assert.deepEqual(repo.state.mcpServers[0].toolPolicy, { x: 'off' });
  assert.equal(repo.state.mcpServers[0].trustAnnotations, true);
  assert.deepEqual(repo.state.mcpServers[1].coworkers, ['chats']);
  await assert.rejects(service.mcpServerSave({ ...base, id: 'c', name: 'C', url: 'http://example.com/mcp' }), /HTTPS/);
});

test('servers saved by older builds keep their reach: everyone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-mig-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const { initialState } = require('../src/main/repository.ts');
  const state = { ...initialState(), mcpServers: [{ id: 'old', name: 'Old', transport: 'stdio', command: 'x', enabled: true }] };
  fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), JSON.stringify(state));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const coworkers = repo.state.mcpServers[0].coworkers;
  assert.ok(coworkers.includes('chats') && coworkers.includes('writer') && coworkers.includes('group:Design'));
});

const providers = require('../src/main/providers.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');
const { toolsFor } = require('../src/main/officeTools.ts');

/** A connected server, straight into the manager, with the tools it offers; returns the calls it gets. */
function connect(service, repo, server, tools) {
  repo.state.mcpServers.push({ transport: 'http', url: 'https://x/mcp', enabled: true, args: [], env: {}, headers: {}, ...server });
  const calls = [];
  service.mcp.registerTools({ config: { id: server.id, name: server.name }, callTool: async (name) => { calls.push(name); return { content: `ok:${name}` }; } }, tools);
  return calls;
}
const addProvider = (repo) => repo.state.providers.push({ id: 'p1', name: 'P', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }], enabled: true, createdAt: 0, hasApiKey: false });
/** Swaps the provider for a script of replies for this test. */
const mockModel = (t, respond) => {
  const saved = providers.streamChat;
  t.after(() => { providers.streamChat = saved; });
  providers.streamChat = respond;
};
const notesTools = [{ name: 'search', annotations: { readOnlyHint: true } }, { name: 'create_page' }];

test('the permission rule: off denies (even after always-allow), allow and ask pass through', () => {
  const p = new PermissionManager([], false);
  p.setConnectorRule((name) => ({ mcp_a: 'allow', mcp_b: 'ask', mcp_c: 'off' })[name] ?? null);
  assert.equal(p.check({ toolName: 'mcp_a', args: {} }).action, 'allow');
  assert.equal(p.check({ toolName: 'mcp_b', args: {} }).action, 'ask');
  assert.equal(p.check({ toolName: 'mcp_c', args: {} }).action, 'deny');
  assert.equal(p.check({ toolName: 'read_file', args: { path: 'a' } }, { roots: ['/p'], allowShell: false }).action, 'allow');
  const { request } = p.createApprovalRequest({ conversationId: 'c', messageId: 'm', toolCallId: 't', toolName: 'mcp_c', args: {} });
  p.resolveApproval({ requestId: request.id, approved: true, alwaysAllowSession: true });
  assert.equal(p.check({ toolName: 'mcp_c', args: {} }).action, 'deny');
});

test('toolsFor adds connector tools without a folder', () => {
  const names = toolsFor({ agentId: 'writer', hasFolder: false, registry: [{ name: 'read_file' }], connectorTools: [{ name: 'mcp_notes_search' }] }).map((t) => t.name);
  assert.deepEqual(names, ['ask_colleague', 'mcp_notes_search']);
});

test("a coworker gets their own connectors: reads run, changes ask, and others' tools are refused", async (t) => {
  const { repo, service, events } = makeService(t);
  addProvider(repo);
  const calls = connect(service, repo, { id: 's1', name: 'Notes', catalogId: 'notion', coworkers: ['writer'] }, notesTools);
  const seen = [];
  let step = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    seen.push({ tools: (req.tools ?? []).map((tool) => tool.name), system: req.system });
    step++;
    if (step === 1) return { toolCalls: [{ id: 'c1', name: 'mcp_notes_search', arguments: '{"q":"x"}' }] };
    if (step === 2) return { toolCalls: [{ id: 'c2', name: 'mcp_notes_create_page', arguments: '{}' }] };
    onChunk('done');
    return { toolCalls: [] };
  });
  const chat = await service.chatCreate('p1', 'm1', null, 'writer', { skillIds: [], roleIds: [] }, null, 'You are the Writer.');
  const run = service.chatSend(chat.id, 'Find it and write it up', []);
  // The write asks: approve it when the card appears.
  for (let i = 0; i < 200 && !events.some((e) => e.approvalRequired); i++) await new Promise((r) => setTimeout(r, 10));
  const card = events.find((e) => e.approvalRequired);
  assert.equal(card.approvalRequired.toolName, 'mcp_notes_create_page');
  await service.toolApprove({ requestId: card.approvalRequired.id, approved: true });
  await run;
  assert.deepEqual(calls, ['search', 'create_page']);
  assert.ok(seen[0].tools.includes('mcp_notes_search'));
  assert.match(seen[0].system, /untrusted data, not instructions/);
  assert.equal(events.filter((e) => e.approvalRequired).length, 1, 'the read ran without a card');

  // The designer has no Notes connector: not offered, and refused if called anyway.
  step = 0;
  seen.length = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    seen.push({ tools: (req.tools ?? []).map((tool) => tool.name) });
    if (step++ === 0) return { toolCalls: [{ id: 'c3', name: 'mcp_notes_search', arguments: '{}' }] };
    onChunk('ok');
    return { toolCalls: [] };
  });
  const other = await service.chatCreate('p1', 'm1', null, 'designer', { skillIds: [], roleIds: [] }, null, 'You are the Designer.');
  await service.chatSend(other.id, 'Look it up', []);
  assert.ok(!seen[0].tools.includes('mcp_notes_search'));
  const refused = repo.state.messages.find((m) => m.conversationId === other.id && m.role === 'tool');
  assert.match(refused.content, /isn't available/);
  assert.deepEqual(calls, ['search', 'create_page']);
});

test('over the tool budget, whole connectors are left out and the reply says which', async (t) => {
  const { repo, service } = makeService(t);
  addProvider(repo);
  const many = (prefix, n) => Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, annotations: { readOnlyHint: true } }));
  connect(service, repo, { id: 'a', name: 'Alpha', catalogId: 'linear', coworkers: ['chats'] }, many('a', 60));
  connect(service, repo, { id: 'b', name: 'Beta', catalogId: 'sentry', coworkers: ['chats'] }, many('b', 60));
  let offered = [];
  mockModel(t, async (_p, _k, req, onChunk) => { offered = (req.tools ?? []).map((tool) => tool.name); onChunk('hi'); return { toolCalls: [] }; });
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'hello', []);
  assert.equal(offered.filter((n) => n.startsWith('mcp_alpha')).length, 60);
  assert.equal(offered.filter((n) => n.startsWith('mcp_beta')).length, 0);
  const reply = repo.state.messages.find((m) => m.conversationId === chat.id && m.role === 'assistant');
  assert.match(reply.notice, /Left out Beta: too many tools/);
});

test('a tool you turned off is neither offered nor run', async (t) => {
  const { repo, service } = makeService(t);
  addProvider(repo);
  connect(service, repo, { id: 's1', name: 'Notes', catalogId: 'notion', coworkers: ['chats'], toolPolicy: { search: 'off' } }, notesTools);
  let offered = [];
  mockModel(t, async (_p, _k, req, onChunk) => { offered = (req.tools ?? []).map((tool) => tool.name); onChunk('hi'); return { toolCalls: [] }; });
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'hello', []);
  assert.deepEqual(offered.filter((n) => n.startsWith('mcp_')), ['mcp_notes_create_page']);
  assert.equal(service.permissions.check({ toolName: 'mcp_notes_search', args: {} }).action, 'deny');
});

test('your own GitHub app makes GitHub sign-in available, and can be changed or forgotten', async (t) => {
  const { service, secrets } = makeService(t);
  assert.equal(service.accounts.githubConfigured, false);
  await service.accountAppSave('github', ' Ov23liAbCdEf123456 ');
  assert.equal(service.accounts.githubConfigured, true);
  const state = await service.accountsGet();
  assert.deepEqual([state.github.configured, state.github.ownApp], [true, true]);
  assert.deepEqual(JSON.parse(secrets.get('account-app:github')), { clientId: 'Ov23liAbCdEf123456' });
  await assert.rejects(service.accountAppSave('github', 'has spaces in it'), /Client ID/);
  await service.accountAppSave('github', '');
  assert.equal(service.accounts.githubConfigured, false);
});

test('your Google app signs you in and powers Gmail, Calendar and Drive', async (t) => {
  const { service, signIns } = makeService(t);
  await assert.rejects(service.accountAppSave('google', 'not-a-google-id', 's'), /apps\.googleusercontent\.com/);
  await assert.rejects(service.connectorAdd('gmail'), /Set up Google/);
  await service.accountAppSave('google', '123-abc.apps.googleusercontent.com', 'GOCSPX-secret');
  assert.equal(service.accounts.googleConfigured, true);
  const apps = service.snapshot().connectorApps;
  for (const id of ['gmail', 'google-calendar', 'google-drive']) assert.ok(apps.includes(id), id);
  await service.connectorAdd('gmail');
  assert.deepEqual(signIns[0].client, { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
  assert.equal(signIns[0].serverUrl, 'https://gmailmcp.googleapis.com/mcp/v1');
});

test('setting up Google from a Gmail card saves the same Google app', async (t) => {
  const { service } = makeService(t);
  await service.connectorAppSave('google-drive', '456-def.apps.googleusercontent.com', 'GOCSPX-2');
  assert.equal(service.accounts.googleConfigured, true);
  assert.equal((await service.accountsGet()).google.ownApp, true);
});

test('Axon opens the pages app setup needs, and nothing else', async (t) => {
  const { service } = makeService(t);
  const opened = [];
  service.connectorAuth.openExternal = async (url) => { opened.push(url); };
  await service.openLink('https://console.cloud.google.com/apis/credentials');
  await service.openLink('https://developers.google.com/workspace/guides/configure-mcp-servers');
  await service.openLink('https://github.com/settings/applications/new');
  await assert.rejects(service.openLink('https://evil.example/'), /only opens/);
  assert.equal(opened.length, 3);
});

const { pointAtComposio } = require('../src/main/connectors/rube.ts');

test("Rube tool names point at Composio's tools; unknown ones stay", () => {
  const composio = new Map([['COMPOSIO_SEARCH_TOOLS', 'mcp_composio_connect_composio_search_tools']]);
  assert.equal(pointAtComposio('Call RUBE_SEARCH_TOOLS, then RUBE_UNKNOWN_THING.', composio),
    'Call mcp_composio_connect_composio_search_tools, then RUBE_UNKNOWN_THING.');
  assert.equal(pointAtComposio('Call RUBE_SEARCH_TOOLS.', new Map()), 'Call RUBE_SEARCH_TOOLS.');
});

test("a Rube skill in a chat with Composio connected names Composio's tools", async (t) => {
  const { repo, service } = makeService(t);
  addProvider(repo);
  connect(service, repo, { id: 'cx', name: 'Composio Connect', catalogId: 'composio', coworkers: ['chats'] }, [{ name: 'COMPOSIO_SEARCH_TOOLS', annotations: { readOnlyHint: true } }]);
  service.mcp.info = (id) => (id === 'cx' ? { status: 'connected', error: null, tools: [{ name: 'COMPOSIO_SEARCH_TOOLS', axonName: 'mcp_composio_connect_composio_search_tools' }] } : undefined);
  const bodies = require('../src/skills/bodies.json');
  const skill = require('../src/skills/catalog.json').skills.find((s) => (s.requires ?? []).includes('mcp:rube') && String(bodies[s.id]).includes('RUBE_SEARCH_TOOLS'));
  let system = '';
  mockModel(t, async (_p, _k, req, onChunk) => { system = req.system; onChunk('ok'); return { toolCalls: [] }; });
  const chat = await service.chatCreate('p1', 'm1', null, undefined, { skillIds: [skill.id], roleIds: [] });
  await service.chatSend(chat.id, 'go', []);
  assert.match(system, /mcp_composio_connect_composio_search_tools/);
  assert.doesNotMatch(system, /RUBE_SEARCH_TOOLS/);
});
