// Task boards, team lists, statuses and colleague cards: the office's view of the task records.
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
const t = require('../src/renderer/src/features/office/tasks.ts');
const boards = require('../src/renderer/src/features/office/campus/boards.ts');
const layout = require('../src/renderer/src/features/office/simulation/layout.ts');

const task = (over) => ({ kind: 'work', title: over.id, status: 'done', createdAt: 0, updatedAt: 0, ...over });

test('teams: the core team by room, specialists by department', () => {
  assert.equal(t.teamOf('writer'), 'Library');
  assert.equal(t.teamOf('research-analyst'), 'Library');
  assert.equal(t.teamOf('ops-coordinator'), 'Planning');
  assert.equal(t.teamOf('files-agent'), 'Files room');
  assert.equal(t.teamOf('marketing-strategist'), 'Lounge');
  assert.equal(t.teamOf('backend-developer'), 'Backend & APIs');
  assert.equal(t.teamOf('receptionist'), null);
  // The receptionist's board is the day's plan, behind her desk.
  const today = boards.TASK_BOARDS.find((b) => b.kind === 'today');
  assert.deepEqual([today.team, today.itemId], ['Today', 'board-today']);
  assert.ok(layout.FURNITURE.some((item) => item.id === 'board-today'));
  assert.equal(t.teamOf('nobody'), null);
});

test('board cards: attention first, then newest, four at most, help included', () => {
  const tasks = [
    task({ id: 'a', coworkerId: 'backend-developer', updatedAt: 5 }),
    task({ id: 'b', coworkerId: 'backend-developer', updatedAt: 9, status: 'working' }),
    task({ id: 'c', coworkerId: 'backend-developer', updatedAt: 1, status: 'attention' }),
    task({ id: 'd', coworkerId: 'api-developer', updatedAt: 7 }),
    task({ id: 'e', kind: 'help', coworkerId: 'backend-developer', forCoworkerId: 'frontend-developer', updatedAt: 8, status: 'working' }),
    task({ id: 'f', coworkerId: 'frontend-developer', updatedAt: 99 }),
    task({ id: 'g', kind: 'todo', status: 'open', updatedAt: 100 })
  ];
  assert.deepEqual(
    t.boardCards(tasks, 'Backend & APIs').map((x) => x.id),
    ['c', 'b', 'e', 'd']
  );
  const list = t.teamList(tasks, 'Backend & APIs');
  assert.deepEqual(
    list.attention.map((x) => x.id),
    ['c']
  );
  assert.deepEqual(
    list.working.map((x) => x.id),
    ['b', 'e']
  );
  assert.deepEqual(
    list.done.map((x) => x.id),
    ['d', 'a']
  );
});

test('statuses come from each coworker’s newest work record', () => {
  const statuses = t.statusesFromTasks([
    task({ id: '1', coworkerId: 'writer', status: 'done', updatedAt: 1 }),
    task({ id: '2', coworkerId: 'writer', status: 'working', updatedAt: 2 }),
    task({ id: '3', coworkerId: 'designer', status: 'attention', note: 'Waiting for your approval', updatedAt: 1 }),
    task({ id: '4', coworkerId: 'research-analyst', status: 'attention', note: 'Rate limited', updatedAt: 1 }),
    task({ id: '5', coworkerId: 'product-coach', status: 'done', updatedAt: 1 }),
    task({ id: '6', kind: 'help', coworkerId: 'files-agent', status: 'working', updatedAt: 9 })
  ]);
  assert.deepEqual(statuses, {
    writer: 'working',
    designer: 'waiting',
    'research-analyst': 'error',
    'product-coach': 'completed'
  });
});

test('help walks last while the help runs or the asker’s run continues', () => {
  const work = task({ id: 'w', coworkerId: 'frontend-developer', conversationId: 'c', status: 'working', runStartedAt: 10 });
  const help = task({
    id: 'h',
    kind: 'help',
    coworkerId: 'backend-developer',
    forCoworkerId: 'frontend-developer',
    conversationId: 'c',
    status: 'done',
    createdAt: 12
  });
  assert.deepEqual(t.activeHelp([work, help]), [{ helper: 'backend-developer', host: 'frontend-developer' }]);
  assert.deepEqual(t.activeHelp([{ ...work, status: 'done' }, help]), []);
  assert.deepEqual(t.activeHelp([{ ...work, runStartedAt: 20 }, help]), [], 'help from an earlier run');
  assert.equal(t.activeHelp([{ ...work, status: 'done' }, { ...help, status: 'working' }]).length, 1);
  // Two answers from the same colleague make one walk.
  assert.equal(t.activeHelp([work, help, { ...help, id: 'h2' }]).length, 1);
});

