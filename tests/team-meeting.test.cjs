// Team meetings: who a lead can gather, what attendees are asked, how the plan is drafted, and the briefs.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../src/main/team/tools.ts');
const meeting = require('../src/main/team/meeting.ts');
const { COWORKERS, coworkerById } = require('../src/shared/coworkers.ts');

const team = (extra = {}) => ({
  id: 'team1', leadId: 'chief-of-staff', conversationId: 'c1', goal: 'Add a password reset flow',
  attendees: ['backend-developer', 'frontend-developer'], providerId: 'p', modelId: 'm', status: 'meeting',
  minutes: [
    { coworkerId: 'backend-developer', text: 'I own the API.', at: 1 },
    { coworkerId: 'frontend-developer', text: 'I own the form.', at: 2 }
  ],
  createdAt: 0, updatedAt: 0, ...extra
});

test('find_people ranks who fits a need, never the lead', () => {
  const found = tools.findPeople('security', 'chief-of-staff');
  assert.match(found, /Security/);
  assert.doesNotMatch(found, /Chief of Staff/);
  assert.ok(found.split('\n').length <= 8);
  assert.match(tools.findPeople('zzqqxx', 'chief-of-staff'), /Nobody/);
});

test('attendees resolve by name or id, the lead and repeats are left out, vague names are refused', () => {
  assert.deepEqual(
    tools.resolveAttendees(['Backend Developer', 'frontend-developer', 'Backend Developer', 'Chief of Staff'], 'chief-of-staff'),
    { ids: ['backend-developer', 'frontend-developer'] }
  );
  assert.match(tools.resolveAttendees(['engineer', 'Backend Developer'], 'chief-of-staff').error, /engineer/);
  assert.match(tools.resolveAttendees(['Backend Developer'], 'chief-of-staff').error, /at least 2/);
  assert.match(tools.resolveAttendees('Backend Developer', 'chief-of-staff').error, /list/);
  const thirteen = COWORKERS.filter((c) => !c.core).slice(0, 13).map((c) => c.id);
  assert.match(tools.resolveAttendees(thirteen, 'chief-of-staff').error, /12/);
  assert.equal(tools.resolveAttendees(thirteen.slice(0, 12), 'chief-of-staff').ids.length, 12);
});

test('leads get the team tools, with when to use them', () => {
  assert.ok(tools.TEAM_LEADS.has('chief-of-staff') && tools.TEAM_LEADS.has('ops-coordinator'));
  assert.equal(tools.TEAM_LEADS.has('backend-developer'), false);
  assert.match(tools.CALL_TEAM_MEETING.description, /more than one specialty/);
  assert.deepEqual(tools.CALL_TEAM_MEETING.parameters.required, ['goal', 'attendees']);
  assert.deepEqual(tools.TEAM_TOOLS.map((t) => t.name), ['find_people', 'call_team_meeting']);
});

test('the meeting prompt tells an attendee the goal, who else is there, and not to do the work yet', () => {
  const prompt = meeting.meetingSystemPrompt(coworkerById('backend-developer'), team());
  assert.match(prompt, /password reset/);
  assert.match(prompt, /Frontend Developer/);
  assert.match(prompt, /Do not do the work/);
  assert.match(prompt, /Chief of Staff/);
});

/** A model that answers each call with the next reply, and keeps what it was asked. */
const scripted = (...replies) => {
  const seen = [];
  return { seen, model: { provider: {}, key: null, modelId: 'm', stream: async (_p, _k, req) => { seen.push(JSON.parse(JSON.stringify(req))); return replies.shift(); } } };
};
let calls = 0;
const proposal = (args) => ({ toolCalls: [{ id: `p${++calls}`, name: 'propose_plan', arguments: JSON.stringify(args) }] });

test('the lead drafts the plan with propose_plan; a broken plan goes back once with the reasons', async () => {
  const bad = { summary: 'x', assignments: [{ id: 't1', owner: 'Designer', title: 'a', brief: 'b' }] };
  const good = { summary: 'API then form', assignments: [
    { id: 't1', owner: 'Backend Developer', title: 'API', brief: 'Build the reset API', files: ['src/api.ts'] },
    { id: 't2', owner: 'Frontend Developer', title: 'Form', brief: 'Build the form', depends_on: ['t1'], files: ['src/form.tsx'] }] };
  const { seen, model } = scripted(proposal(bad), proposal(good));
  const result = await meeting.draftPlan(team(), model);
  assert.equal(result.plan.assignments.length, 2);
  assert.equal(result.plan.summary, 'API then form');
  assert.deepEqual(seen[0].tools.map((t) => t.name), ['propose_plan']);
  assert.match(seen[0].messages[0].content, /I own the API/);
  assert.match(seen[1].messages.at(-1).content, /not in this meeting/);
  assert.equal(seen[1].messages.at(-1).role, 'tool');
});

test('a plan broken twice, or never proposed, fails with the reasons', async () => {
  const empty = { summary: '', assignments: [] };
  assert.match((await meeting.draftPlan(team(), scripted(proposal(empty), proposal(empty)).model)).errors.join(), /at least one/);
  assert.match((await meeting.draftPlan(team(), scripted({ toolCalls: [] }, { toolCalls: [] }).model)).errors.join(), /propose_plan/);
});

test("a task brief has the goal, the task, its files, others' files, and the hand-offs it waits for", () => {
  const t = team({ status: 'working', plan: { summary: 'API then form', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'Build the API', dependsOn: [], files: ['src/api.ts'], status: 'done', result: 'POST /reset is live.' },
    { id: 't2', ownerId: 'frontend-developer', title: 'Form', brief: 'Build the form', dependsOn: ['t1'], files: ['src/form.tsx'], status: 'waiting' }] } });
  const brief = meeting.taskBrief(t, t.plan.assignments[1]);
  for (const part of [/password reset/, /Build the form/, /src\/form\.tsx/, /src\/api\.ts/, /POST \/reset is live/, /Backend Developer/, /hand-off/])
    assert.match(brief, part);
});

test('the report is written from the goal, plan and hand-offs, with no tools', async () => {
  const seen = [];
  const model = { provider: {}, key: null, modelId: 'm', stream: async (_p, _k, req, onChunk) => { seen.push(req); onChunk('All done.'); return { toolCalls: [] }; } };
  const t = team({ status: 'reporting', plan: { summary: 's', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'b', dependsOn: [], files: [], status: 'done', result: 'Shipped.' }] } });
  assert.equal(await meeting.writeReport(t, model), 'All done.');
  assert.equal(seen[0].tools, undefined);
  assert.match(seen[0].messages[0].content, /Shipped\./);
});

test('a lead remembers their teams; a teammate knows the asker shares their team', () => {
  const t = team({ status: 'working', plan: { summary: 's', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'b', dependsOn: [], files: [], status: 'working' }] } });
  assert.match(meeting.teamsBlock([t]), /password reset[\s\S]*Backend Developer[\s\S]*working/);
  assert.equal(meeting.teamsBlock([]), '');
  assert.match(meeting.teammateContext(t, 'backend-developer'), /Your task: API/);
  assert.equal(meeting.teammateContext(t, 'qa-engineer'), '');
});
