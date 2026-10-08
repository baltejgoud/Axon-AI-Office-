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
function teamModel(t, plan = PLAN) {
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
      return { toolCalls: [{ id: 'call1', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'Add password reset', attendees: ['Backend Developer', 'Frontend Developer'] }) }] };
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
  // The owner's run hangs until stopped.
  mockModel(t, async (_n, req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('Generation stopped.')))));
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
