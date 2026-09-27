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
