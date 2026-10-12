// Agent communication and status you can see in the office: who walks over to whom when a colleague
// is asked a question, who needs you, who just finished. Pure logic, no rendering.
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
const office = '../src/renderer/src/features/office';
const { consultVisits, VisitDirector, CONSULT_STALE_MS } = require(`${office}/visits.ts`);
const presence = require(`${office}/presence.ts`);
const { OfficeSimulation } = require(`${office}/simulation/OfficeSimulation.ts`);
const layout = require(`${office}/simulation/layout.ts`);
const { OFFICE_AGENTS } = require(`${office}/data/officeAgents.ts`);

const { derivePresence, markersFor } = presence;
const FRONT = 'frontend-developer';
const BACK = 'backend-developer';
const WRITER = 'content-creator';
const IDS = [FRONT, BACK, WRITER];
const NOW = 10_000_000;

// ---------------------------------------------------------------- fixtures

let counter = 0;
/** A help record the way the main process writes it: `coworkerId` answers, `forCoworkerId` asked. */
const help = (over = {}) => ({
  id: `h${++counter}`,
  kind: 'help',
  title: 'Helping',
  status: 'working',
  coworkerId: BACK,
  forCoworkerId: FRONT,
  conversationId: 'c1',
  createdAt: NOW - 5_000,
  updatedAt: NOW - 5_000,
  ...over
});
const work = (over = {}) => ({
  id: `w${++counter}`,
  kind: 'work',
  title: 'Task',
  status: 'working',
  coworkerId: FRONT,
  conversationId: 'c1',
  createdAt: 0,
  updatedAt: NOW,
  ...over
});
const run = (over = {}) => ({
  runId: `r${++counter}`,
  conversationId: 'c1',
  agentId: FRONT,
  status: 'working',
  startedAt: NOW - 60_000,
  updatedAt: NOW - 1_000,
  dependencies: [],
  children: [],
  artifactRefs: [],
  ...over
});
const input = (over = {}) => ({
  agentIds: IDS,
  runs: [],
  tasks: [],
  conversations: [{ id: 'c1', agentId: FRONT }],
  approvals: [],
  now: NOW,
  ...over
});

function advance(sim, seconds, dt = 0.05, each) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    sim.step(dt);
    if (each && each(sim) === false) return;
  }
}
const spotOf = (id) => `visit-${layout.HOME_DESKS[id]}`;

// ---------------------------------------------------------------- who visits whom

test('every person has a visiting spot at their desk', () => {
  for (const agent of OFFICE_AGENTS) assert.ok(layout.poiById(spotOf(agent.id)), agent.id);
});

test('the one who asked visits the one they asked, and only while the answer is being written', () => {
  // The record belongs to the colleague answering (coworkerId) and says whom they answer for (forCoworkerId).
  const ask = help({ coworkerId: BACK, forCoworkerId: FRONT });
  assert.deepEqual(consultVisits([ask], NOW), [{ visitor: FRONT, host: BACK }]);
  // The answer is in: the visit is over, whatever the asker's own run is still doing.
  assert.deepEqual(consultVisits([{ ...ask, status: 'done' }, work({ status: 'working' })], NOW), []);
  assert.deepEqual(consultVisits([{ ...ask, status: 'attention' }], NOW), []);
  // Only help records make visits.
  assert.deepEqual(consultVisits([work({ coworkerId: BACK, forCoworkerId: FRONT })], NOW), []);
  // Nobody visits themselves, and a record missing a side is no visit.
  assert.deepEqual(consultVisits([help({ coworkerId: FRONT, forCoworkerId: FRONT })], NOW), []);
  assert.deepEqual(consultVisits([help({ forCoworkerId: undefined })], NOW), []);
  // A leftover from a crash mid-answer is not someone standing at a desk.
  assert.deepEqual(consultVisits([help({ updatedAt: NOW - CONSULT_STALE_MS - 1 })], NOW), []);
});

