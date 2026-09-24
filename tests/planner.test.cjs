// The planner's calendar sense and the receptionist's tools, with a fixed local clock.
const ts = require('typescript');
const fs = require('node:fs');
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
const p = require('../src/shared/planner.ts');
const tools = require('../src/main/tasks/tools.ts');
const { TaskStore } = require('../src/main/tasks/store.ts');

const at = (s) => new Date(s); // local time
const now = at('2026-09-24T14:05:00'); // a Thursday
const todo = (over) => ({ id: over.id, kind: 'todo', title: over.id, status: 'open', createdAt: 0, updatedAt: 0, ...over });

test('local dates parse strictly', () => {
  assert.equal(p.parseLocal('2026-09-25T10:00').at, at('2026-09-25T10:00:00').getTime());
  assert.equal(p.parseLocal('2026-09-25T10:00').time, '10:00');
  assert.equal(p.parseLocal('2026-09-25').at, at('2026-09-25T09:00:00').getTime());
  assert.equal(p.parseLocal('2026-09-25').time, undefined);
  assert.equal(p.parseLocal('2026-02-30'), null);
  assert.equal(p.parseLocal('2026-13-01'), null);
  assert.equal(p.parseLocal('2026-09-25T24:00'), null);
  assert.equal(p.parseLocal('next friday'), null);
  assert.equal(p.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(p.dayKey(now), '2026-09-24');
});

test('the planner groups by day', () => {
  const g = p.groupPlanner(
    [
      todo({ id: 'late', due: '2026-09-22' }),
      todo({ id: 'today-10', due: '2026-09-24T10:00' }),
      todo({ id: 'today', due: '2026-09-24' }),
      todo({ id: 'fri', due: '2026-09-25T10:00' }),
      todo({ id: 'next-week', due: '2026-10-01' }),
      todo({ id: 'later', due: '2026-10-02' }),
      todo({ id: 'someday' }),
      { id: 'w', kind: 'work', title: 'API', status: 'working', coworkerId: 'backend-developer', createdAt: 0, updatedAt: 5 },
      {
        id: 'w-done',
        kind: 'work',
        title: 'Old',
        status: 'done',
        coworkerId: 'backend-developer',
        createdAt: 0,
        updatedAt: at('2026-09-24T08:00:00').getTime()
      },
      { id: 'h', kind: 'help', title: 'Helping', status: 'working', createdAt: 0, updatedAt: 5 },
      todo({ id: 'done', status: 'done', doneAt: at('2026-09-23T09:00:00').getTime() }),
      todo({ id: 'old', status: 'done', doneAt: at('2026-09-01T09:00:00').getTime() })
    ],
    now
  );
  assert.deepEqual(g.today.map((t) => t.id), ['late', 'today-10', 'today', 'w']);
  assert.deepEqual(g.week.map((t) => t.id), ['fri', 'next-week']);
  assert.deepEqual(g.later.map((t) => t.id), ['later', 'someday']);
  assert.deepEqual(g.done.map((t) => t.id), ['w-done', 'done']);
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-24T10:00' }), now), 'Today 10:00');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-25' }), now), 'Tomorrow');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-22' }), now), 'Overdue · Tue 22 Sep');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-22', status: 'done' }), now), 'Tue 22 Sep');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2027-01-01' }), now), 'Fri 1 Jan 2027');
});

test('the briefing and the Today board read the same list', () => {
  const tasks = [
    todo({ id: 'Prep the investor deck', due: '2026-09-24T10:00' }),
    todo({ id: 'Call the bank', due: '2026-09-21' }),
    todo({ id: 'Undated' }),
    { id: 'w', kind: 'work', title: 'API', status: 'working', coworkerId: 'backend-developer', createdAt: 0, updatedAt: 5 },
    { id: 'a', kind: 'work', title: 'Tests', status: 'attention', coworkerId: 'qa-engineer', createdAt: 0, updatedAt: 5 }
  ];
  const b = p.briefing(tasks, at('2026-09-24T08:30:00'));
  assert.equal(b.greeting, 'Good morning');
  assert.deepEqual(b.today, ['10:00 — Prep the investor deck']);
  assert.deepEqual(b.overdue, ['Call the bank (due Mon 21 Sep)']);
  assert.equal(b.coworkers, '1 coworker working, 1 needs attention');
  assert.equal(b.empty, false);
  assert.equal(p.briefing([], at('2026-09-24T19:00:00')).greeting, 'Good evening');
  assert.equal(p.briefing([], now).empty, true);
  assert.deepEqual(p.nextUp(tasks).map((t) => t.id), ['Call the bank', 'Prep the investor deck']);
  assert.match(p.plannerNow(now), /^Now: Thursday 24 September 2026, 14:05 \(UTC[+-]\d\d:\d\d\)\. Today is 2026-09-24\.$/);
});