test('colleague calls parse for the card', () => {
  const pending = t.parseColleagueCall({
    id: '1',
    name: 'ask_colleague',
    arguments: '{"colleague":"Backend Developer","question":"Which code?"}'
  });
  assert.deepEqual([pending.colleague, pending.question, pending.pending], ['Backend Developer', 'Which code?', true]);
  const done = t.parseColleagueCall({
    id: '1',
    name: 'ask_colleague',
    arguments: '{"colleague":"backend","question":"Q"}',
    result: '{"colleague":"backend-developer","name":"Backend Developer","answer":"409"}'
  });
  assert.deepEqual([done.colleague, done.name, done.answer, done.pending], ['backend-developer', 'Backend Developer', '409', false]);
  const failed = t.parseColleagueCall({ id: '1', name: 'ask_colleague', arguments: '{', error: 'No single colleague' });
  assert.deepEqual([failed.error, failed.pending, failed.question], ['No single colleague', false, '']);
});

const districts = require('../src/renderer/src/features/office/campus/districts.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

test('a board for every department and every core team room, and one for everyone', () => {
  const teams = boards.TASK_BOARDS.map((b) => b.team).sort();
  const departments = districts.DISTRICTS.flatMap((d) => d.departments);
  assert.deepEqual(teams, [...departments, 'Files room', 'Library', 'Lounge', 'Planning', 'Today'].sort());
  for (const b of boards.TASK_BOARDS) {
    const item = layout.FURNITURE.find((f) => f.id === b.itemId);
    assert.ok(item, b.itemId);
    assert.equal(item.rotation, 0, `${b.itemId} faces the viewer`);
    assert.match(b.color, /^#[0-9a-f]{6}$/i);
  }
  for (const a of agents.OFFICE_AGENTS.filter((x) => x.id !== 'receptionist'))
    assert.ok(
      boards.TASK_BOARDS.some((b) => b.team === t.teamOf(a.id)),
      `${a.id} has a board`
    );
  const backend = layout.FURNITURE.find((f) => f.id === boards.TASK_BOARDS.find((b) => b.team === 'Backend & APIs').itemId);
  assert.equal(backend.w, 2.4);
});

test('the Today board lists the next dated to-dos, overdue first', () => {
  const now = new Date(2026, 8, 24, 14, 5); // Thursday
  const todo = (id, due, over) => ({ id, kind: 'todo', title: id, status: 'open', due, createdAt: 0, updatedAt: 0, ...over });
  const lines = t.todayLines(
    [
      todo('Deck', '2026-09-24T10:00'),
      todo('Bank', '2026-09-21'),
      todo('Groceries', '2026-09-24'),
      todo('Dentist', '2026-09-25T08:30'),
      todo('Review', '2026-09-28'),
      todo('Taxes', '2026-10-15'),
      todo('Done', '2026-09-24', { status: 'done' }),
      todo('Someday', undefined)
    ],
    now
  );
  assert.deepEqual(lines, [
    { label: 'Overdue', title: 'Bank', overdue: true },
    { label: '10:00', title: 'Deck', overdue: false },
    { label: 'Today', title: 'Groceries', overdue: false },
    { label: 'Tomorrow', title: 'Dentist', overdue: false },
    { label: 'Mon', title: 'Review', overdue: false }
  ]);
  assert.equal(t.todayLines([todo('Taxes', '2026-10-15')], now)[0].label, '15 Oct');
  assert.deepEqual(t.todayLines([], now), []);
});

test('planner tool cards read what the receptionist did', () => {
  const now = new Date(2026, 8, 24, 14, 5);
  const call = (name, args, outcome = {}) => ({ id: 'c', name, arguments: JSON.stringify(args), ...outcome });
  assert.deepEqual(
    t.parsePlannerCall(
      call('add_task', { title: 'Prep the investor deck', due: '2026-09-25T10:00', remind_at: '2026-09-25T09:30' }, { result: 'Added "Prep the investor deck" (id x).' }),
      now
    ),
    { verb: 'Added', title: 'Prep the investor deck', detail: 'due Tomorrow 10:00 · reminder Tomorrow 09:30', pending: false }
  );
  assert.deepEqual(t.parsePlannerCall(call('update_task', { id: 'x', remind_at: '' }, { result: 'Updated "Prep the deck".' }), now), {
    verb: 'Updated',
    title: 'Prep the deck',
    detail: 'no reminder',
    pending: false
  });
  assert.equal(t.parsePlannerCall(call('complete_task', { id: 'x' }, { result: 'Done: "Call the bank".' }), now).title, 'Call the bank');
  assert.equal(t.parsePlannerCall(call('list_tasks', {}), now).verb, 'Checking the plan…');
  const failed = t.parsePlannerCall(call('add_task', { title: 'x', remind_at: '2026-09-24T09:00' }, { error: 'That time has passed; ask the user.' }), now);
  assert.equal(failed.error, 'That time has passed; ask the user.');
  assert.equal(failed.verb, 'Couldn’t add');
  assert.equal(t.isPlannerCall(call('ask_colleague', {})), false);
  assert.equal(t.isPlannerCall(call('add_task', {})), true);
});