test('someone who asks two colleagues at once visits the first; two askers each make a visit', () => {
  const first = help({ coworkerId: BACK, createdAt: 10, updatedAt: NOW });
  const second = help({ coworkerId: WRITER, createdAt: 20, updatedAt: NOW });
  assert.deepEqual(consultVisits([second, first], NOW), [{ visitor: FRONT, host: BACK }]);
  const other = help({ coworkerId: BACK, forCoworkerId: WRITER, createdAt: 30, updatedAt: NOW });
  assert.deepEqual(consultVisits([first, other], NOW), [
    { visitor: FRONT, host: BACK },
    { visitor: WRITER, host: BACK }
  ]);
});

// ---------------------------------------------------------------- the director

function fakeWorld(options = {}) {
  const log = [];
  const world = {
    log,
    walks: options.walks ?? true,
    free: options.free ?? true,
    startHelp(visitor, host) {
      log.push(`start ${visitor}>${host}`);
      return world.walks && world.free;
    },
    endHelp(visitor) {
      log.push(`end ${visitor}`);
    }
  };
  return world;
}

test('a visit starts for the asker, ends when the colleague has answered, and moves on if the pair changes', () => {
  const world = fakeWorld();
  const director = new VisitDirector(world);
  director.sync([{ visitor: FRONT, host: BACK }]);
  assert.deepEqual(world.log, [`start ${FRONT}>${BACK}`]);
  assert.deepEqual(director.visits(), [{ visitor: FRONT, host: BACK }]);
  // The same news again changes nothing.
  director.sync([{ visitor: FRONT, host: BACK }]);
  assert.equal(world.log.length, 1);
  // The colleague answered: the asker goes back.
  director.sync([]);
  assert.deepEqual(world.log.slice(1), [`end ${FRONT}`]);
  assert.deepEqual(director.visits(), []);
  // Asking someone else: back from the first, over to the second.
  director.sync([{ visitor: FRONT, host: BACK }]);
  director.sync([{ visitor: FRONT, host: WRITER }]);
  assert.deepEqual(world.log.slice(-2), [`end ${FRONT}`, `start ${FRONT}>${WRITER}`]);
});

test('a visit that cannot start yet is asked again until it does, not recorded as done', () => {
  const world = fakeWorld({ free: false });
  const director = new VisitDirector(world);
  director.sync([{ visitor: FRONT, host: BACK }]);
  assert.deepEqual(director.waiting(), [{ visitor: FRONT, host: BACK }], 'still waiting for the desk');
  director.retry();
  director.retry();
  assert.ok(world.log.length >= 3, 'asked again each time');
  assert.equal(director.waiting().length, 1);
  world.free = true;
  director.retry();
  assert.equal(director.waiting().length, 0, 'started once the desk was free');
  const asked = world.log.length;
  director.retry();
  assert.equal(world.log.length, asked, 'a visit under way is not asked again');
  // Answered before it ever got to walk: ended once, nothing left over.
  const impatient = fakeWorld({ free: false });
  const second = new VisitDirector(impatient);
  second.sync([{ visitor: FRONT, host: BACK }]);
  second.sync([]);
  assert.deepEqual(impatient.log.at(-1), `end ${FRONT}`);
  assert.deepEqual(second.waiting(), []);
  const count = impatient.log.length;
  second.retry();
  assert.equal(impatient.log.length, count, 'nothing is retried once the question is answered');
});

test('with reduced motion nobody walks: the pair is marked once and never retried', () => {
  const world = fakeWorld({ walks: false });
  const director = new VisitDirector(world);
  director.sync([{ visitor: FRONT, host: BACK }]);
  director.retry();
  director.retry();
  assert.deepEqual(world.log, [`start ${FRONT}>${BACK}`], 'marked once (the link and bubbles show), no retries');
  assert.deepEqual(director.waiting(), []);
  assert.deepEqual(director.visits(), [{ visitor: FRONT, host: BACK }]);
});

