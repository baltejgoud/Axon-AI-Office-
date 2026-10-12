// Teams through the service, as the user lives them: the Chief of Staff calls a meeting, the plan
// waits, Start runs each task in its owner's own conversation, and the lead reports back.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
const electron = { app: { isPackaged: false, relaunch() {}, quit() {} }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');
const providers = require('../src/main/providers.ts');

async function setup(t) {
  const events = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-team-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, (event) => events.push(event), 'parser-worker-path');
  t.after(async () => {
    // Stop whatever a failed test left running, so waiting for it ends.
    service.stopAll();
    for (const team of repo.state.teams) await service.teams.idle(team.id);
    service.shutdown();
    await repo.store.flushAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  repo.state.providers.push({
    id: 'p1', name: 'MockProvider', kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true, createdAt: 0, hasApiKey: false
  });
  // Two transport fixtures wait at explicit gates while the lead makes a third call.
  repo.state.settings.providerConcurrency = { p1: 3 };
  return { service, repo, events };
}

function mockModel(t, respond) {
  const saved = providers.streamChat;
  t.after(() => { providers.streamChat = saved; });
  let n = 0;
  providers.streamChat = async (_p, _k, req, onChunk) => respond(++n, req, onChunk);
}

async function waitFor(find, what) {
  for (let i = 0; i < 1500; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const lead = (service, id = 'chief-of-staff') =>
  service.chatCreate('p1', 'm1', null, id, { skillIds: [], roleIds: [] }, null, `You are Axon's ${id}.`);

test('Chief of Staff greeting with an existing ChatGPT catalog reaches inference and has a healthy meter', async (t) => {
  const { service, repo } = await setup(t);
  repo.state.providers[0] = { ...repo.state.providers[0], id: 'chatgpt-plan', auth: 'chatgpt', kind: 'openai-responses', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' }] };
  service.chatgpt.accessToken = async () => 'mock-plan-token';
  repo.state.settings.autoTitleConversations = false;
  const chief = require('../src/shared/coworkers.ts').COWORKERS.find(c => c.id === 'chief-of-staff');
  const chat = await service.chatCreate('chatgpt-plan', 'gpt-6.1-sol', null, chief.id, { skillIds: [], roleIds: [] }, null, chief.systemPrompt);
  let called = false;
  mockModel(t, async (_n, req, onChunk) => {
    called = true;
    assert.equal(req.messages.at(-1).content, 'hi');
    assert.ok(req.system.includes('Chief of Staff'));
    onChunk('Hi! What can I help with?');
    return { toolCalls: [], promptTokens: 2000, completionTokens: 10 };
  });
  await service.chatSend(chat.id, 'hi', []);
  await waitFor(() => repo.conversationMessages(chat.id).some(m => m.role === 'assistant' && !m.streaming), 'greeting to finish');
  assert.ok(called);
  const messages = repo.conversationMessages(chat.id);
  assert.ok(messages.some(m => m.role === 'assistant' && m.content.includes('Hi!')));
  assert.ok(!messages.some(m => m.error));
  const meter = await service.getContextUsage(chat.id);
  assert.equal(meter.tokenBasis.windowTokens, 1050000);
  assert.ok(meter.pct < 1);
  assert.notEqual(meter.state, 'recovery-required');
});

const PLAN = { summary: 'API then form', assignments: [
  { id: 't1', owner: 'Backend Developer', title: 'API', brief: 'Build the API', files: ['src/api.ts'] },
  { id: 't2', owner: 'Frontend Developer', title: 'Form', brief: 'Build the form', depends_on: ['t1'], files: ['src/form.tsx'] }] };

/** The model, by what it is asked: the lead, an attendee, the plan, an owner, or the report. */
function teamModel(t, plan = PLAN, attendees = ['Backend Developer', 'Frontend Developer']) {
  const asked = [];
  mockModel(t, async (n, req, onChunk) => {
    const system = req.system ?? '';
    const last = req.messages.at(-1);
    asked.push({ system, last: last?.content, tools: req.tools?.map((x) => x.name) ?? [] });
    if (system.includes('Review whether the assigned business task')) { onChunk('{"complete":true,"blockers":[]}'); return { toolCalls: [] }; }
    if (req.tools?.some((x) => x.name === 'propose_plan'))
      return { toolCalls: [{ id: `plan${n}`, name: 'propose_plan', arguments: JSON.stringify(plan) }] };
    if (system.includes('has called a team meeting')) { onChunk('My input.'); return { toolCalls: [] }; }
    if (system.includes('Your team has finished')) { onChunk('Report: done.'); return { toolCalls: [] }; }
    if (typeof last?.content === 'string' && last.content.startsWith('Team goal:')) {
      onChunk(`Done: ${last.content.match(/Your task \((t\d)\)/)[1]}`);
      return { toolCalls: [] };
    }
    if (req.tools?.some((x) => x.name === 'call_team_meeting') && last?.role === 'user' && /password reset/.test(last.content))
      return { toolCalls: [{ id: 'call1', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'Add password reset', attendees }) }] };
    onChunk('I gathered the team.');
    return { toolCalls: [] };
  });
  return asked;
}

test('the Chief of Staff calls a meeting; the plan waits; Start runs the tasks in order; the report comes back', async (t) => {
  const { service, repo, events } = await setup(t);
  const chat = await lead(service);
  const asked = teamModel(t);
  await service.chatSend(chat.id, 'Add a password reset flow', []);
  const team = await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  assert.deepEqual(team.attendees, ['backend-developer', 'frontend-developer']);
  assert.equal(team.conversationId, chat.id);
  assert.equal(team.minutes.length, 2);
  assert.ok(events.some((e) => e.channel === 'teams'), 'the window hears about the team');
  assert.ok(asked.some((a) => a.tools.includes('find_people') && a.tools.includes('call_team_meeting')), 'the lead has the team tools');
  const result = JSON.parse(repo.state.messages.find((m) => m.role === 'tool' && m.conversationId === chat.id).content);
  assert.equal(result.team, team.id);
  assert.equal(team.room, 'room-1', 'three people meet in a six-seater');
  assert.equal(result.room, 'Room 1');
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, form] = team.plan.assignments;
  assert.equal(api.result, 'Done: t1');
  assert.equal(form.result, 'Done: t2');
  const formBrief = repo.state.messages.find((m) => m.conversationId === form.conversationId && m.role === 'user');
  assert.match(formBrief.content, /Done: t1/, 'the form task got the API hand-off');
  assert.equal(formBrief.from, 'Chief of Staff');
  const formChat = repo.state.conversations.find((c) => c.id === form.conversationId);
  assert.equal(formChat.agentId, 'frontend-developer');
  assert.equal(formChat.title, 'Form');
  assert.equal(team.report, 'Report: done.');
});

test('company context and documents reach meeting attendees and task owners and survive storage', async (t) => {
  const { service, repo } = await setup(t);
  repo.state.documents.push({ id: 'sanket-doc', name: 'Sanket report', kind: 'pdf', size: 10, chunkCount: 1, createdAt: 1, workspaceIds: [] });
  repo.state.chunks.push({ id: 'chunk', docId: 'sanket-doc', docName: 'Sanket report', index: 0, text: 'Sanket password reset requirements: account recovery needs a token.', tokens: 20 });
  await service.workspaceSave({ id: 'sanket', company: true, name: 'Sanket', description: 'Supply chain optimization', systemPrompt: 'Company operating rules', instructions: 'Do not invent customer results.', defaultProviderId: 'p1', defaultModelId: 'm1', knowledgeDocIds: ['sanket-doc'], enabledTools: [], skillIds: [], roleIds: [], fileAccess: { enabled: false, roots: [] }, createdAt: 1, updatedAt: 1 });
  const chat = await service.chatCreate('p1', 'm1', 'sanket', 'chief-of-staff', { skillIds: [], roleIds: [] }, null, 'You are the Chief of Staff.');
  const asked = teamModel(t);
  await service.chatSend(chat.id, 'Add password reset', []);
  const team = await waitFor(() => repo.state.teams.find(t => t.status === 'planned'), 'company plan');
  assert.match(team.context, /Company operating rules/);
  assert.match(team.context, /Sanket report/);
  assert.ok(asked.filter(a => a.system.includes('has called a team meeting')).every(a => a.system.includes('Do not invent customer results.')));
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'company report');
  for (const assignment of team.plan.assignments) assert.equal(repo.state.conversations.find(c => c.id === assignment.conversationId).workspaceId, 'sanket');
  assert.equal(asked.filter(a => a.system.includes('Review whether the assigned business task')).length, 2);
  await repo.save();
  assert.equal(repo.state.workspaces.find(w => w.id === 'sanket').company, true);
});

test('a coworker who is not a lead has no team tools; vague attendees start nothing', async (t) => {
  const { service, repo } = await setup(t);
  const asked = teamModel(t);
  const dev = await service.chatCreate('p1', 'm1', null, 'backend-developer', { skillIds: [], roleIds: [] }, null, 'You are a dev.');
  await service.chatSend(dev.id, 'Hi', []);
  assert.ok(!asked.at(-1).tools.includes('call_team_meeting'));
  assert.ok(!asked.at(-1).tools.includes('message_team'), 'nor a way to message a team they are not on');
  const chat = await lead(service);
  mockModel(t, async (n) => (n === 1
    ? { toolCalls: [{ id: 'c', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'g', attendees: ['engineer', 'Backend Developer'] }) }] }
    : { toolCalls: [] }));
  await service.chatSend(chat.id, 'Do it', []);
  assert.equal(repo.state.teams.length, 0);
  assert.match(repo.state.messages.find((m) => m.role === 'tool' && m.conversationId === chat.id).content, /engineer/);
});

