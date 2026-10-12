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
  assert.match(tools.CALL_TEAM_MEETING.parameters.properties.room.description, /Boardroom, Room 1, Room 2, Room 3, Room 4/);
});

test('a team gets a free six-seater, the boardroom when it is bigger, or the room the user named', () => {
  assert.deepEqual(tools.resolveRoom(undefined, 3, []), { room: 'room-1' });
  assert.deepEqual(tools.resolveRoom(undefined, 6, ['room-1', 'room-2']), { room: 'room-3' });
  assert.deepEqual(tools.resolveRoom(undefined, 7, []), { room: 'boardroom' });
  assert.deepEqual(tools.resolveRoom(undefined, 4, ['room-1', 'room-2', 'room-3', 'room-4']), { room: 'boardroom' });
  // Every room taken: share the fitting one with the fewest teams.
  assert.equal(tools.resolveRoom(undefined, 4, ['room-1', 'room-1', 'room-2', 'room-3', 'room-4', 'boardroom']).room, 'room-2');
  for (const asked of ['Room 3', 'room-3', 'meeting room 3', '3']) assert.deepEqual(tools.resolveRoom(asked, 4, []), { room: 'room-3' }, asked);
  assert.deepEqual(tools.resolveRoom('the boardroom', 3, []), { room: 'boardroom' });
  // What was asked for and could not be had is said, with where they meet instead.
  assert.deepEqual(tools.resolveRoom('Room 2', 8, []), { room: 'boardroom', note: 'Room 2 seats 6, too few for 8, so they meet in the boardroom.' });
  assert.deepEqual(tools.resolveRoom('Room 2', 3, ['room-2']), { room: 'room-1', note: 'Room 2 has another team in it, so they meet in Room 1.' });
  assert.match(tools.resolveRoom('the kitchen', 3, []).note, /no room called "the kitchen"[\s\S]*Room 1/);
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

// ---- The team chat: who can message whom, who gets it now, and what a brief carries ----
const channel = require('../src/main/team/channel.ts');

const longHandOff = 'Checked every flow. '.repeat(200);
/** A team mid-work: the API owner is writing, the form owner is waiting, QA is done, the lead is the Chief of Staff. */
const working = (extra = {}) => team({
  status: 'working', conversationId: 'lead-chat', channel: [],
  attendees: ['backend-developer', 'frontend-developer', 'qa-engineer'],
  plan: { summary: 's', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'b', dependsOn: [], files: [], status: 'working', conversationId: 'c-api' },
    { id: 't2', ownerId: 'frontend-developer', title: 'Form', brief: 'b', dependsOn: ['t1'], files: [], status: 'waiting' },
    { id: 't3', ownerId: 'qa-engineer', title: 'Checks', brief: 'b', dependsOn: [], files: [], status: 'done', result: longHandOff }] },
  ...extra
});
/** What the service would give postToTeam: the phase of each task conversation, and a record of what was delivered. */
const desk = (phases = { 'c-api': 'running' }, leadRunning = false) => {
  const delivered = [];
  let n = 0;
  return { delivered, deps: { id: () => `p${++n}`, now: () => 1000 + n, phase: (c) => phases[c], leadRunning: () => leadRunning, deliver: (conversationId, text, from) => delivered.push({ conversationId, text, from }) } };
};
const sendFrom = (t, conversationId, input, d = desk()) => ({ ...channel.postToTeam(t, channel.seatOf([t], conversationId), input, d.deps), d });

test('a conversation sits in a team as the owner of a task under way, or the lead while the team works', () => {
  const t = working();
  assert.deepEqual([channel.seatOf([t], 'c-api').selfId, channel.seatOf([t], 'c-api').assignment.id], ['backend-developer', 't1']);
  assert.equal(channel.seatOf([t], 'lead-chat').selfId, 'chief-of-staff');
  assert.equal(channel.seatOf([t], 'lead-chat').assignment, undefined);
  assert.equal(channel.seatOf([t], 'elsewhere'), null);
  assert.equal(channel.seatOf([working({ status: 'reporting' })], 'lead-chat'), null, 'the report is written with no tools');
  const finished = working();
  finished.plan.assignments[0].status = 'done';
  assert.equal(channel.seatOf([finished], 'c-api'), null, 'a task that is over has no seat');
});