test('planner tools add, list, update and complete; bad input is explained', () => {
  const state = { tasks: [] };
  let n = 0;
  const store = new TaskStore(state, () => `t${++n}`, () => {}, () => now.getTime());
  let r = tools.runPlannerTool(
    'add_task',
    { title: 'Prep the investor deck', due: '2026-09-25T10:00', remind_at: '2026-09-25T10:00' },
    store,
    now
  );
  assert.ok(!r.isError, r.content);
  assert.equal(r.content, 'Added "Prep the investor deck" (id t1) — due Tomorrow 10:00, reminder Tomorrow 10:00.');
  assert.equal(state.tasks[0].remindAt, at('2026-09-25T10:00:00').getTime());
  assert.equal(state.tasks[0].kind, 'todo');
  assert.equal(state.tasks[0].status, 'open');
  assert.match(tools.runPlannerTool('list_tasks', {}, store, now).content, /\[t1\] Prep the investor deck · Tomorrow 10:00/);
  assert.equal(tools.runPlannerTool('list_tasks', { range: 'done' }, store, now).content, 'Nothing on the list.');
  // A reminder that already fired fires again once it is moved.
  store.update('t1', { remindedAt: 1 });
  r = tools.runPlannerTool('update_task', { id: 't1', remind_at: '2026-09-26T08:00' }, store, now);
  assert.ok(!r.isError, r.content);
  assert.equal(state.tasks[0].remindedAt, undefined);
  r = tools.runPlannerTool('update_task', { id: 't1', due: '2026-09-26', remind_at: null }, store, now);
  assert.ok(!r.isError, r.content);
  assert.equal(state.tasks[0].due, '2026-09-26');
  assert.equal(state.tasks[0].remindAt, undefined);
  r = tools.runPlannerTool('complete_task', { id: 't1' }, store, now);
  assert.equal(r.content, 'Done: "Prep the investor deck".');
  assert.equal(state.tasks[0].status, 'done');
  assert.equal(state.tasks[0].doneAt, now.getTime());
  assert.match(
    tools.runPlannerTool('list_tasks', { range: 'all' }, store, now).content,
    /Done:\n- \[t1\] Prep the investor deck · Sat 26 Sep · done/
  );
  const refused = (name, args, pattern) => {
    const result = tools.runPlannerTool(name, args, store, now);
    assert.ok(result.isError, `${name} should fail`);
    assert.match(result.content, pattern);
  };
  refused('add_task', { title: 'x', remind_at: '2026-09-24T09:00' }, /That time has passed; ask the user\./);
  refused('add_task', { title: '' }, /title/i);
  refused('add_task', { title: 'x'.repeat(121) }, /title/i);
  refused('add_task', { title: 'x', due: 'friday' }, /YYYY-MM-DD/);
  refused('update_task', { id: 'nope' }, /No task with id nope; call list_tasks\./);
  refused('update_task', { id: 't1' }, /Nothing to change/);
  state.tasks.push({ id: 'w', kind: 'work', title: 'API', status: 'working', createdAt: 0, updatedAt: 0 });
  refused('complete_task', { id: 'w' }, /only the user's to-dos/);
  assert.equal(state.tasks.length, 2);
});

test('only the receptionist gets the planner tools, and they need no approval', () => {
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'electron') return { app: { isPackaged: false } };
    return original.call(this, name, ...args);
  };
  try {
    const { toolsFor } = require('../src/main/officeTools.ts');
    const { PermissionManager } = require('../src/main/security/permissions.ts');
    const names = (agentId) => toolsFor({ agentId, hasFolder: false, registry: [] }).map((tool) => tool.name);
    assert.deepEqual(names('receptionist'), ['ask_colleague', 'add_task', 'list_tasks', 'update_task', 'complete_task']);
    assert.deepEqual(names('writer'), ['ask_colleague']);
    const permissions = new PermissionManager([], false);
    for (const name of ['add_task', 'list_tasks', 'update_task', 'complete_task'])
      assert.equal(permissions.check({ toolName: name, args: {} }).action, 'allow');
  } finally {
    Module._load = original;
  }
});
