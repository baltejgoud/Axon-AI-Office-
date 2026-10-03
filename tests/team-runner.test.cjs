// The team runner: meeting, plan waiting for you, work in dependency order, report, stop and retry.
// Every model call and run is a scripted fake, so only the runner's own logic is under test.
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
const { TeamRunner } = require('../src/main/team/runner.ts');

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const plan = () => ({ plan: { summary: 's', assignments: [
  { id: 't1', ownerId: 'a', title: 'one', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
  { id: 't2', ownerId: 'b', title: 'two', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
  { id: 't3', ownerId: 'c', title: 'three', brief: 'b', dependsOn: ['t1', 't2'], files: [], status: 'waiting' },
  { id: 't4', ownerId: 'd', title: 'four', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
  { id: 't5', ownerId: 'a', title: 'five', brief: 'b', dependsOn: [], files: [], status: 'waiting' }] } });

/** A runner whose model and runs are scripted; `runs` ends each started task by id. */
function rig(overrides = {}) {
  const teams = [], log = [], runs = new Map(), stopped = [];
  let n = 0, changes = 0;
  const runner = new TeamRunner({
    teams: () => teams, id: () => `id${++n}`, now: () => 1, changed: () => { changes++; },
    contribute: async (_team, who) => `${who} says hi`,
    plan: async () => plan(),
    work: (_team, a, started) => new Promise((resolve) => { log.push(a.id); runs.set(a.id, resolve); started(`conv-${a.id}`); }),
    stopWork: (conversationId) => { stopped.push(conversationId); runs.get(conversationId.slice(5))?.({ outcome: 'stopped', answer: '', error: 'Stopped' }); },
    report: async () => 'All done.',
    ...overrides
  });
  const team = runner.create({ leadId: 'chief-of-staff', conversationId: 'lead', goal: 'g', attendees: ['a', 'b', 'c', 'd'], providerId: 'p', modelId: 'm' });
  return { runner, team, teams, log, runs, stopped, changes: () => changes };
}

test("a meeting collects everyone's input, then the plan waits for you", async () => {
  const { runner, team, teams, changes } = rig();
  assert.equal(teams.length, 1);
  assert.equal(team.status, 'meeting');
  await runner.meet(team.id);
  assert.deepEqual(team.minutes.map((m) => m.text), ['a says hi', 'b says hi', 'c says hi', 'd says hi']);
  assert.equal(team.status, 'planned');
  assert.equal(team.plan.assignments.length, 5);
  assert.ok(changes() >= 5, 'the window hears of each minute');
});

test('one attendee failing leaves an error minute; everyone failing fails the team', async () => {
  const some = rig({ contribute: async (_t, who) => { if (who === 'b') throw new Error('timeout'); return 'ok'; } });
  await some.runner.meet(some.team.id);
  assert.equal(some.team.minutes.find((m) => m.coworkerId === 'b').error, 'timeout');
  assert.equal(some.team.status, 'planned');
  const none = rig({ contribute: async () => { throw new Error('no key'); } });
  await none.runner.meet(none.team.id);
  assert.equal(none.team.status, 'failed');
  assert.match(none.team.note, /no key/);
});

test('a plan that never holds together fails the team with the reasons', async () => {
  const { runner, team } = rig({ plan: async () => ({ errors: ['t1: "X" is not in this meeting.'] }) });
  await runner.meet(team.id);
  assert.equal(team.status, 'failed');
  assert.match(team.note, /not in this meeting/);
});

test('Start runs at most three at once, in dependency order, and reports when all are done', async () => {
  const { runner, team, log, runs } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  assert.deepEqual(log, ['t1', 't2', 't4'], 'three independent tasks first');
  assert.equal(team.status, 'working');
  runs.get('t1')({ outcome: 'done', answer: 'one done' });
  await tick();
  assert.deepEqual(log, ['t1', 't2', 't4', 't5'], 't3 still waits for t2; t5 takes the free slot');
  runs.get('t2')({ outcome: 'done', answer: 'two done' });
  await tick();
  assert.deepEqual(log.slice(-1), ['t3']);
  for (const id of ['t3', 't4', 't5']) runs.get(id)({ outcome: 'done', answer: `${id} done` });
  await runner.idle(team.id);
  assert.equal(team.status, 'done');
  assert.equal(team.report, 'All done.');
  assert.equal(team.plan.assignments[0].result, 'one done');
  assert.equal(team.plan.assignments[0].conversationId, 'conv-t1');
});

test('a failed task blocks only its dependants; the team then needs a Retry', async () => {
  const { runner, team, log, runs } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  runs.get('t1')({ outcome: 'failed', answer: '', error: 'boom' });
  for (const id of ['t2', 't4']) runs.get(id)({ outcome: 'done', answer: 'ok' });
  await tick();
  runs.get('t5')({ outcome: 'done', answer: 'ok' });
  await runner.idle(team.id);
  const status = Object.fromEntries(team.plan.assignments.map((a) => [a.id, a.status]));
  assert.deepEqual(status, { t1: 'failed', t2: 'done', t3: 'blocked', t4: 'done', t5: 'done' });
  assert.equal(team.plan.assignments[0].note, 'boom');
  assert.equal(team.status, 'failed');
  runner.retry(team.id);
  await tick();
  assert.equal(team.status, 'working');
  assert.deepEqual(log.slice(-1), ['t1'], 'the failed task runs again; t3 waits for it');
  runs.get('t1')({ outcome: 'done', answer: 'fixed' });
  await tick();
  runs.get('t3')({ outcome: 'done', answer: 'ok' });
  await runner.idle(team.id);
  assert.equal(team.status, 'done');
});

test('Stop team stops everyone running and everyone waiting; Discard drops a plan', async () => {
  const { runner, team, stopped } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  runner.stop(team.id);
  await runner.idle(team.id);
  assert.equal(team.status, 'stopped');
  assert.deepEqual(stopped.sort(), ['conv-t1', 'conv-t2', 'conv-t4']);
  assert.ok(team.plan.assignments.every((a) => a.status === 'stopped' || a.status === 'blocked'), JSON.stringify(team.plan.assignments.map((a) => a.status)));
  const other = rig();
  await other.runner.meet(other.team.id);
  other.runner.discard(other.team.id);
  assert.equal(other.team.status, 'discarded');
  assert.throws(() => other.runner.start(other.team.id), /not waiting/);
});

test('Stop during the meeting ends it without a plan; Retry meets again', async () => {
  let meet = 0;
  const { runner, team } = rig({
    contribute: (_t, who, signal) => {
      meet++;
      if (meet > 4) return Promise.resolve(`${who} again`);
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped'))));
    }
  });
  const meeting = runner.meet(team.id);
  await tick();
  runner.stop(team.id);
  await meeting;
  assert.equal(team.status, 'stopped');
  assert.equal(team.plan, undefined);
  runner.retry(team.id);
  await runner.idle(team.id);
  assert.equal(team.status, 'planned');
  assert.deepEqual(team.minutes.map((m) => m.text), ['a again', 'b again', 'c again', 'd again']);
});

test('stopping while an owner is being set up stops their run as soon as it starts', async () => {
  let release;
  const stopped = [];
  const { runner, team } = rig({
    work: async (_team, a, started) => {
      await new Promise((r) => { if (a.id === 't1') release = r; else r(); });
      started(`conv-${a.id}`);
      return { outcome: stopped.includes(`conv-${a.id}`) ? 'stopped' : 'done', answer: '' };
    },
    stopWork: (id) => stopped.push(id)
  });
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  runner.stop(team.id);
  release();
  await runner.idle(team.id);
  assert.ok(stopped.includes('conv-t1'));
  assert.equal(team.plan.assignments[0].status, 'stopped');
});

test('a team stopped because Axon is closing says so, not that you stopped it', async () => {
  const { runner, team } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  runner.stop(team.id, 'Axon closed while the team was working. Retry to carry on.');
  await runner.idle(team.id);
  assert.match(team.note, /Axon closed/);
});