test('a teammate is found by id, name, or the part of a name that fits only one; anything else lists the teammates', () => {
  const t = working();
  for (const asked of ['frontend-developer', 'Frontend Developer', 'frontend developer', 'frontend'])
    assert.deepEqual(channel.resolveTeammate(t, asked, 'backend-developer'), { id: 'frontend-developer' }, asked);
  assert.deepEqual(channel.resolveTeammate(t, 'Chief of Staff', 'backend-developer'), { id: 'chief-of-staff' }, 'the lead is a teammate too');
  const unknown = channel.resolveTeammate(t, 'Plumber', 'backend-developer').error;
  assert.match(unknown, /Nobody on this team is called "Plumber"/);
  assert.match(unknown, /Chief of Staff \(the lead\)/);
  assert.match(unknown, /Frontend Developer \(Form\)/);
  assert.doesNotMatch(unknown, /Backend Developer/, 'not yourself');
  assert.match(channel.resolveTeammate(t, 'developer', 'chief-of-staff').error, /More than one teammate fits "developer": Backend Developer, Frontend Developer/);
  assert.match(channel.resolveTeammate(t, 'Backend Developer', 'backend-developer').error, /That is you/);
});

test('a message to a teammate who is working is kept in the chat and handed to their run, from the sender', () => {
  const t = working();
  const sent = sendFrom(t, 'lead-chat', { text: ' Use JWT for the reset token. ', to: 'Backend Developer' });
  assert.equal(sent.isError, undefined);
  assert.deepEqual(sent.d.delivered, [{
    conversationId: 'c-api', from: 'Chief of Staff',
    text: 'Message from Chief of Staff on your team: Use JWT for the reset token.\n\nReply with message_team if they need an answer.'
  }]);
  assert.deepEqual(t.channel, [{ id: 'p1', fromId: 'chief-of-staff', toId: 'backend-developer', text: 'Use JWT for the reset token.', at: 1001 }]);
  assert.equal(sent.post, t.channel[0]);
  assert.match(sent.content, /^Sent to Backend Developer: Backend Developer is working and will read it at their next step\./);
  assert.match(sent.content, /a reply arrives here as a message/);
});

test('with no one named it goes to every live teammate but the sender; others see it later, or are told it is too late', () => {
  const t = working();
  t.plan.assignments[2].status = 'waiting'; // QA has not started
  const d = desk({ 'c-api': 'running', 'c-form': 'running' }, true);
  // The form owner is working too, and the lead has a run going.
  Object.assign(t.plan.assignments[1], { status: 'working', conversationId: 'c-form' });
  const sent = sendFrom(t, 'c-api', { text: 'The reset endpoint is POST /reset.' }, d);
  assert.deepEqual(d.delivered.map((x) => x.conversationId).sort(), ['c-form', 'lead-chat']);
  assert.ok(d.delivered.every((x) => x.from === 'Backend Developer' && /\(to everyone\)/.test(x.text)));
  assert.match(sent.content, /^Sent to the team: Chief of Staff, Frontend Developer are working and will read it at their next step; QA Engineer will find it in their brief when they start\./);
  assert.equal(t.channel[0].toId, undefined, 'a post to everyone has no addressee');
  assert.equal(t.channel[0].taskId, 't1');
  // "everyone" in the place of a name is the same thing.
  const again = sendFrom(t, 'c-api', { text: 'And it needs an email.', to: 'everyone' }, desk());
  assert.equal(again.post.toId, undefined);
  // Wrapping up: kept, not delivered, and said so.
  const closing = sendFrom(working(), 'lead-chat', { text: 'One more thing.', to: 'Backend Developer' }, desk({ 'c-api': 'closing' }));
  assert.deepEqual(closing.d.delivered, []);
  assert.match(closing.content, /writing up a hand-off, so it is only in the team chat/);
});

test('nobody is started for a message: an idle lead and a teammate who has not begun just have it kept', () => {
  const t = working();
  const toLead = sendFrom(t, 'c-api', { text: 'Which hash do you want?', to: 'Chief of Staff' });
  assert.deepEqual(toLead.d.delivered, []);
  assert.match(toLead.content, /Chief of Staff will see it on their next turn/);
  const toForm = sendFrom(t, 'c-api', { text: 'POST /reset takes an email.', to: 'Frontend Developer' });
  assert.deepEqual(toForm.d.delivered, []);
  assert.match(toForm.content, /Frontend Developer will find it in their brief when they start/);
  assert.equal(t.channel.length, 2);
});