/** The director over a real simulation, the way the scene wires it. */
function liveWorld(sim) {
  return {
    walks: true,
    startHelp: (visitor, host) => sim.startHelp(visitor, host),
    endHelp: (visitor) => sim.endHelp(visitor)
  };
}

test('in the office: the asker walks to the colleague’s desk and back when the colleague answers', () => {
  const sim = new OfficeSimulation({ agentIds: IDS, seed: 4 });
  // The asker is waiting on the answer (still on their own task); the colleague is writing it.
  sim.setTaskStatus(FRONT, 'working');
  sim.setTaskStatus(BACK, 'working');
  sim.step(1 / 60);
  const director = new VisitDirector(liveWorld(sim));
  const tasks = [help({ updatedAt: NOW })];
  director.sync(consultVisits(tasks, NOW));
  advance(sim, 60, 0.05, (s) => s.view(FRONT).poiId !== spotOf(BACK));
  assert.equal(sim.view(FRONT).poiId, spotOf(BACK), 'the asker, not the colleague, makes the trip');
  assert.equal(sim.view(BACK).poiId, layout.HOME_DESKS[BACK], 'the colleague stays seated');
  assert.ok(sim.view(BACK).sit > 0.95);
  assert.ok(sim.view(BACK).attention, 'and turns towards the asker');
  advance(sim, 15, 0.1);
  assert.equal(sim.view(FRONT).poiId, spotOf(BACK), 'the asker waits for the answer at the desk');
  // The colleague answers: the help record is done. The asker's own run carries on.
  director.sync(consultVisits([{ ...tasks[0], status: 'done' }], NOW));
  advance(sim, 60, 0.05, (s) => !(s.view(FRONT).poiId === layout.HOME_DESKS[FRONT] && s.view(FRONT).sit > 0.95));
  assert.equal(sim.view(FRONT).poiId, layout.HOME_DESKS[FRONT]);
  assert.equal(sim.screenState(layout.HOME_DESKS[FRONT]), 'active', 'back at their screen, still on the task');
});

test('in the office: a second asker waits for the desk and walks over once it is free', () => {
  const sim = new OfficeSimulation({ agentIds: IDS, seed: 4 });
  for (const id of IDS) sim.setTaskStatus(id, 'working');
  sim.step(1 / 60);
  const director = new VisitDirector(liveWorld(sim));
  const one = { visitor: FRONT, host: BACK };
  const two = { visitor: WRITER, host: BACK };
  director.sync([one, two]);
  assert.deepEqual(director.waiting(), [two], 'the desk has room for one visitor');
  advance(sim, 40, 0.05, (s) => s.view(FRONT).poiId !== spotOf(BACK));
  assert.equal(sim.view(FRONT).poiId, spotOf(BACK));
  assert.notEqual(sim.view(WRITER).poiId, spotOf(BACK));
  // The first is answered and walks away; the second is let in on the first try after the spot is free.
  director.sync([two]);
  for (let second = 0; second < 10 && director.waiting().length; second++) {
    advance(sim, 1, 0.05);
    director.retry();
  }
  assert.deepEqual(director.waiting(), [], 'let in once the first visitor had left the spot');
  assert.notEqual(sim.view(FRONT).poiId, spotOf(BACK));
  advance(sim, 60, 0.05, (s) => s.view(WRITER).poiId !== spotOf(BACK));
  assert.equal(sim.view(WRITER).poiId, spotOf(BACK));
});

// ---------------------------------------------------------------- status from the runs

