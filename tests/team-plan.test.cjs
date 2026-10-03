// Team plans: the checks a lead's plan must pass, and the order the work runs in. Pure logic.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plan = require('../src/main/team/plan.ts');

test('a team open when Axon closed loads stopped, with its running tasks stopped', () => {
  const teams = [
    { id: 'a', status: 'working', minutes: [], plan: { summary: '', assignments: [
      { id: 't1', status: 'working' }, { id: 't2', status: 'waiting' }, { id: 't3', status: 'done' }] } },
    { id: 'b', status: 'meeting', minutes: [] },
    { id: 'c', status: 'planned', minutes: [] },
    { id: 'd', status: 'done', minutes: [] }
  ];
  assert.equal(plan.interruptTeams(teams, 5), true);
  assert.deepEqual(teams.map((t) => t.status), ['stopped', 'stopped', 'planned', 'done']);
  assert.deepEqual(teams[0].plan.assignments.map((a) => a.status), ['stopped', 'waiting', 'done']);
  assert.match(teams[0].note, /closed/);
  assert.equal(plan.interruptTeams(teams, 6), false, 'nothing left to stop');
});

const people = [
  { id: 'backend-developer', name: 'Backend Developer' },
  { id: 'frontend-developer', name: 'Frontend Developer' },
  { id: 'qa-engineer', name: 'QA Engineer' }
];
const task = (id, owner, extra = {}) => ({ id, owner, title: `Task ${id}`, brief: `Do ${id}`, depends_on: [], files: [], ...extra });

test('a sound plan comes back with owners as ids, paths normalised, every task waiting', () => {
  const result = plan.validatePlan({ summary: 'Build it', assignments: [
    task('t1', 'Backend Developer', { files: ['.\\src\\api.ts'] }),
    task('t2', 'frontend-developer', { depends_on: ['t1'], files: ['src/ui.tsx'] })
  ] }, people);
  assert.equal(result.ok, true, result.errors?.join());
  assert.equal(result.plan.summary, 'Build it');
  assert.deepEqual(result.plan.assignments.map((a) => [a.id, a.ownerId, a.dependsOn, a.files, a.status]), [
    ['t1', 'backend-developer', [], ['src/api.ts'], 'waiting'],
    ['t2', 'frontend-developer', ['t1'], ['src/ui.tsx'], 'waiting']
  ]);
});

test('owners must be in the meeting; ids unique; dependencies real and acyclic', () => {
  const errors = (assignments) => plan.validatePlan({ summary: '', assignments }, people).errors.join('\n');
  assert.match(errors([task('t1', 'Designer')]), /not in this meeting/);
  assert.match(errors([task('t1', 'QA Engineer'), task('t1', 'QA Engineer')]), /twice/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t9'] })]), /t9/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t1'] })]), /itself/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t2'] }), task('t2', 'QA Engineer', { depends_on: ['t1'] })]), /loop/);
  assert.match(errors([]), /at least one/);
  assert.match(errors(Array.from({ length: 21 }, (_, i) => task(`t${i}`, 'QA Engineer'))), /20/);
  assert.match(errors([{ id: 't1', owner: 'QA Engineer', title: '', brief: '' }]), /title/);
});

test('two tasks that may run together never own the same file; in order they may', () => {
  const clash = plan.validatePlan({ summary: '', assignments: [
    task('t1', 'Backend Developer', { files: ['src/a.ts'] }),
    task('t2', 'Frontend Developer', { files: ['src/a.ts'] })
  ] }, people);
  assert.equal(clash.ok, false);
  assert.match(clash.errors.join(), /src\/a\.ts/);
  const ordered = plan.validatePlan({ summary: '', assignments: [
    task('t1', 'Backend Developer', { files: ['src/a.ts'] }),
    task('t2', 'Frontend Developer', { depends_on: ['t1'], files: ['src/a.ts'] }),
    task('t3', 'QA Engineer', { depends_on: ['t2'], files: ['src/a.ts'] })
  ] }, people);
  assert.equal(ordered.ok, true, ordered.errors?.join());
});

const states = (...pairs) => pairs.map(([id, status, dependsOn = []]) => ({ id, status, dependsOn }));

test('ready tasks are waiting with every dependency done', () => {
  const list = states(['t1', 'done'], ['t2', 'waiting', ['t1']], ['t3', 'waiting', ['t2']], ['t4', 'waiting']);
  assert.deepEqual(plan.readyAssignments(list).map((a) => a.id), ['t2', 't4']);
});

test('a failed task blocks only what depends on it, directly or not', () => {
  const list = states(['t1', 'failed'], ['t2', 'waiting', ['t1']], ['t3', 'waiting', ['t2']], ['t4', 'waiting']);
  assert.equal(plan.blockDependants(list), true);
  assert.deepEqual(list.map((a) => a.status), ['failed', 'blocked', 'blocked', 'waiting']);
  assert.equal(plan.blockDependants(list), false);
});

test('progress: done when all done, working while anything runs or can start, otherwise stuck', () => {
  assert.equal(plan.progress(states(['t1', 'done'], ['t2', 'done'])), 'done');
  assert.equal(plan.progress(states(['t1', 'working'], ['t2', 'failed'])), 'working');
  assert.equal(plan.progress(states(['t1', 'done'], ['t2', 'waiting', ['t1']])), 'working');
  assert.equal(plan.progress(states(['t1', 'failed'], ['t2', 'blocked', ['t1']])), 'stuck');
});

test('retry puts failed, stopped and blocked tasks back to waiting', () => {
  const list = states(['t1', 'failed'], ['t2', 'blocked'], ['t3', 'stopped'], ['t4', 'done']);
  list[0].note = 'boom';
  assert.equal(plan.resetForRetry(list), 3);
  assert.deepEqual(list.map((a) => a.status), ['waiting', 'waiting', 'waiting', 'done']);
  assert.equal(list[0].note, undefined);
});
