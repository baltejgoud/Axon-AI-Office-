const ts = require('typescript'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  Module = require('node:module');
const original = Module._load;
const electron = {
  app: { isPackaged: false },
  dialog: {},
  utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) }
};
Module._load = function (name, ...args) {
  return name === 'electron' ? electron : original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts'),
  { Service } = require('../src/main/service.ts');
const providers = require('../src/main/providers.ts');
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-runtime-service-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  fs.mkdirSync(path.join(dir, 'project'));
  fs.writeFileSync(path.join(dir, 'project', 'a.txt'), 'original');
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const events = [];
  const service = new Service(
    repo,
    { has: () => false, get: () => null, set() {}, remove() {} },
    dir,
    (e) => events.push(e),
    'worker'
  );
  repo.state.providers.push({
    id: 'p',
    name: 'mock',
    enabled: true,
    models: [{ id: 'm', displayName: 'mock' }],
    kind: 'openai-compatible',
    baseUrl: 'https://example.com',
    createdAt: 0,
    hasApiKey: false
  });
  await service.project.choose(path.join(dir, 'project'));
  const chat = await service.chatCreate(
    'p',
    'm',
    null,
    'backend-developer',
    { skillIds: [], roleIds: [] },
    service.project.root
  );
  const previous = providers.streamChat;
  t.after(async () => {
    providers.streamChat = previous;
    service.stopAll();
    service.shutdown();
    await repo.store.flushAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { service, repo, events, chat, dir };
}
async function until(fn) {
  for (let n = 0; n < 100; n++) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Timed out waiting for runtime state');
}
test('canceling a run withdraws approvals and clears its active runtime status', async (t) => {
  const { service, events, chat } = await setup(t);
  providers.streamChat = async () => ({
    toolCalls: [
      { id: 'write', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'new' }) }
    ]
  });
  const work = service.chatSend(chat.id, 'Update file', []);
  await until(() => events.some((e) => e.approvalRequired));
  assert.equal(service.supervisor.active(chat.id)[0].status, 'waiting_for_approval');
  service.chatStop(chat.id);
  await work;
  assert.equal(service.permissions.pending().length, 0);
  assert.equal(service.supervisor.active(chat.id).length, 0);
  assert.equal(service.supervisor.latest(chat.id).status, 'canceled');
});
test('conversation close defaults to stopping descendants; background choice preserves history', async (t) => {
  const { service, chat, repo } = await setup(t);
  let options;
  const parent = service.supervisor.start({ conversationId: chat.id, agentId: 'backend-developer' });
  const controller = new AbortController();
  const child = service.supervisor.start(
    { conversationId: 'child', agentId: 'qa-engineer', parentRunId: parent.runId },
    controller
  );
  electron.dialog.showMessageBox = async (input) => {
    options = input;
    return { response: 0 };
  };
  assert.equal(await service.conversationClose(chat.id), true);
  assert.equal(options.defaultId, 0);
  assert.equal(controller.signal.aborted, true);
  assert.equal(child.status, 'canceled');
  service.supervisor.start({ conversationId: chat.id, agentId: 'backend-developer' });
  electron.dialog.showMessageBox = async () => ({ response: 1 });
  await service.chatDelete(chat.id);
  assert.ok(repo.state.conversations.some((c) => c.id === chat.id));
  assert.equal(service.supervisor.active(chat.id).length, 1);
});
test('project close cancels project runs and respects Cancel', async (t) => {
  const { service, chat } = await setup(t);
  const root = service.project.root;
  const run = service.supervisor.start({
    conversationId: chat.id,
    agentId: 'backend-developer',
    projectId: root
  });
  electron.dialog.showMessageBox = async () => ({ response: 2 });
  assert.equal(await service.projectClose(), false);
  assert.equal(service.project.root, root);
  electron.dialog.showMessageBox = async () => ({ response: 0 });
  assert.equal(await service.projectClose(), true);
  assert.equal(run.status, 'canceled');
  assert.equal(service.project.root, null);
});
test('same coworker tasks serialize across conversations and canceled queued work never calls provider', async (t) => {
  const { service, chat } = await setup(t);
  const other = await service.chatCreate(
    'p',
    'm',
    null,
    'backend-developer',
    { skillIds: [], roleIds: [] },
    service.project.root
  );
  let calls = 0;
  providers.streamChat = async (_p, _k, request) => {
    calls++;
    return new Promise((resolve, reject) =>
      request.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
    );
  };
  const first = service.chatSend(chat.id, 'first', []);
  await until(() => calls === 1);
  const second = service.chatSend(other.id, 'second', []).catch((e) => e);
  await until(() => service.supervisor.latest(other.id)?.status === 'queued');
  service.chatStop(other.id);
  await second;
  assert.equal(calls, 1);
  service.chatStop(chat.id);
  await first;
});
test('a project switch cannot redirect an already approved run to a different folder', async (t) => {
  const { service, chat, events, dir } = await setup(t);
  let step = 0;
  providers.streamChat = async () =>
    ++step === 1
      ? {
          toolCalls: [
            { id: 'w', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'changed' }) }
          ]
        }
      : { toolCalls: [] };
  const work = service.chatSend(chat.id, 'Update file', []);
  const approval = await until(() => events.find((e) => e.approvalRequired)?.approvalRequired);
  fs.mkdirSync(path.join(dir, 'other'));
  fs.writeFileSync(path.join(dir, 'other', 'a.txt'), 'keep');
  await service.project.choose(path.join(dir, 'other'));
  await service.toolApprove({ requestId: approval.id, approved: true });
  await work;
  assert.equal(fs.readFileSync(path.join(dir, 'project', 'a.txt'), 'utf8'), 'changed');
  assert.equal(fs.readFileSync(path.join(dir, 'other', 'a.txt'), 'utf8'), 'keep');
});
test('credit auto-fit is opt-in, bounded to one retry, and never replays streamed output', async (t) => {
  const { service, repo, chat } = await setup(t);
  repo.state.settings.autoFitCredits = true;
  const limits = [];
  providers.streamChat = async (_p, _k, req, delta) => {
    limits.push(req.maxTokens);
    if (limits.length === 1) throw new providers.ProviderError(402, 'You can only afford 1,024 tokens');
    delta('Short answer');
    return { toolCalls: [] };
  };
  await service.chatSend(chat.id, 'Answer', []);
  assert.deepEqual(limits, [repo.state.settings.defaultMaxTokens, 1024]);
  assert.equal(service.supervisor.latest(chat.id).status, 'completed');
});