test('working: a run in progress, a colleague’s answer, a wait for a colleague or the queue', () => {
  const got = derivePresence(
    input({
      runs: [
        run({ agentId: FRONT, status: 'waiting_for_agent', summary: 'Waiting for Backend Developer' }),
        run({ agentId: BACK, status: 'working', conversationId: 'c2' }),
        run({ agentId: WRITER, status: 'queued', conversationId: 'c3' })
      ]
    })
  );
  assert.deepEqual(got.statuses, { [FRONT]: 'working', [BACK]: 'working', [WRITER]: 'working' });
  assert.deepEqual(got.beacons, {}, 'nobody needs you');
  assert.equal(got.nextChange, null);
});

test('needs you: an approval for their conversation, an answer you owe, a plan to start', () => {
  const approval = derivePresence(
    input({ runs: [run({ status: 'working' })], approvals: [{ conversationId: 'c1' }] })
  );
  assert.equal(approval.statuses[FRONT], 'waiting');
  assert.equal(approval.beacons[FRONT], 'needs');
  // The approval belongs to whoever owns the conversation, even with no run on record.
  const bare = derivePresence(input({ approvals: [{ conversationId: 'c1' }] }));
  assert.equal(bare.statuses[FRONT], 'waiting');
  for (const status of ['waiting_for_user', 'waiting_for_approval']) {
    const got = derivePresence(input({ runs: [run({ status })] }));
    assert.equal(got.statuses[FRONT], 'waiting', status);
    assert.equal(got.beacons[FRONT], 'needs', status);
  }
  assert.equal(derivePresence(input({ approvals: [{ conversationId: 'elsewhere' }] })).statuses[FRONT], undefined);
});

test('just finished: green strip status for twenty seconds, the tick for the first three, then idle', () => {
  const finished = run({ status: 'completed', completedAt: NOW - 1_000, updatedAt: NOW - 1_000 });
  const tasks = [work({ status: 'done' })];
  const at = (offset) => derivePresence(input({ runs: [finished], tasks, now: NOW + offset }));
  const fresh = at(0);
  assert.equal(fresh.statuses[FRONT], 'completed', 'done is reachable with runs loaded');
  assert.equal(fresh.beacons[FRONT], 'done');
  assert.equal(fresh.nextChange, finished.completedAt + presence.TICK_FOR_MS, 'looks again when the tick is over');
  const later = at(5_000);
  assert.equal(later.statuses[FRONT], 'completed');
  assert.equal(later.beacons[FRONT], undefined, 'the tick was a burst');
  assert.equal(later.nextChange, finished.completedAt + presence.DONE_FOR_MS);
  const over = at(25_000);
  assert.equal(over.statuses[FRONT], undefined, 'idle again');
  assert.equal(over.nextChange, null);
  // A new run starting right after takes over.
  const again = derivePresence(input({ runs: [finished, run({ status: 'working', updatedAt: NOW })], tasks }));
  assert.equal(again.statuses[FRONT], 'working');
});

test('the newest run decides, and a canceled run is just idle', () => {
  const older = run({ status: 'failed', completedAt: NOW - 50_000, updatedAt: NOW - 50_000 });
  const newer = run({ status: 'completed', completedAt: NOW - 2_000, updatedAt: NOW - 2_000 });
  assert.equal(derivePresence(input({ runs: [older, newer] })).statuses[FRONT], 'completed');
  assert.equal(derivePresence(input({ runs: [newer, older] })).statuses[FRONT], 'completed');
  const stopped = run({ status: 'canceled', completedAt: NOW - 2_000, updatedAt: NOW - 2_000 });
  assert.equal(derivePresence(input({ runs: [stopped] })).statuses[FRONT], undefined);
});

test('failed: the badge shows briefly, the tag stays red', () => {
  const failed = run({ status: 'failed', error: 'Rate limited', completedAt: NOW - 1_000, updatedAt: NOW - 1_000 });
  const fresh = derivePresence(input({ runs: [failed] }));
  assert.equal(fresh.statuses[FRONT], 'error');
  assert.equal(fresh.beacons[FRONT], 'failed');
  assert.equal(fresh.nextChange, failed.completedAt + presence.FAILED_BADGE_FOR_MS);
  const later = derivePresence(input({ runs: [failed], now: NOW + 20_000 }));
  assert.equal(later.statuses[FRONT], 'error');
  assert.equal(later.beacons[FRONT], undefined);
});

