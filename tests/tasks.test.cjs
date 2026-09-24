// Task records: one per conversation with a coworker, following each run; help records for colleagues.
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
const { TaskStore } = require('../src/main/tasks/store.ts');
const { TaskTracker, taskTitle } = require('../src/main/tasks/tracker.ts');

const setup = () => {
  let t = 1000;
  let n = 0;
  const state = { tasks: [] };
  const events = [];
  const store = new TaskStore(
    state,
    () => `id${++n}`,
    (tasks) => events.push(tasks),
    () => t
  );
  const tracker = new TaskTracker(store, (id) => !!id && id !== 'receptionist', () => t);
  return { state, events, store, tracker, tick: (ms) => (t += ms) };
};

test('titles come from the first visible line', () => {
  assert.equal(taskTitle('Draft the API contract\nwith examples'), 'Draft the API contract');
  assert.equal(taskTitle('Summarize this\n\n<file path="a.txt">x</file>'), 'Summarize this');
  assert.equal(taskTitle('Read this\n\nFile context: a.txt'), 'Read this');
  assert.equal(taskTitle('  \n  Review the plan'), 'Review the plan');
  assert.equal(taskTitle('x'.repeat(100)).length, 80);
  assert.ok(taskTitle('x'.repeat(100)).endsWith('…'));
});

test('one work record per conversation follows the run', () => {
  const { state, events, tracker, tick } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'Design the API');
  assert.equal(state.tasks.length, 1);
  const [record] = state.tasks;
  assert.deepEqual(
    { kind: record.kind, status: record.status, title: record.title, coworkerId: record.coworkerId },
    { kind: 'work', status: 'working', title: 'Design the API', coworkerId: 'backend-developer' }
  );
  assert.equal(record.conversationId, 'c1');
  assert.equal(record.runStartedAt, 1000);
  tracker.approvalPending('c1');
  assert.equal(record.status, 'attention');
  assert.equal(record.note, 'Waiting for your approval');
  tracker.approvalResolved('c1');
  assert.equal(record.status, 'working');
  assert.equal(record.note, undefined);
  tick(5);
  tracker.runEnded('c1', {});
  assert.equal(record.status, 'done');
  assert.equal(record.doneAt, 1005);
  tick(5);
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'And add pagination');
  assert.equal(state.tasks.length, 1, 'follow-ups reuse the record');
  assert.equal(record.title, 'Design the API');
  assert.equal(record.runStartedAt, 1010);
  assert.equal(record.doneAt, undefined);
  tracker.runEnded('c1', { error: 'Rate limited' });
  assert.equal(record.status, 'attention');
  assert.equal(record.note, 'Rate limited');
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'Try again');
  tracker.runEnded('c1', { stopped: true });
  assert.equal(record.status, 'done');
  assert.equal(record.note, 'Stopped');
  assert.ok(events.length >= 8);
  assert.equal(events.at(-1)[0].note, 'Stopped');
});

test('no records for the receptionist or for chats without a coworker', () => {
  const { state, tracker } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'receptionist' }, 'Remind me Friday');
  tracker.runStarted({ id: 'c2' }, 'Hello');
  tracker.approvalPending('c1');
  tracker.runEnded('c1', {});
  assert.equal(state.tasks.length, 0);
});

test('interrupted runs need attention; help records open and close', () => {
  const { state, tracker } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'writer' }, 'Draft');
  tracker.interrupted();
  assert.equal(state.tasks[0].status, 'attention');
  assert.equal(state.tasks[0].note, 'Interrupted');
  const help = tracker.helpStarted('backend-developer', 'frontend-developer', 'c9', 'Which status code?');
  assert.equal(help.kind, 'help');
  assert.equal(help.title, 'Helping Frontend Developer');
  assert.equal(help.notes, 'Which status code?');
  assert.equal(help.forCoworkerId, 'frontend-developer');
  assert.equal(help.status, 'working');
  tracker.helpEnded(help.id);
  assert.equal(state.tasks.find((t) => t.id === help.id).status, 'done');
  const failed = tracker.helpStarted('backend-developer', 'frontend-developer', 'c9', 'Again?');
  tracker.helpEnded(failed.id, 'Provider down');
  const closed = state.tasks.find((t) => t.id === failed.id);
  assert.equal(closed.status, 'done');
  assert.equal(closed.note, 'Provider down');
});

test('the store refuses unknown ids', () => {
  const { store } = setup();
  assert.throws(() => store.update('missing', { status: 'done' }), /Task not found/);
});
