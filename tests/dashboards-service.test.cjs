// Dashboards through the service: a coworker's show_dashboard call is saved, sent to the window and
// answered; deleting asks first; saved data from before dashboards loads with none.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
const electron = { app: { isPackaged: false, relaunch() {}, quit() {} }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');
const providers = require('../src/main/providers.ts');

const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-dash-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  return dir;
};

async function setup(t) {
  const events = [];
  const dir = temp();
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, (event) => events.push(event), 'parser-worker-path');
  t.after(async () => {
    service.stopAll();
    service.shutdown();
    await repo.store.flushAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });
  repo.state.settings.autoTitleConversations = false;
  return { service, repo, events };
}

function mockModel(t, respond) {
  const saved = providers.streamChat;
  t.after(() => { providers.streamChat = saved; });
  let n = 0;
  providers.streamChat = async (_p, _k, req, onChunk) => respond(++n, req, onChunk);
}

async function waitFor(find, what) {
  for (let i = 0; i < 1500; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const LEADS = { title: 'Leads', widgets: [{ type: 'stat', label: 'Leads', value: 3 }] };

test('a coworker shows a dashboard: saved, sent to the window, answered, and deletable', async (t) => {
  const { service, repo, events } = await setup(t);
  const chat = await service.chatCreate('p1', 'm1', null, 'research-analyst', { skillIds: [], roleIds: [] }, null, 'You are the Research Analyst.');
  let answer;
  mockModel(t, async (n, req, onChunk) => {
    if (n === 1) {
      assert.ok(req.tools.some((x) => x.name === 'show_dashboard'), 'the tool is offered');
      return { toolCalls: [{ id: 'call1', name: 'show_dashboard', arguments: JSON.stringify(LEADS) }] };
    }
    answer = req.messages.at(-1);
    onChunk('Here is the dashboard.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'show me the leads', []);
  await waitFor(
    () => repo.conversationMessages(chat.id).some((m) => m.role === 'assistant' && !m.streaming && m.content.includes('Here is')),
    'the answer'
  );
  assert.equal(repo.state.dashboards.length, 1);
  const [dashboard] = repo.state.dashboards;
  assert.equal(dashboard.agentId, 'research-analyst');
  assert.equal(dashboard.conversationId, chat.id);
  assert.deepEqual(dashboard.toolCallIds, ['call1']);
  assert.match(String(answer.content), /on screen for the user/);
  assert.ok(events.some((e) => e.channel === 'dashboards' && e.dashboards.length === 1), 'the window is told');
  assert.equal(service.snapshot().dashboards.length, 1);

  const asked = [];
  electron.dialog.showMessageBox = async (options) => {
    asked.push(options);
    return { response: 0 };
  };
  assert.equal(await service.dashboardDelete(dashboard.id), false, 'cancelled');
  assert.equal(repo.state.dashboards.length, 1);
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  assert.equal(await service.dashboardDelete(dashboard.id), true);
  assert.equal(repo.state.dashboards.length, 0);
  assert.match(asked[0].message, /Delete the dashboard "Leads"\?/);
  assert.equal(await service.dashboardDelete(dashboard.id), false, 'already gone');
});

test('a bad call goes back to the model to fix, and nothing is saved', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await service.chatCreate('p1', 'm1', null, 'research-analyst', { skillIds: [], roleIds: [] }, null, 'You are the Research Analyst.');
  let answer;
  mockModel(t, async (n, req, onChunk) => {
    if (n === 1) return { toolCalls: [{ id: 'call1', name: 'show_dashboard', arguments: JSON.stringify({ title: 'T', widgets: [] }) }] };
    answer = req.messages.at(-1);
    onChunk('Sorry.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'dashboard please', []);
  await waitFor(() => answer, 'the second call');
  assert.match(String(answer.content), /Not shown: widgets is empty/);
  assert.equal(repo.state.dashboards.length, 0);
});

test('saved data from before dashboards loads with none', () => {
  const dir = temp();
  try {
    fs.writeFileSync(
      path.join(dir, 'db', 'platform-v1.json'),
      JSON.stringify({ version: 1, settings: {}, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [] })
    );
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.deepEqual(repo.state.dashboards, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