test('stopped early or interrupted: needs a look until you deal with it (for a day at most)', () => {
  const ended = run({ status: 'completed', completedAt: NOW - 60_000, updatedAt: NOW - 60_000 });
  const early = work({ status: 'attention', note: 'Reached the step limit before answering.', updatedAt: NOW - 60_000 });
  const got = derivePresence(input({ runs: [ended], tasks: [early] }));
  assert.equal(got.statuses[FRONT], 'waiting');
  assert.equal(got.beacons[FRONT], 'needs');
  // A clean finish is not that.
  const clean = derivePresence(input({ runs: [ended], tasks: [{ ...early, status: 'done', note: undefined }] }));
  assert.equal(clean.statuses[FRONT], undefined);
  // Half a day later it still asks; much later it stops calling out from across the room.
  assert.equal(derivePresence(input({ runs: [ended], tasks: [early], now: NOW + 6 * 3_600_000 })).statuses[FRONT], 'waiting');
  assert.equal(derivePresence(input({ runs: [ended], tasks: [early], now: NOW + 13 * 3_600_000 })).statuses[FRONT], undefined);
  // A restart leaves interrupted runs; a run that is blocked also wants a look.
  for (const status of ['interrupted', 'blocked']) {
    const stuck = derivePresence(input({ runs: [run({ status, updatedAt: NOW - 5_000 })] }));
    assert.equal(stuck.beacons[FRONT], 'needs', status);
  }
  // No run on record at all: the task record still knows. An approval note with nothing pending is stale.
  assert.equal(derivePresence(input({ tasks: [early] })).statuses[FRONT], 'waiting');
  const staleApproval = work({ status: 'attention', note: 'Waiting for your approval' });
  assert.equal(derivePresence(input({ tasks: [staleApproval] })).statuses[FRONT], undefined);
});

test('answering a colleague is work, but not a task of their own to celebrate or fail', () => {
  const asker = run({ runId: 'parent', agentId: FRONT, status: 'waiting_for_agent' });
  const answer = (over) =>
    run({ runId: 'answer', agentId: BACK, parentRunId: 'parent', conversationId: 'c1', status: 'working', ...over });
  const during = derivePresence(input({ runs: [asker, answer()] }));
  assert.equal(during.statuses[FRONT], 'working', 'waiting on a colleague is not needing you');
  assert.equal(during.statuses[BACK], 'working');
  const done = answer({ status: 'completed', completedAt: NOW - 500, updatedAt: NOW - 500 });
  const after = derivePresence(input({ runs: [{ ...asker, status: 'working' }, done] }));
  assert.equal(after.statuses[BACK], undefined, 'no green tick for answering a question');
  assert.equal(after.beacons[BACK], undefined);
  const failed = answer({ status: 'failed', completedAt: NOW - 500, updatedAt: NOW - 500 });
  assert.equal(derivePresence(input({ runs: [{ ...asker, status: 'working' }, failed] })).statuses[BACK], undefined);
  // A team's contribution is a task of its own, and a worker's run (it has a task id) is too.
  const teamRun = run({
    agentId: BACK,
    parentRunId: 'parent',
    taskId: 'a1',
    status: 'completed',
    completedAt: NOW - 500,
    updatedAt: NOW - 500
  });
  assert.equal(derivePresence(input({ runs: [asker, teamRun] })).statuses[BACK], 'completed');
});

test('people the office does not know are ignored', () => {
  const got = derivePresence(input({ runs: [run({ agentId: 'someone-else', status: 'waiting_for_user' })] }));
  assert.deepEqual(got.statuses, {});
});

