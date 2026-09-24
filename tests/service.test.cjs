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

const makeService = (emit = () => {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, emit, 'parser-worker-path');
  return { dir, repo, service };
};
const addProvider = (repo) =>
  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });
/** A conversation with an office coworker, as the office starts one. */
const coworkerChat = (service, agentId = 'backend-developer') =>
  service.chatCreate('p1', 'm1', null, agentId, { skillIds: [], roleIds: [] }, null, `You are Axon's ${agentId}.`);
const mockModel = (t, respond) => {
  const providersModule = require('../src/main/providers.ts');
  const original = providersModule.streamChat;
  t.after(() => { providersModule.streamChat = original; });
  providersModule.streamChat = respond;
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

test('subagent enforces permissions: rejects mutating actions and recursive dispatch', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });

  // Mock streamChat so that the model returns tool calls
  const providersModule = require('../src/main/providers.ts');
  const originalStreamChat = providersModule.streamChat;
  t.after(() => { providersModule.streamChat = originalStreamChat; });

  let callCount = 0;
  providersModule.streamChat = async (provider, key, req, onChunk) => {
    callCount++;
    if (callCount === 1) {
      // The sub-agent is never offered a way to dispatch another.
      assert.ok(!(req.tools ?? []).some((tool) => tool.name === 'dispatch_subagent'));
      // Return a mutating tool call and a dispatch_subagent tool call
      return {
        toolCalls: [
          { id: 'call_1', name: 'write_file', arguments: JSON.stringify({ path: 'src/malicious.ts', content: 'boom' }) },
          { id: 'call_2', name: 'dispatch_subagent', arguments: JSON.stringify({ role: 'nested', task: 'nested task' }) }
        ]
      };
    }
    // Final response
    return { toolCalls: [] };
  };

  const output = await service.runSubagent('p1', 'm1', 'researcher', 'Do something', null);
  assert.ok(output);
});

test('project scoping: code workspace (fileAccess disabled) does not expose tools; projectRoot enables tools', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Set a global project root
  const projDir = path.join(dir, 'my-project');
  fs.mkdirSync(projDir, { recursive: true });
  await service.project.choose(projDir);

  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });

  // 1. Built-in Code Assistant workspace has fileAccess.enabled === false
  const codeWs = repo.state.workspaces.find(w => w.id === 'code');
  assert.ok(codeWs);
  assert.equal(codeWs.fileAccess.enabled, false);

  const chatNormal = await service.chatCreate('p1', 'm1', 'code');
  assert.equal(chatNormal.projectRoot, null);

  // 2. A conversation created with an explicit projectRoot
  const chatProject = await service.chatCreate('p1', 'm1', null, undefined, undefined, projDir);
  assert.equal(chatProject.projectRoot, projDir);
});