const MARKETING = ['Marketing Strategist', 'Sales Operations Manager', 'Territory Manager', 'Digital Marketing Manager', 'Growth Marketing Manager', 'Content Marketing Manager'];

test('a long brief still gathers the whole team, and the call is answered', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service);
  // The real call that failed: six people and a 5,393-character brief.
  const goal = 'Plan the Q4 regional launch. '.repeat(186);
  mockModel(t, async (n, _req, onChunk) => {
    if (n === 1) return { toolCalls: [{ id: 'big', name: 'call_team_meeting', arguments: JSON.stringify({ goal, attendees: MARKETING }) }] };
    onChunk('ok');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Gather marketing', []);
  const answer = repo.state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'big');
  assert.ok(answer, 'the call has a result');
  assert.equal(JSON.parse(answer.content).attendees.length, 6);
  assert.equal(repo.state.teams.length, 1);
  assert.equal(repo.state.teams[0].goal, goal.trim());
  const replies = repo.state.messages.filter((m) => m.role === 'assistant' && m.conversationId === chat.id);
  assert.equal(replies.find((m) => m.error)?.error, undefined, 'the turn did not fail');
});

test('a brief past the limit goes back to the lead to shorten; the turn carries on', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service);
  const { GOAL_LIMIT } = require('../src/main/team/tools.ts');
  let after = '';
  mockModel(t, async (n, req, onChunk) => {
    if (n === 1) return { toolCalls: [{ id: 'huge', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'x'.repeat(GOAL_LIMIT + 1), attendees: MARKETING }) }] };
    after = req.messages.at(-1).content;
    onChunk('I will shorten it.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Gather marketing', []);
  assert.equal(repo.state.teams.length, 0);
  const answer = repo.state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'huge');
  assert.ok(answer?.error, 'the call is answered as an error');
  assert.match(after, /12,000 characters/, 'the lead is told the limit');
  const replies = repo.state.messages.filter((m) => m.role === 'assistant' && m.conversationId === chat.id);
  assert.equal(replies.at(-1).content, 'I will shorten it.');
  assert.equal(replies.find((m) => m.error)?.error, undefined, 'the turn did not fail');
});

