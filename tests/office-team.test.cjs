// Teams in the window: finding a meeting's team from its call, who sits in the boardroom, and the board's cards.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const team = require('../src/renderer/src/features/office/team.ts');

const teams = [
  { id: 'a', status: 'meeting', leadId: 'chief-of-staff', attendees: ['x', 'y'] },
  { id: 'b', status: 'working', leadId: 'chief-of-staff', attendees: ['z'] },
  { id: 'c', status: 'reporting', leadId: 'ops-coordinator', attendees: ['w'] }
];

test('a call_team_meeting call finds its team by the id in its result', () => {
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', result: JSON.stringify({ team: 'b' }) }, teams).id, 'b');
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', error: 'nope' }, teams), undefined);
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', result: 'not json' }, teams), undefined);
});

test('people sit in their team’s room from the meeting to the report, working from there; teams from before rooms used the boardroom', () => {
  const working = { id: 'd', status: 'working', leadId: 'ops-coordinator', attendees: ['p', 'q'], room: 'room-3', plan: { summary: '', assignments: [
    { id: 't1', ownerId: 'p', status: 'working' }, { id: 't2', ownerId: 'q', status: 'waiting' }] } };
  const closed = ['done', 'stopped', 'failed', 'discarded'].map((status, i) => ({ id: `z${i}`, status, leadId: 'chief-of-staff', attendees: ['x'] }));
  assert.deepEqual(team.openMeetings([...teams, { id: 'e', status: 'planned', leadId: 'chief-of-staff', attendees: ['v'], room: 'room-1' }, working, ...closed]), [
    { id: 'a', leadId: 'chief-of-staff', attendees: ['x', 'y'], room: 'boardroom', working: [] },
    { id: 'b', leadId: 'chief-of-staff', attendees: ['z'], room: 'boardroom', working: [] },
    { id: 'c', leadId: 'ops-coordinator', attendees: ['w'], room: 'boardroom', working: [] },
    { id: 'e', leadId: 'chief-of-staff', attendees: ['v'], room: 'room-1', working: [] },
    { id: 'd', leadId: 'ops-coordinator', attendees: ['p', 'q'], room: 'room-3', working: ['p'] }
  ]);
});

test('every status has words', () => {
  for (const s of ['meeting', 'planned', 'working', 'reporting', 'done', 'stopped', 'failed', 'discarded']) assert.ok(team.TEAM_WORDS[s], s);
  for (const s of ['waiting', 'working', 'done', 'failed', 'stopped', 'blocked']) assert.ok(team.TASK_WORDS[s], s);
});

test('the boardroom board shows the open team: its goal while they meet, then each task by owner and status', () => {
  const meeting = { id: 'a', status: 'meeting', leadId: 'chief-of-staff', goal: 'Add password reset', updatedAt: 1, attendees: [] };
  assert.deepEqual(team.teamBoardCards([meeting]).map((c) => [c.title, c.coworkerId, c.status]), [['Add password reset', 'chief-of-staff', 'working']]);
  const working = { id: 'b', status: 'working', leadId: 'chief-of-staff', goal: 'g', updatedAt: 2, attendees: [], plan: { summary: '', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', status: 'done' },
    { id: 't2', ownerId: 'frontend-developer', title: 'Form', status: 'blocked' }] } };
  assert.deepEqual(team.teamBoardCards([meeting, working]).map((c) => [c.title, c.coworkerId, c.status]),
    [['API', 'backend-developer', 'done'], ['Form', 'frontend-developer', 'attention']]);
  assert.deepEqual(team.teamBoardCards([{ ...working, status: 'done' }]), []);
});

test('each room’s board shows the team in that room', () => {
  const inRoom3 = { id: 'r3', status: 'meeting', leadId: 'ops-coordinator', goal: 'Launch posts', updatedAt: 5, attendees: [], room: 'room-3' };
  const inBoardroom = { id: 'b', status: 'meeting', leadId: 'chief-of-staff', goal: 'Big build', updatedAt: 1, attendees: [] };
  const boards = team.roomBoardCards([inRoom3, inBoardroom]);
  assert.deepEqual(Object.keys(boards), ['boardroom', 'room-1', 'room-2', 'room-3', 'room-4']);
  assert.deepEqual(boards['room-3'].map((c) => c.title), ['Launch posts']);
  assert.deepEqual(boards.boardroom.map((c) => c.title), ['Big build'], 'the newer team elsewhere does not take the boardroom board');
  assert.deepEqual(boards['room-1'], []);
});