test('done is reachable: working, then a finished run, makes them celebrate at their desk', () => {
  const sim = new OfficeSimulation({ agentIds: IDS, seed: 8 });
  const apply = (runs, now) => {
    const { statuses } = derivePresence(input({ runs, now }));
    for (const id of IDS) sim.setTaskStatus(id, statuses[id] ?? 'idle');
  };
  sim.setTaskStatus(FRONT, 'idle');
  sim.step(1 / 60);
  apply([run({ status: 'working' })], NOW);
  advance(sim, 3, 0.1);
  assert.equal(sim.screenState(layout.HOME_DESKS[FRONT]), 'active');
  apply([run({ status: 'completed', completedAt: NOW + 3_000, updatedAt: NOW + 3_000 })], NOW + 3_500);
  const seen = new Set();
  advance(sim, 4, 0.1, (s) => void seen.add(s.view(FRONT).behavior));
  assert.ok(seen.has('celebrating'), `celebrated, saw ${[...seen].join(', ')}`);
});

// ---------------------------------------------------------------- what is drawn over each head

test('each head shows the one thing worth reading, and a visit puts words over both people', () => {
  const names = { [FRONT]: 'Frontend Developer', [BACK]: 'Backend Developer' };
  const got = markersFor({
    statuses: { [FRONT]: 'working', [BACK]: 'working', [WRITER]: 'waiting', 'files-agent': 'completed', designer: 'working' },
    beacons: { [WRITER]: 'needs', 'files-agent': 'done' },
    visits: [{ visitor: FRONT, host: BACK }],
    nameOf: (id) => names[id]
  });
  assert.deepEqual(got[FRONT], { kind: 'asking', text: 'Asking Backend Developer…' });
  assert.deepEqual(got[BACK], { kind: 'answering', text: 'Answering…' });
  assert.deepEqual(got[WRITER], { kind: 'needs' });
  assert.deepEqual(got['files-agent'], { kind: 'done' });
  assert.deepEqual(got.designer, { kind: 'working' });
  // Needing you outranks everything; failing outranks finishing; a status alone still says "needs you".
  const strong = markersFor({
    statuses: { [BACK]: 'waiting', [FRONT]: 'working', designer: 'error' },
    beacons: { designer: 'failed' },
    visits: [{ visitor: FRONT, host: BACK }],
    nameOf: (id) => names[id]
  });
  assert.equal(strong[BACK].kind, 'needs');
  assert.equal(strong[FRONT].kind, 'asking');
  assert.equal(strong.designer.kind, 'failed');
});

test('a question is two talking markers, whose words go on their name tags; other markers do not', () => {
  const names = { [FRONT]: 'Frontend Developer', [BACK]: 'Backend Developer' };
  const got = markersFor({
    statuses: { [FRONT]: 'working', [BACK]: 'working', [WRITER]: 'waiting' },
    beacons: { [WRITER]: 'needs' },
    visits: [{ visitor: FRONT, host: BACK }],
    nameOf: (id) => names[id]
  });
  assert.equal(presence.isTalk(got[FRONT].kind), true);
  assert.equal(presence.isTalk(got[BACK].kind), true);
  assert.equal(presence.isTalk(got[WRITER].kind), false);
  assert.equal(presence.isTalk('needs'), false);
  assert.equal(presence.isTalk('done'), false);
  assert.equal(presence.isTalk(undefined), false);
});

test('there is a limit on badges drawn, and the quiet working dots go first', () => {
  const statuses = {};
  for (let i = 0; i < presence.MAX_MARKERS + 25; i++) statuses[`p${i}`] = 'working';
  statuses.urgent = 'waiting';
  const got = markersFor({ statuses, beacons: { urgent: 'needs' }, visits: [], nameOf: () => undefined });
  assert.equal(Object.keys(got).length, presence.MAX_MARKERS);
  assert.equal(got.urgent.kind, 'needs');
});