test('find_people answers a lead with who fits', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service, 'ops-coordinator');
  mockModel(t, async (n) => (n === 1 ? { toolCalls: [{ id: 'f', name: 'find_people', arguments: JSON.stringify({ need: 'security' }) }] } : { toolCalls: [] }));
  await service.chatSend(chat.id, 'Who knows security?', []);
  assert.match(repo.state.messages.find((m) => m.role === 'tool' && m.conversationId === chat.id).content, /Security/);
});

test('Stop team stops an owner mid-run', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service);
  teamModel(t, { summary: 's', assignments: [PLAN.assignments[0]] });
  await service.chatSend(chat.id, 'Add a password reset flow', []);
  const team = await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  // The owner's run hangs until stopped (or ends at once if it was stopped before the call went out).
  mockModel(t, async (_n, req) => new Promise((_, reject) => {
    if (req.signal.aborted) return reject(new Error('Generation stopped.'));
    req.signal.addEventListener('abort', () => reject(new Error('Generation stopped.')));
  }));
  await service.teamStart(team.id);
  const task = team.plan.assignments[0];
  await waitFor(() => task.conversationId && service.runs.has(task.conversationId), 'the owner to start');
  await service.teamStop(team.id);
  await waitFor(() => task.status === 'stopped', 'the owner to stop');
  assert.equal(team.status, 'stopped');
  assert.equal(service.runs.has(task.conversationId), false);
});