test('a teammate who has not started finds what was said to them, or to everyone, in their brief', () => {
  const t = working();
  sendFrom(t, 'c-api', { text: 'POST /reset takes an email.', to: 'Frontend Developer' });
  sendFrom(t, 'c-api', { text: 'The API runs on port 4000.' });
  sendFrom(t, 'c-api', { text: 'Secret between us.', to: 'Chief of Staff' });
  sendFrom(t, 'lead-chat', { text: 'Keep it accessible.', to: 'Frontend Developer' });
  const brief = meeting.taskBrief(t, t.plan.assignments[1]);
  assert.match(brief, /Notes from your team[^\n]*message_team/);
  assert.match(brief, /- Backend Developer to you: POST \/reset takes an email\./);
  assert.match(brief, /- Backend Developer to everyone: The API runs on port 4000\./);
  assert.match(brief, /- Chief of Staff to you: Keep it accessible\./);
  assert.doesNotMatch(brief, /Secret between us/, 'a note to someone else is not theirs');
  assert.doesNotMatch(meeting.taskBrief(t, t.plan.assignments[0]), /POST \/reset takes an email/, 'what you said yourself is not a note to you');
  assert.match(brief, /message_team reaches the person doing that task/);
  // A long chat is cut to the latest, each note to a size a brief can carry.
  for (let i = 0; i < 14; i++) sendFrom(t, 'lead-chat', { text: `Note ${i} ${'y'.repeat(2000)}`, to: 'Frontend Developer' });
  const long = meeting.taskBrief(t, t.plan.assignments[1]);
  assert.match(long, /the latest 10 of 17/);
  assert.match(long, /Note 13 /);
  assert.doesNotMatch(long, /Note 3 /);
  assert.ok(!long.includes('y'.repeat(1501)));
});

test('a message to a teammate who is done is not kept: the sender is told, with the start of their hand-off', () => {
  const t = working();
  const sent = sendFrom(t, 'c-api', { text: 'Can you recheck login?', to: 'QA Engineer' });
  assert.equal(sent.isError, undefined);
  assert.deepEqual(sent.d.delivered, []);
  assert.equal(t.channel.length, 0);
  assert.match(sent.content, /QA Engineer has already finished "Checks", so they will not read this\. Their hand-off: Checked every flow\./);
  const excerpt = sent.content.split('Their hand-off: ')[1];
  assert.equal(excerpt.length, 1501, 'the first 1,500 characters and an ellipsis');
});

test('an unknown teammate, an empty or oversize message, a repeat and a stranger to the plan are all refused clearly', () => {
  const t = working({ attendees: ['backend-developer', 'frontend-developer', 'qa-engineer', 'designer'] });
  const unknown = sendFrom(t, 'c-api', { text: 'Hi', to: 'Plumber' });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content, /Your teammates: .*Chief of Staff \(the lead\).*Frontend Developer \(Form\)/);
  assert.equal(sendFrom(t, 'c-api', { text: '   ' }).isError, true);
  const huge = sendFrom(t, 'c-api', { text: 'x'.repeat(channel.POST_LIMIT + 1) });
  assert.equal(huge.isError, true);
  assert.match(huge.content, /under 4,000/);
  assert.equal(sendFrom(t, 'c-api', { text: 'ok', to: ['A', 'B'] }).isError, true);
  assert.equal(t.channel.length, 0, 'nothing refused is kept');
  assert.equal(sendFrom(t, 'c-api', { text: 'Same thing', to: 'Frontend Developer' }).isError, undefined);
  assert.match(sendFrom(t, 'c-api', { text: 'Same thing', to: 'Frontend Developer' }).content, /already sent that to Frontend Developer/);
  const nobody = sendFrom(t, 'c-api', { text: 'Hello?', to: 'Designer' });
  assert.match(nobody.content, /Designer has no task in this plan/);
  assert.equal(t.channel.length, 1);
});

