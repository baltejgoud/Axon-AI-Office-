// The front desk: the planner over IPC, the morning briefing, reminders, and Axon in the tray.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron')
    return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
  return original.call(this, name, ...args);
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
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');
const { dayKey, addDays } = require('../src/shared/planner.ts');

const makeService = (t, seed) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-reception-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  if (seed) fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), JSON.stringify(seed));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const events = [];
  const service = new Service(repo, vault, dir, (event) => events.push(event), 'parser-worker-path');
  t.after(() => {
    service.shutdown?.();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { repo, service, events };
};
const tomorrow = () => addDays(dayKey(new Date()), 1);

test('the planner adds, ticks, reschedules and deletes to-dos, with the same checks as her tools', async (t) => {
  const { repo, service, events } = makeService(t);
  const task = await service.taskAdd({ title: '  Prep the investor deck ', due: `${tomorrow()}T10:00` });
  assert.equal(task.title, 'Prep the investor deck');
  assert.equal(task.kind, 'todo');
  assert.equal(task.status, 'open');
  assert.ok(events.some((event) => event.channel === 'tasks' && event.tasks.length === 1));
  await assert.rejects(service.taskAdd({ title: '' }), /title/);
  await assert.rejects(service.taskAdd({ title: 'x', remindAt: Date.now() - 1000 }), /That time has passed/);
  await assert.rejects(service.taskAdd({ title: 'x', due: 'soon' }), /YYYY-MM-DD/);

  const remindAt = Date.now() + 60 * 60 * 1000;
  let updated = await service.taskUpdate(task.id, { remindAt });
  assert.equal(updated.remindAt, remindAt);
  repo.state.tasks[0].remindedAt = remindAt;
  updated = await service.taskUpdate(task.id, { remindAt: remindAt + 60000 });
  assert.equal(updated.remindedAt, undefined, 'a new time reminds again');
  updated = await service.taskUpdate(task.id, { status: 'done' });
  assert.equal(updated.status, 'done');
  assert.ok(updated.doneAt > 0);
  updated = await service.taskUpdate(task.id, { status: 'open', due: null, remindAt: null, title: 'Prep the deck' });
  assert.equal(updated.status, 'open');
  assert.equal(updated.doneAt, undefined);
  assert.equal(updated.due, undefined);
  assert.equal(updated.remindAt, undefined);
  assert.equal(updated.title, 'Prep the deck');
  await assert.rejects(service.taskUpdate(task.id, { status: 'working' }), /Invalid status/);

  // Coworkers' records are theirs.
  repo.state.tasks.push({ id: 'w', kind: 'work', title: 'API', status: 'working', createdAt: 0, updatedAt: 0 });
  await assert.rejects(service.taskDelete('w'), /Only your own to-dos/);
  await assert.rejects(service.taskUpdate('w', { title: 'x' }), /Only your own to-dos/);
  await assert.rejects(service.taskDelete('nope'), /Task not found/);
  await service.taskDelete(task.id);
  assert.deepEqual(repo.state.tasks.map((item) => item.id), ['w']);
});

test('the morning briefing comes once a day, and only with something to say', async (t) => {
  const { repo, service } = makeService(t);
  // A new office has nothing to brief; the day is still marked.
  let start = await service.officeStart();
  assert.equal(start.briefing, null);
  assert.equal(repo.state.reception.briefedOn, dayKey(new Date()));

  repo.state.reception.briefedOn = addDays(dayKey(new Date()), -1);
  await service.taskAdd({ title: 'Call the bank', due: dayKey(new Date()) });
  start = await service.officeStart();
  assert.ok(start.briefing);
  assert.match(start.briefing.greeting, /^Good (morning|afternoon|evening)$/);
  assert.deepEqual([...start.briefing.today, ...start.briefing.overdue], ['Call the bank']);
  assert.equal((await service.officeStart()).briefing, null, 'only once a day');

  // Where a notification wanted the window to open, handed over once.
  service.setPendingFocus({ agentId: 'receptionist', planner: true });
  assert.deepEqual((await service.officeStart()).focus, { agentId: 'receptionist', planner: true });
  assert.equal((await service.officeStart()).focus, null);
});

test('an older saved state gains the tray settings and the front desk', (t) => {
  const { repo, service } = makeService(t, {
    version: 1,
    providers: [],
    conversations: [],
    messages: [],
    workspaces: [],
    agents: [],
    documents: [],
    chunks: [],
    settings: {
      theme: 'light',
      autoTitleConversations: true,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      streamDeltas: true,
      allowShellExecution: false,
      shellAllowlist: [],
      sendCrashDiagnostics: false,
      dataDirectoryNote: ''
    },
    tasks: []
  });
  assert.equal(repo.state.settings.keepInTray, true);
  assert.equal(repo.state.settings.startWithWindows, false);
  assert.deepEqual(repo.state.reception, {});
  const snapshot = service.snapshot();
  assert.deepEqual(snapshot.pendingApprovals, []);
  assert.equal(snapshot.startWithWindowsAvailable, false);
});

test('settings keep the tray switches', async (t) => {
  const { repo, service } = makeService(t);
  await service.settingsSave({ ...repo.state.settings, keepInTray: false, startWithWindows: true });
  assert.equal(repo.state.settings.keepInTray, false);
  assert.equal(repo.state.settings.startWithWindows, true);
});