test('a lead remembers their teams in their next turn', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service);
  const asked = teamModel(t);
  await service.chatSend(chat.id, 'Add a password reset flow', []);
  await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  await service.chatSend(chat.id, 'How is it going?', []);
  assert.match(asked.at(-1).system, /## Your teams[\s\S]*Add password reset — planned/);
});

test('a teammate asked by another owner knows their own part', async (t) => {
  const { service, repo } = await setup(t);
  const chat = await lead(service);
  teamModel(t);
  await service.chatSend(chat.id, 'Add a password reset flow', []);
  const team = await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  // The form's owner asks the API's owner; the API owner's consult sees their task.
  const consults = [];
  mockModel(t, async (_n, req, onChunk) => {
    const last = req.messages.at(-1);
    if ((req.system ?? '').includes('is asking you a question')) { consults.push(last.content); onChunk('Use POST /reset.'); return { toolCalls: [] }; }
    if (typeof last?.content === 'string' && last.content.includes('Your task (t2)'))
      return { toolCalls: [{ id: 'ask', name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'Which endpoint?' }) }] };
    onChunk('ok');
    return { toolCalls: [] };
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  assert.match(consults[0], /You are both on the team for: Add password reset[\s\S]*Your task: API/);
  assert.match(consults[0], /Which endpoint\?/);
  const answer = JSON.parse(repo.state.messages.find((m) => m.role === 'tool' && m.toolCallId === 'ask').content);
  assert.equal(answer.answer, 'Use POST /reset.');
  assert.equal(answer.note, undefined, 'the API owner has finished, so there is no one working to message');
});

test('a team open when Axon closed loads as stopped', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-team-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const first = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  first.state.teams.push({ id: 'x', leadId: 'chief-of-staff', conversationId: 'c', goal: 'g', attendees: [], providerId: 'p1', modelId: 'm1', status: 'working', minutes: [], createdAt: 0, updatedAt: 0 });
  await first.save();
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const service = new Service(repo, { has: () => false, get: () => null, set() {}, remove() {} }, dir, () => {}, 'parser-worker-path');
  assert.equal(repo.state.teams[0].status, 'stopped');
  service.shutdown();
  await repo.store.flushAll();
});

test('a team saved before the chat existed loads with an empty one', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-team-chat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const first = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  first.state.teams.push({ id: 'old', leadId: 'chief-of-staff', conversationId: 'c', goal: 'g', attendees: [], providerId: 'p1', modelId: 'm1', status: 'done', minutes: [], createdAt: 0, updatedAt: 0 });
  first.state.teams.push({ id: 'new', leadId: 'chief-of-staff', conversationId: 'c', goal: 'g', attendees: [], providerId: 'p1', modelId: 'm1', status: 'done', minutes: [], channel: [{ id: 'p', fromId: 'backend-developer', text: 'hello', at: 1 }], createdAt: 0, updatedAt: 0 });
  await first.save();
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  assert.deepEqual(repo.state.teams.find((x) => x.id === 'old').channel, []);
  assert.deepEqual(repo.state.teams.find((x) => x.id === 'new').channel.map((p) => p.text), ['hello']);
  await repo.store.flushAll();
});

// ---- Teammates talking to each other while they work ----

/** Two owners who can work at the same time: nothing waits for anything. */
const PARALLEL = { summary: 'API and form side by side', assignments: [
  { id: 't1', owner: 'Backend Developer', title: 'API', brief: 'Build the API', files: ['src/api.ts'] },
  { id: 't2', owner: 'Frontend Developer', title: 'Form', brief: 'Build the form', files: ['src/form.tsx'] }] };

const gate = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };
/** Waits for a gate; ends at once when the run is stopped, and also when it was stopped already. */
const until = (promise, signal) => new Promise((resolve, reject) => {
  const stopped = () => reject(new Error('Generation stopped.'));
  if (signal?.aborted) return stopped();
  signal?.addEventListener('abort', stopped, { once: true });
  promise.then(resolve, reject);
});
const say = (id, to, text) => ({ toolCalls: [{ id, name: 'message_team', arguments: JSON.stringify(to ? { to, text } : { text }) }] });
const busy = (id) => ({ toolCalls: [{ id, name: 'no_such_tool', arguments: '{}' }] });
const finish = (onChunk, text) => { onChunk(text); return { toolCalls: [] }; };
const taskOf = (req) => req.messages.find((m) => typeof m.content === 'string' && m.content.startsWith('Team goal:'))?.content.match(/Your task \((t\d)\)/)?.[1];
const stored = (repo, conversationId) => repo.state.messages.filter((m) => m.conversationId === conversationId);
const toolAnswer = (repo, conversationId, callId) => stored(repo, conversationId).find((m) => m.role === 'tool' && m.toolCallId === callId);
const briefOf = (repo, conversationId) => stored(repo, conversationId).find((m) => m.role === 'user');