test('the chat keeps the latest 200 posts of at most 4,000 characters, and old teams get an empty one', () => {
  const t = working();
  for (let i = 0; i < 205; i++) sendFrom(t, 'lead-chat', { text: `message ${i}`, to: 'Backend Developer' });
  assert.equal(t.channel.length, channel.CHANNEL_LIMIT);
  assert.equal(t.channel[0].text, 'message 5');
  assert.equal(t.channel.at(-1).text, 'message 204');
  assert.equal(sendFrom(t, 'lead-chat', { text: 'y'.repeat(channel.POST_LIMIT), to: 'Backend Developer' }).isError, undefined);
  // Saved teams: none yet, junk, too many, too long.
  const old = { id: 'old' };
  const junk = { id: 'junk', channel: [null, { id: 1 }, { id: 'a', fromId: 'x', text: 'ok', at: 1 }] };
  const bloated = { id: 'bloated', channel: Array.from({ length: 230 }, (_, i) => ({ id: `${i}`, fromId: 'x', text: i === 229 ? 'z'.repeat(5000) : 'hi', at: i })) };
  const fine = { id: 'fine', channel: [{ id: 'a', fromId: 'x', text: 'ok', at: 1 }] };
  assert.equal(channel.migrateChannels([old, junk, bloated, fine]), true);
  assert.deepEqual(old.channel, []);
  assert.deepEqual(junk.channel.map((p) => p.id), ['a']);
  assert.equal(bloated.channel.length, 200);
  assert.equal(bloated.channel.at(-1).text.length, channel.POST_LIMIT);
  assert.equal(fine.channel.length, 1);
  assert.equal(channel.migrateChannels([old, junk, bloated, fine]), false, 'nothing left to change');
});

test('a colleague asked about a teammate knows all of their tasks, each with its status and the start of its hand-off', () => {
  const t = working();
  t.plan.assignments.push({ id: 't4', ownerId: 'qa-engineer', title: 'Retest', brief: 'b', dependsOn: ['t2'], files: [], status: 'waiting' });
  const context = meeting.teammateContext(t, 'qa-engineer');
  assert.match(context, /You are both on the team for: Add a password reset flow/);
  assert.match(context, /Your task: Checks \(done\)\.\nYour hand-off so far: Checked every flow\./);
  assert.match(context, /Your task: Retest \(waiting\)\./);
  const handOff = context.split('Your hand-off so far: ')[1].split('\n')[0];
  assert.equal(handOff.length, 1500);
  assert.equal(meeting.teammateContext(t, 'designer'), '');
  assert.equal(channel.workingTask(t, 'backend-developer').id, 't1');
  assert.equal(channel.workingTask(t, 'qa-engineer'), undefined, 'done or waiting is not working');
});

test('the lead sees the latest team chat in their next turn while the team is not finished', () => {
  const t = working();
  assert.doesNotMatch(meeting.teamsBlock([t]), /Team chat/);
  sendFrom(t, 'c-api', { text: 'Which hash do you want?', to: 'Chief of Staff' });
  sendFrom(t, 'c-api', { text: 'API is on 4000.' });
  const block = meeting.teamsBlock([t]);
  assert.match(block, /Team chat \(latest 2 of 2\):\n- Backend Developer to you: Which hash do you want\?\n- Backend Developer to everyone: API is on 4000\./);
  assert.doesNotMatch(meeting.teamsBlock([{ ...t, status: 'done' }]), /Team chat/);
});

test('message_team is an ordinary tool with one required field, offered only inside a team, and never dropped for a long tool list', () => {
  assert.equal(tools.MESSAGE_TEAM.name, 'message_team');
  assert.deepEqual(tools.MESSAGE_TEAM.parameters.required, ['text']);
  assert.ok(tools.MESSAGE_TEAM.parameters.properties.to);
  assert.equal(tools.TEAM_TOOL_NAMES.has('message_team'), false, 'not one of the lead-only tools');
  const { toolsFor } = require('../src/main/officeTools.ts');
  const names = (input) => toolsFor({ registry: [], hasFolder: false, ...input }).map((x) => x.name);
  assert.ok(names({ agentId: 'backend-developer', teamChat: true }).includes('message_team'));
  assert.ok(!names({ agentId: 'backend-developer' }).includes('message_team'), 'not for a run outside a team');
  assert.ok(names({ agentId: 'chief-of-staff', teamChat: true }).includes('message_team'));
  assert.ok(!names({ agentId: 'chief-of-staff' }).includes('message_team'));
  // Past twenty tools only the best matches are offered, but this one is always among them.
  const { selectTools } = require('../src/main/context.ts');
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, description: 'x', parameters: { type: 'object', properties: {} } }));
  assert.ok(selectTools([...many, tools.MESSAGE_TEAM], 'unrelated words').some((x) => x.name === 'message_team'));
});
