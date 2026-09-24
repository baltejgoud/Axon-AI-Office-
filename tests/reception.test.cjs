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
  t.after(async () => {
    service.shutdown();
    // Let saves started in passing (reminders, the tray hint) land before the folder goes.
    for (let i = 0; i < 20 && (i === 0 || repo.store.pending.size); i++) {
      await repo.store.flushAll();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
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

const { Reminders, dueReminders, TICK_MS } = require('../src/main/reminders.ts');
const { TaskStore } = require('../src/main/tasks/store.ts');
const lifecycle = require('../src/main/shell/lifecycle.ts');

/** A task store and reminders on a hand-turned clock, with timers we can see. */
const reminderRig = (tasks) => {
  const clock = { now: new Date(2026, 8, 24, 9, 0).getTime() };
  const state = { tasks };
  const store = new TaskStore(state, () => 'id', () => reminders?.changed(), () => clock.now);
  const notices = [];
  const timers = [];
  const saves = { count: 0 };
  const reminders = new Reminders(store, (notice) => notices.push(notice), {
    now: () => clock.now,
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
    persist: () => saves.count++
  });
  return { clock, state, store, notices, timers, reminders, saves };
};
const todo = (id, over) => ({ id, kind: 'todo', title: id, status: 'open', createdAt: 0, updatedAt: 0, ...over });
const minutes = (n) => n * 60 * 1000;

test('due reminders: open to-dos whose time has come, once each', () => {
  const now = 1000;
  const due = dueReminders(
    [
      todo('later', { remindAt: 2000 }),
      todo('due', { remindAt: 900 }),
      todo('earlier', { remindAt: 500 }),
      todo('fired', { remindAt: 500, remindedAt: 600 }),
      todo('done', { remindAt: 500, status: 'done' }),
      { ...todo('work', { remindAt: 500 }), kind: 'work' },
      todo('none')
    ],
    now
  );
  assert.deepEqual(due.map((task) => task.id), ['earlier', 'due']);
});

test('missed reminders arrive at start-up: one each for a few, one summary for many', () => {
  const few = reminderRig([]);
  few.state.tasks.push(
    todo('Call the bank', { remindAt: few.clock.now - minutes(60), due: '2026-09-24' }),
    todo('Pay rent', { remindAt: few.clock.now - minutes(5) })
  );
  few.reminders.startup();
  assert.deepEqual(few.notices.map((n) => n.body), ['Call the bank — Today', 'Pay rent']);
  assert.ok(few.notices.every((n) => n.title === 'Reminder' && n.target.agentId === 'receptionist' && n.target.planner));
  assert.ok(few.state.tasks.every((task) => task.remindedAt === few.clock.now));
  assert.equal(few.saves.count, 1, 'saved, so a restart does not repeat them');

  const many = reminderRig([]);
  for (const id of ['a', 'b', 'c', 'd']) many.state.tasks.push(todo(id, { remindAt: many.clock.now - minutes(10) }));
  many.reminders.startup();
  assert.deepEqual(many.notices.map((n) => n.body), ['4 reminders you missed']);
  assert.ok(many.state.tasks.every((task) => task.remindedAt));
});

test('a reminder fires once, on time, with a timer when it is due before the next tick', () => {
  const rig = reminderRig([]);
  rig.reminders.tick();
  assert.equal(rig.notices.length, 0, 'nothing fires before start-up');
  rig.reminders.startup();
  rig.store.add(todo('Stand-up', { remindAt: rig.clock.now + 10_000 }));
  const armed = rig.timers.filter((timer) => !timer.cancelled);
  assert.equal(armed.length, 1);
  assert.equal(armed[0].ms, 10_000);
  rig.clock.now += 10_000;
  armed[0].fn();
  assert.deepEqual(rig.notices.map((n) => n.body), ['Stand-up']);
  rig.reminders.tick();
  rig.clock.now += TICK_MS;
  rig.reminders.tick();
  assert.equal(rig.notices.length, 1, 'fires once');

  // Five minutes away: the regular tick will get there, so no timer of its own.
  const timersBefore = rig.timers.length;
  rig.store.add(todo('Lunch', { remindAt: rig.clock.now + minutes(5) }));
  assert.equal(rig.timers.length, timersBefore);
  rig.clock.now += minutes(5);
  rig.reminders.tick();
  assert.deepEqual(rig.notices.map((n) => n.body), ['Stand-up', 'Lunch']);
  rig.reminders.stop();
});

test('the service hands reminders and waiting approvals to the shell', async (t) => {
  const { service } = makeService(t);
  const notices = [];
  const applied = [];
  let visible = true;
  service.attachShell({ notify: (notice) => notices.push(notice), windowVisible: () => visible, applySettings: (settings) => applied.push(settings.startWithWindows) });
  assert.deepEqual(applied, [false], 'applies the sign-in setting at start-up');
  await service.settingsSave({ ...service.settings, startWithWindows: true });
  assert.deepEqual(applied, [false, true]);
  const task = await service.taskAdd({ title: 'Soon', remindAt: Date.now() + 60_000 });
  service.repo.state.tasks.find((item) => item.id === task.id).remindAt = Date.now() - 1;
  service.reminders.tick();
  assert.deepEqual(notices.map((n) => [n.title, n.body]), [['Reminder', 'Soon']]);
  assert.ok(service.repo.state.tasks[0].remindedAt);
  visible = false;
  assert.equal(service.firstTrayClose(), true);
  assert.equal(service.firstTrayClose(), false, 'the tray is explained once');
});

test('window and tray rules', () => {
  assert.equal(lifecycle.afterLastWindow({ keepInTray: true, platform: 'win32' }), 'tray');
  assert.equal(lifecycle.afterLastWindow({ keepInTray: false, platform: 'win32' }), 'quit');
  assert.equal(lifecycle.afterLastWindow({ keepInTray: false, platform: 'darwin' }), 'tray');
  assert.equal(lifecycle.startedInBackground(['axon.exe', '--background']), true);
  assert.equal(lifecycle.startedInBackground(['axon.exe']), false);
  assert.deepEqual(lifecycle.loginItem({ startWithWindows: true }, true, 'win32'), { openAtLogin: true, args: ['--background'] });
  assert.deepEqual(lifecycle.loginItem({ startWithWindows: false }, true, 'win32'), { openAtLogin: false, args: [] });
  assert.equal(lifecycle.loginItem({ startWithWindows: true }, false, 'win32'), null, 'not from a dev build');
  assert.equal(lifecycle.loginItem({ startWithWindows: true }, true, 'linux'), null);
  assert.equal(lifecycle.appUserModelId(true, 'C:/electron.exe'), 'com.axon.studio');
  assert.equal(lifecycle.appUserModelId(false, 'C:/electron.exe'), 'C:/electron.exe');
});

test('a coworker waiting for approval while the window is closed sends a notice that leads to them', async (t) => {
  const { repo, service, events } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-approval-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  repo.state.providers.push({ id: 'p1', name: 'Mock', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }], enabled: true, createdAt: 0, hasApiKey: false });
  const notices = [];
  service.attachShell({ notify: (notice) => notices.push(notice), windowVisible: () => false, applySettings() {} });
  const chat = await service.chatCreate('p1', 'm1', null, 'backend-developer', { skillIds: [], roleIds: [] }, folder, "You are Axon's Backend Developer.");
  const providers = require('../src/main/providers.ts');
  const originalStream = providers.streamChat;
  t.after(() => {
    providers.streamChat = originalStream;
  });
  let calls = 0;
  providers.streamChat = async () =>
    ++calls === 1
      ? { toolCalls: [{ id: 'w', name: 'write_file', arguments: JSON.stringify({ path: path.join(folder, 'a.txt'), content: 'x' }) }] }
      : { toolCalls: [] };
  const run = service.chatSend(chat.id, 'Write the file', []);
  let request;
  for (let i = 0; i < 100 && !request; i++) {
    request = events.find((event) => event.channel === 'chat' && event.approvalRequired)?.approvalRequired;
    if (!request) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(request, 'approval requested');
  assert.deepEqual(service.snapshot().pendingApprovals.map((r) => r.id), [request.id]);
  assert.deepEqual(notices, [
    { title: 'Backend Developer needs your approval', body: 'To use write file.', target: { agentId: 'backend-developer', conversationId: chat.id } }
  ]);
  await service.toolApprove({ requestId: request.id, approved: false });
  await run;
  assert.deepEqual(service.snapshot().pendingApprovals, []);
});