/** A team with its plan waiting for you. */
async function planned(t, plan = PLAN, attendees) {
  const ctx = await setup(t);
  const chat = await lead(ctx.service);
  const asked = teamModel(t, plan, attendees);
  await ctx.service.chatSend(chat.id, 'Add a password reset flow', []);
  const team = await waitFor(() => ctx.repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  return { ...ctx, chat, team, asked };
}

/**
 * The model once the work starts: each owner scripted by their task id (`script.t1(step, req, onChunk)`),
 * the report fixed, anything else (the lead, a consult) by `script.other`. Returns what each owner was asked.
 */
function owners(t, script) {
  const seen = [];
  const steps = {};
  mockModel(t, async (_n, req, onChunk) => {
    if ((req.system ?? '').includes('Your team has finished')) return finish(onChunk, 'Report: done.');
    const task = taskOf(req);
    if (!task) return script.other ? script.other(req, onChunk) : finish(onChunk, 'ok');
    const step = (steps[task] = (steps[task] ?? 0) + 1);
    seen.push({ task, step, tools: req.tools?.map((x) => x.name) ?? [] });
    return script[task](step, req, onChunk);
  });
  return seen;
}

test('a teammate who is working reads a message at their next step, shown as from the sender; the sender is told who has it', async (t) => {
  const { service, repo, team } = await planned(t, PARALLEL);
  const formRunning = gate();
  const sent = gate();
  let formReads;
  const seen = owners(t, {
    t1: async (step, req, onChunk) => {
      if (step === 1) { await until(formRunning.promise, req.signal); return say('m1', 'Frontend Developer', 'POST /reset takes an email.'); }
      sent.open();
      return finish(onChunk, 'Done: API');
    },
    t2: async (step, req, onChunk) => {
      if (step === 1) { formRunning.open(); await until(sent.promise, req.signal); return busy('b1'); }
      formReads = req.messages.at(-1).content;
      return finish(onChunk, 'Done: Form');
    }
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, form] = team.plan.assignments;
  assert.equal(formReads, 'Message from Backend Developer on your team: POST /reset takes an email.\n\nReply with message_team if they need an answer.');
  // Shown and saved as from the sender, not from "You".
  const mail = stored(repo, form.conversationId).find((m) => m.role === 'user' && m.content.startsWith('Message from'));
  assert.equal(mail.from, 'Backend Developer');
  assert.match(toolAnswer(repo, api.conversationId, 'm1').content, /^Sent to Frontend Developer: Frontend Developer is working and will read it at their next step\./);
  assert.ok(seen.filter((s) => s.step === 1).every((s) => s.tools.includes('message_team')), 'every owner is offered the tool');
  assert.deepEqual(team.channel.map((p) => [p.fromId, p.toId, p.taskId, p.text]), [['backend-developer', 'frontend-developer', 't1', 'POST /reset takes an email.']]);
  // On the bus, on a run of this team, so the Communication tab lists it.
  const record = repo.state.agentMessages.find((m) => m.purpose === 'Team chat');
  assert.deepEqual([record.type, record.fromAgentId, record.toAgentId, record.content, record.taskId], ['status', 'backend-developer', 'frontend-developer', 'POST /reset takes an email.', 't1']);
  assert.ok(repo.state.runs.some((r) => r.runId === record.runId && r.teamId === team.id));
});

test('a message to the whole team reaches those working, waits in the brief for those not started, and an idle lead is not started', async (t) => {
  const plan = { summary: 'three', assignments: [...PARALLEL.assignments, { id: 't3', owner: 'QA Engineer', title: 'Checks', brief: 'Check it', depends_on: ['t2'] }] };
  const { service, repo, team, chat } = await planned(t, plan, ['Backend Developer', 'Frontend Developer', 'QA Engineer']);
  const leadAnswers = () => stored(repo, chat.id).filter((m) => m.role === 'assistant').length;
  const leadBefore = leadAnswers();
  const formRunning = gate();
  const sent = gate();
  let formReads;
  owners(t, {
    t1: async (step, req, onChunk) => {
      if (step === 1) { await until(formRunning.promise, req.signal); return say('m1', undefined, 'The API is on port 4000.'); }
      sent.open();
      return finish(onChunk, 'Done: API');
    },
    t2: async (step, req, onChunk) => {
      if (step === 1) { formRunning.open(); await until(sent.promise, req.signal); return busy('b1'); }
      formReads = req.messages.at(-1).content;
      return finish(onChunk, 'Done: Form');
    },
    t3: (_step, _req, onChunk) => finish(onChunk, 'Done: Checks')
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, , qa] = team.plan.assignments;
  assert.match(formReads, /^Message from Backend Developer on your team \(to everyone\): The API is on port 4000\./);
  assert.match(toolAnswer(repo, api.conversationId, 'm1').content, /^Sent to the team: Frontend Developer is working and will read it at their next step; QA Engineer will find it in their brief when they start; Chief of Staff will see it on their next turn\./);
  assert.match(briefOf(repo, qa.conversationId).content, /Notes from your team[^\n]*:\n- Backend Developer to everyone: The API is on port 4000\./);
  assert.equal(team.channel[0].toId, undefined);
  // The lead was between conversations: nothing was started for them.
  assert.equal(service.runs.has(chat.id), false);
  assert.equal(leadAnswers(), leadBefore);
});

test('a message that reaches an owner as their run ends is read in a follow-up the task waits for, never in an untracked run', async (t) => {
  const { service, repo, team } = await planned(t, PARALLEL);
  const formRunning = gate();
  const sent = gate();
  const followUps = [];
  owners(t, {
    t1: async (step, req, onChunk) => {
      if (step === 1) { await until(formRunning.promise, req.signal); return say('m1', 'Frontend Developer', 'Use POST /reset instead of /forgot.'); }
      sent.open();
      return finish(onChunk, 'Done: API');
    },
    t2: async (step, req, onChunk) => {
      if (step === 1) { formRunning.open(); await until(sent.promise, req.signal); return finish(onChunk, 'Done: first pass'); }
      followUps.push(req.messages.at(-1).content);
      return finish(onChunk, 'Done: after the change');
    }
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const form = team.plan.assignments[1];
  assert.equal(form.result, 'Done: after the change', 'the hand-off is the answer after reading it');
  assert.equal(followUps.length, 1);
  assert.match(followUps[0], /^These messages reached you as you were finishing:\n\nMessage from Backend Developer on your team: Use POST \/reset instead of \/forgot\./);
  assert.match(followUps[0], /end again with your complete hand-off/);
  assert.equal(stored(repo, form.conversationId).find((m) => m.content.startsWith('These messages')).from, 'Backend Developer');
  const runs = repo.state.runs.filter((r) => r.conversationId === form.conversationId);
  assert.equal(runs.length, 2, 'the first run and the follow-up');
  assert.ok(runs.every((r) => r.teamId === team.id && r.taskId === 't2'), 'both belong to the task');
  assert.equal(service.queued.has(form.conversationId), false);
  assert.equal(service.taskPhase.size, 0, 'nothing is left marked as running');
});

test('a message to a teammate who has not started is in their brief when they do', async (t) => {
  const { service, repo, team } = await planned(t);
  owners(t, {
    t1: (step, _req, onChunk) => (step === 1 ? say('m1', 'Frontend Developer', 'POST /reset takes an email.') : finish(onChunk, 'Done: API')),
    t2: (_step, _req, onChunk) => finish(onChunk, 'Done: Form')
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, form] = team.plan.assignments;
  assert.match(toolAnswer(repo, api.conversationId, 'm1').content, /Frontend Developer will find it in their brief when they start/);
  const brief = briefOf(repo, form.conversationId).content;
  assert.match(brief, /Notes from your team[^\n]*:\n- Backend Developer to you: POST \/reset takes an email\./);
  assert.match(brief, /Done: API/, 'along with the hand-off it builds on');
});

test('a message to a finished teammate is not sent and shows their hand-off; an unknown teammate is an error naming the real ones', async (t) => {
  const { service, repo, team } = await planned(t, PARALLEL);
  owners(t, {
    t1: (_step, _req, onChunk) => finish(onChunk, 'Done: API'),
    t2: async (step, req, onChunk) => {
      if (step === 1) { await until(waitFor(() => team.plan.assignments[0].status === 'done', 'the API to be done'), req.signal); return say('d1', 'Backend Developer', 'Can you add rate limiting?'); }
      if (step === 2) return say('u1', 'Plumber', 'Hello');
      return finish(onChunk, 'Done: Form');
    }
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const form = team.plan.assignments[1];
  const finished = toolAnswer(repo, form.conversationId, 'd1');
  assert.equal(finished.error, undefined, 'not a mistake, just too late');
  assert.match(finished.content, /Backend Developer has already finished "API", so they will not read this\. Their hand-off: Done: API/);
  const unknown = toolAnswer(repo, form.conversationId, 'u1');
  assert.match(unknown.error, /Nobody on this team is called "Plumber"[\s\S]*Chief of Staff \(the lead\)[\s\S]*Backend Developer \(API\)/);
  assert.equal(team.channel.length, 0, 'nothing refused or too late is kept');
});

test('the lead can message an owner who is working, as themselves; they are offered the tool only once the team works', async (t) => {
  const { service, repo, team, chat, asked } = await planned(t, PARALLEL);
  assert.ok(asked.every((a) => !a.tools.includes('message_team')), 'not while the team is only meeting');
  const apiRunning = gate();
  const told = gate();
  let apiReads;
  let leadTools;
  owners(t, {
    t1: async (step, req, onChunk) => {
      if (step === 1) { apiRunning.open(); await until(told.promise, req.signal); return busy('b1'); }
      apiReads = req.messages.at(-1).content;
      return finish(onChunk, 'Done: API');
    },
    t2: async (_step, req, onChunk) => { await until(told.promise, req.signal); return finish(onChunk, 'Done: Form'); },
    other: (req, onChunk) => {
      const last = req.messages.at(-1);
      if (last.role === 'user' && last.content === 'Tell the backend dev to use JWT') {
        leadTools = req.tools.map((x) => x.name);
        return say('l1', 'Backend Developer', 'Use JWT for the reset token.');
      }
      return finish(onChunk, 'Told them.');
    }
  });
  await service.teamStart(team.id);
  await until(apiRunning.promise);
  await service.chatSend(chat.id, 'Tell the backend dev to use JWT', []);
  told.open();
  await waitFor(() => team.status === 'done', 'the team to finish');
  assert.ok(leadTools.includes('message_team'));
  assert.equal(apiReads, 'Message from Chief of Staff on your team: Use JWT for the reset token.\n\nReply with message_team if they need an answer.');
  const api = team.plan.assignments[0];
  assert.equal(stored(repo, api.conversationId).find((m) => m.content.startsWith('Message from')).from, 'Chief of Staff');
  assert.match(toolAnswer(repo, chat.id, 'l1').content, /^Sent to Backend Developer: Backend Developer is working/);
  assert.deepEqual(team.channel.map((p) => [p.fromId, p.toId]), [['chief-of-staff', 'backend-developer']]);
});

test('a message to an idle lead starts nothing; they see it in the team chat on their next turn', async (t) => {
  const { service, repo, team, chat } = await planned(t, PARALLEL);
  const release = gate();
  let leadSystem = '';
  owners(t, {
    t1: async (step, req, onChunk) => {
      if (step === 1) return say('m1', 'Chief of Staff', 'Which hash do you want?');
      await until(release.promise, req.signal);
      return finish(onChunk, 'Done: API');
    },
    t2: async (_step, req, onChunk) => { await until(release.promise, req.signal); return finish(onChunk, 'Done: Form'); },
    other: (req, onChunk) => { leadSystem = req.system ?? ''; return finish(onChunk, 'Going well.'); }
  });
  const assistantsBefore = stored(repo, chat.id).filter((m) => m.role === 'assistant').length;
  await service.teamStart(team.id);
  const api = team.plan.assignments[0];
  const answer = await waitFor(() => api.conversationId && toolAnswer(repo, api.conversationId, 'm1'), 'the message to be sent');
  assert.match(answer.content, /Chief of Staff will see it on their next turn/);
  assert.equal(service.runs.has(chat.id), false, 'no run was started for the lead');
  assert.equal(stored(repo, chat.id).filter((m) => m.role === 'assistant').length, assistantsBefore);
  await service.chatSend(chat.id, 'How is it going?', []);
  assert.match(leadSystem, /Team chat \(latest 1 of 1\):\n- Backend Developer to you: Which hash do you want\?/);
  release.open();
  await waitFor(() => team.status === 'done', 'the team to finish');
});

test('a colleague asked about a teammate who is working is told that message_team reaches the person actually doing it', async (t) => {
  const { service, repo, team } = await planned(t, PARALLEL);
  const answered = gate();
  owners(t, {
    t1: async (_step, req, onChunk) => { await until(answered.promise, req.signal); return finish(onChunk, 'Done: API'); },
    t2: (step, _req, onChunk) => {
      if (step === 1) return { toolCalls: [{ id: 'ask', name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'Which endpoint?' }) }] };
      answered.open();
      return finish(onChunk, 'Done: Form');
    },
    other: (req, onChunk) => ((req.system ?? '').includes('is asking you a question') ? finish(onChunk, 'Use POST /reset.') : finish(onChunk, 'ok'))
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const form = team.plan.assignments[1];
  const result = JSON.parse(toolAnswer(repo, form.conversationId, 'ask').content);
  assert.match(result.answer, /Sent to Backend Developer/);
  assert.match(result.note, /Sent to the teammate doing this task/);
  assert.equal(team.channel[0].text, 'Which endpoint?');
});

test('a long hand-off reaches the next task whole: 12,000 characters kept, 8,000 in the report its brief carries', async (t) => {
  const { service, repo, team } = await planned(t);
  owners(t, {
    t1: (_step, _req, onChunk) => finish(onChunk, 'x'.repeat(13000)),
    t2: (_step, _req, onChunk) => finish(onChunk, 'ok')
  });
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, form] = team.plan.assignments;
  assert.equal(api.result.length, 12000);
  assert.equal(api.completionReport.summary.length, 8000);
  const brief = briefOf(repo, form.conversationId).content;
  assert.ok(brief.includes('x'.repeat(8000)), 'not cut at 2,000');
  assert.ok(!brief.includes('x'.repeat(8001)));
});

test('message_team outside a team is refused plainly, and starts nothing', async (t) => {
  const { service, repo } = await setup(t);
  const dev = await service.chatCreate('p1', 'm1', null, 'backend-developer', { skillIds: [], roleIds: [] }, null, 'You are a dev.');
  mockModel(t, async (n, _req, onChunk) => (n === 1 ? say('x1', 'Frontend Developer', 'Hello') : finish(onChunk, 'ok')));
  await service.chatSend(dev.id, 'Say hi to the team', []);
  assert.match(toolAnswer(repo, dev.id, 'x1').error, /not on a team that is working/);
  assert.equal(repo.state.teams.length, 0);
});

test('a named reviewer checks tasks before the lead reports and saves an inspectable conversation',async(t)=>{
  const {service,repo,team}=await planned(t);
  await service.teamReviewer(team.id,'qa-engineer');let checks=0;
  owners(t,{t1:(_s,_r,emit)=>finish(emit,'API done.'),t2:(_s,_r,emit)=>finish(emit,'Form done.'),other:(req,emit)=>{assert.ok(req.system.includes('Review whether the assigned business task'));checks++;return finish(emit,'{"complete":true,"blockers":[]}');}});
  await service.teamStart(team.id);await waitFor(()=>team.status==='done','reviewed team');
  assert.equal(checks,2);assert.equal(team.review.checks.length,2);assert.ok(repo.state.conversations.some(c=>c.id===team.review.conversationId&&c.agentId==='qa-engineer'));
});

test('reviewer rejection invalidates completed dependent work so Retry rebuilds it',async(t)=>{
  const {service,team}=await planned(t);await service.teamReviewer(team.id,'qa-engineer');let checks=0;
  owners(t,{t1:(_s,_r,emit)=>finish(emit,'API done.'),t2:(_s,_r,emit)=>finish(emit,'Form done.'),other:(_req,emit)=>finish(emit,++checks===1?'{"complete":false,"blockers":["Missing test"]}':'{"complete":true,"blockers":[]}')});
  await service.teamStart(team.id);await waitFor(()=>team.status==='failed','review rejected');
  assert.equal(team.plan.assignments[0].status,'failed');assert.equal(team.plan.assignments[1].status,'blocked');assert.equal(team.report,undefined);
});

test('Stop in the reviewer conversation aborts its model and prevents a final report',async(t)=>{
  const {service,team}=await planned(t);await service.teamReviewer(team.id,'qa-engineer');const waiting=gate();let signal;
  owners(t,{t1:(_s,_r,emit)=>finish(emit,'API done.'),t2:(_s,_r,emit)=>finish(emit,'Form done.'),other:async(req)=>{signal=req.signal;waiting.open();await until(new Promise(()=>{}),req.signal);return {toolCalls:[]};}});
  await service.teamStart(team.id);await until(waiting.promise);service.chatStop(team.review.conversationId);
  await waitFor(()=>team.status==='failed','cancelled review');assert.equal(signal.aborted,true);assert.equal(team.report,undefined);
});