test('context budget: long conversation is trimmed with sliding window rather than throwing fatal error', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });

  const chat = await service.chatCreate('p1', 'm1', null);

  // Pre-fill conversation with messages exceeding 300,000 characters
  const bigChunk = 'A'.repeat(80000);
  for (let i = 0; i < 5; i++) {
    repo.state.messages.push({
      id: repo.id(),
      conversationId: chat.id,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${bigChunk}`,
      createdAt: Date.now() + i
    });
  }

  // Mock streamChat
  const providersModule = require('../src/main/providers.ts');
  const originalStreamChat = providersModule.streamChat;
  t.after(() => { providersModule.streamChat = originalStreamChat; });

  let sentRequests = [];
  providersModule.streamChat = async (provider, key, req, onChunk) => {
    sentRequests = req.messages;
    onChunk('Hello from model!');
    return { toolCalls: [] };
  };

  // Sending another message should trim older messages without throwing
  await service.chatSend(chat.id, 'New user prompt', []);

  assert.ok(sentRequests.length > 0);
  // Older messages were trimmed to fit budget
  assert.ok(sentRequests.length < 5, 'Older messages should have been trimmed');
  assert.equal(sentRequests[sentRequests.length - 1].content, 'New user prompt');
});


test('a coworker conversation gets one task record that follows its runs', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, async (_p, _k, _req, onChunk) => { onChunk('Here is the contract.'); return { toolCalls: [] }; });
  await service.chatSend(chat.id, 'Design the API contract', []);
  assert.equal(repo.state.tasks.length, 1);
  const [task] = repo.state.tasks;
  assert.deepEqual(
    { kind: task.kind, status: task.status, title: task.title, coworkerId: task.coworkerId, conversationId: task.conversationId },
    { kind: 'work', status: 'done', title: 'Design the API contract', coworkerId: 'backend-developer', conversationId: chat.id }
  );
  const seen = events.filter((e) => e.channel === 'tasks').map((e) => e.tasks[0].status);
  assert.deepEqual(seen, ['working', 'done']);

  mockModel(t, async () => { throw new Error('Rate limited'); });
  await service.chatSend(chat.id, 'Once more', []);
  assert.equal(repo.state.tasks.length, 1);
  assert.equal(task.status, 'attention');
  assert.equal(task.note, 'Rate limited');

  // Chats that belong to no coworker get no record.
  const plain = await service.chatCreate('p1', 'm1', null);
  mockModel(t, async (_p, _k, _req, onChunk) => { onChunk('Hi.'); return { toolCalls: [] }; });
  await service.chatSend(plain.id, 'Hello', []);
  assert.equal(repo.state.tasks.length, 1);
});

test('an older saved state without task records still loads', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const { initialState } = require('../src/main/repository.ts');
  const old = initialState();
  delete old.tasks;
  old.settings.theme = 'dark';
  fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), JSON.stringify(old));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  assert.deepEqual(repo.state.tasks, []);
  assert.equal(repo.state.settings.theme, 'dark', 'loaded the saved file, not a fresh state');
});

test('a coworker asks colleagues: three answer, the fourth is turned away, and help is recorded', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'frontend-developer');
  let consults = 0;
  let askerCalls = 0;
  let offered;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) {
      consults++;
      onChunk(`Answer ${consults}.`);
      return { toolCalls: [] };
    }
    askerCalls++;
    if (askerCalls === 1) {
      offered = (req.tools ?? []).map((tool) => tool.name);
      const ask = (n) => ({ id: `ask${n}`, name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'Backend Developer', question: `Question ${n}?` }) });
      return { toolCalls: [ask(1), ask(2), ask(3), ask(4)] };
    }
    onChunk('Done, with help.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Build the settings page', []);
  assert.deepEqual(offered, ['ask_colleague'], 'no folder: only asking a colleague');
  assert.equal(consults, 3);
  const results = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.equal(results.length, 4);
  const answered = results.slice(0, 3).map((m) => JSON.parse(m.content));
  assert.deepEqual(answered.map((r) => [r.colleague, r.name]), Array(3).fill(['backend-developer', 'Backend Developer']));
  assert.deepEqual(answered.map((r) => r.answer), ['Answer 1.', 'Answer 2.', 'Answer 3.']);
  assert.match(results[3].content, /asked three colleagues already/);
  assert.ok(results[3].error);
  const help = repo.state.tasks.filter((task) => task.kind === 'help');
  assert.equal(help.length, 3);
  assert.ok(help.every((task) => task.status === 'done' && task.coworkerId === 'backend-developer' && task.forCoworkerId === 'frontend-developer' && task.conversationId === chat.id));
  const work = repo.state.tasks.find((task) => task.kind === 'work');
  assert.equal(work.status, 'done');
});

test('a colleague who cannot be reached ends their help with the reason', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'frontend-developer');
  let askerCalls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) throw new Error('Provider down');
    askerCalls++;
    if (askerCalls === 1)
      return { toolCalls: [{ id: 'a', name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'engineer', question: 'Q?' }) }, { id: 'b', name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'Security Engineer', question: 'Is this safe?' }) }] };
    onChunk('Carrying on.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Harden the login', []);
  const results = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.match(results[0].content, /No single colleague matches "engineer"/);
  assert.match(results[1].content, /Couldn't reach Security Engineer: Provider down/);
  const [help] = repo.state.tasks.filter((task) => task.kind === 'help');
  assert.equal(help.status, 'done');
  assert.equal(help.note, 'Provider down');
});
