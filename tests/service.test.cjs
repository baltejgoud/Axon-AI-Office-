const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

const makeService = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, () => {}, 'parser-worker-path');
  return { dir, repo, service };
};

test('chatSelectionSet rejects unknown ids and caps at 50', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  repo.state.providers.push({ id: 'p', name: 'P', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [{ id: 'm', displayName: 'm' }], enabled: true, createdAt: 0, hasApiKey: false });
  const chat = await service.chatCreate('p', 'm', null);
  await assert.rejects(service.chatSelectionSet(chat.id, { skillIds: ['nope/x'], roleIds: [] }), /Unknown skill: nope\/x/);
  await assert.rejects(service.chatSelectionSet(chat.id, { skillIds: [], roleIds: Array.from({ length: 51 }, () => 'frontend-developer') }), /at most 50 roles/);
  await service.chatSelectionSet(chat.id, { skillIds: ['superpowers/brainstorming'], roleIds: ['frontend-developer', 'frontend-developer'] });
  assert.deepEqual(repo.state.conversations.find(c => c.id === chat.id).roleIds, ['frontend-developer']);
});

test('chatCreate merges agent selections first', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  repo.state.providers.push({ id: 'p', name: 'P', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [{ id: 'm', displayName: 'm' }], enabled: true, createdAt: 0, hasApiKey: false });
  const agent = {
    id: repo.id(), name: 'Agent', systemPrompt: 'You are an agent.', providerId: null, modelId: null,
    tools: [], workspaceId: null, skillIds: ['ponytail/ponytail-review'], roleIds: ['backend-developer'],
    maxSteps: 1, schedule: { kind: 'manual' }, createdAt: Date.now(), updatedAt: Date.now()
  };
  repo.state.agents.push(agent);
  const chat = await service.chatCreate('p', 'm', null, agent.id, { skillIds: ['superpowers/brainstorming'], roleIds: ['backend-developer', 'frontend-developer'] });
  assert.deepEqual(chat.skillIds, ['ponytail/ponytail-review', 'superpowers/brainstorming']);
  assert.deepEqual(chat.roleIds, ['backend-developer', 'frontend-developer']);
});

test('workspaceSave rejects an unknown role', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = repo.state.workspaces[0];
  await assert.rejects(service.workspaceSave({ ...ws, roleIds: ['nope'] }), /Unknown role: nope/);
});
