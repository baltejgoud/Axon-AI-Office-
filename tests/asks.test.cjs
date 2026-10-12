// Coworkers asking you a question (ask_user), the plain-English label on each approval, and the rules
// behind Approve all: the shared wording, the permission machinery, and a whole run that waits for you.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron')
    return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
  return original.call(this, name, ...args);
};
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
const ask = require('../src/shared/askUser.ts');
const risk = require('../src/shared/toolRisk.ts');
const audit = require('../src/shared/audit.ts');
const presentation = require('../src/shared/runtimePresentation.ts');
const { toolPresentation } = require('../src/renderer/src/chat/workPresentation.ts');
const { waitingStatus } = require('../src/renderer/src/features/office/waiting.ts');
const { workKind } = require('../src/renderer/src/features/office/workspace/work.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');
const office = require('../src/main/officeTools.ts');
const { selectTools } = require('../src/main/context.ts');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

// ------------------------------------------------------------------------------ the question itself

test('a question is cleaned for the card: trimmed, choices de-duplicated and kept to six', () => {
  const read = ask.readQuestion({ question: '  Which   database?\n', options: [' Postgres ', 'SQLite', 'postgres', '', 7, 'MySQL'] });
  assert.deepEqual(read.question, { text: 'Which database?', options: ['Postgres', 'SQLite', 'MySQL'], allowOther: true });
  const many = ask.readQuestion({ question: 'Pick', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], allow_other: false });
  assert.deepEqual(many.question.options, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(many.question.allowOther, false, 'only the choices, when they said so');
  assert.equal(ask.readQuestion({ question: 'x'.repeat(2000) }).question.text.length, ask.MAX_QUESTION);
  assert.equal(ask.readQuestion({ question: 'Pick', options: ['y'.repeat(300), 'z'] }).question.options[0].length, ask.MAX_OPTION);
});

test('one choice is no choice, and with nothing to pick you can only type', () => {
  const single = ask.readQuestion({ question: 'Sure?', options: ['Yes'], allow_other: false }).question;
  assert.deepEqual(single.options, []);
  assert.equal(single.allowOther, true, 'a card with no buttons and no box would be a dead end');
  assert.equal(ask.readQuestion({ question: 'Name it?' }).question.allowOther, true);
  assert.equal(ask.readQuestion({ question: 'Pick', options: ['a', 'b'], allow_other: 'no' }).question.allowOther, true, 'only false turns it off');
});

test('a call with no question is sent back to the coworker to fix', () => {
  for (const args of [{}, { question: '' }, { question: '   ' }, { question: 5 }])
    assert.match(ask.readQuestion(args).error, /question/);
});

test('what the coworker is told you said, and how the thread reads it back', () => {
  const question = ask.readQuestion({ question: 'Which?', options: ['One', 'Two'] }).question;
  assert.equal(ask.answerResult(question, 'Two'), 'The user chose: Two');
  assert.equal(ask.answerResult(question, '  my own idea '), 'The user answered: my own idea');
  assert.match(ask.answerResult(question, ''), /chose not to answer.*Decide for yourself/);
  assert.match(ask.answerResult(question, undefined), /chose not to answer/);
  assert.deepEqual(ask.answerFromResult('The user chose: Two'), { answer: 'Two', skipped: false });
  assert.deepEqual(ask.answerFromResult('The user answered: my own idea'), { answer: 'my own idea', skipped: false });
  assert.deepEqual(ask.answerFromResult(ask.answerResult(question, '')), { skipped: true });
  assert.deepEqual(ask.answerFromResult(undefined), { skipped: false }, 'still waiting');
  assert.equal(ask.cleanAnswer('x'.repeat(5000)).length, ask.MAX_ANSWER);
  assert.equal(ask.cleanAnswer(12), '');
});

// ------------------------------------------------------------------------------ how it is shown

test('the call reads "Asked you: ..." in the thread, the log and the run stage', () => {
  const call = { id: 'q1', name: 'ask_user', arguments: JSON.stringify({ question: 'Which database?' }) };
  assert.deepEqual(toolPresentation(call), { label: 'Asking you: Which database?', target: '', status: 'running' });
  assert.deepEqual(toolPresentation({ ...call, result: 'The user chose: SQLite' }), { label: 'Asked you: Which database?', target: '', status: 'completed' });
  assert.equal(audit.auditSubject('ask_user', { question: 'Which database?', options: ['a', 'b'] }), 'Which database?');
  const entry = { id: '1', at: 0, actor: { kind: 'coworker', name: 'X' }, tool: 'ask_user', subject: 'Which database?', decision: 'allowed', result: 'ok' };
  assert.equal(presentation.activitySentence(entry), 'Asked you: Which database?');
  const run = { status: 'waiting_for_approval', activeTool: 'ask_user' };
  assert.equal(presentation.runStage(run), 'Waiting for your answer');
  assert.equal(presentation.runStage({ status: 'waiting_for_approval', activeTool: 'write_file' }), 'Waiting for your approval');
  assert.equal(workKind('ask_user', {}), null, 'a question is office business, not work on a surface');
});

test('the office shows "reply" for a question and "review" for a step', () => {
  const step = { id: 'a', conversationId: 'c1', toolName: 'write_file' };
  const question = { id: 'b', conversationId: 'c1', toolName: 'ask_user', question: { text: '?', options: [], allowOther: true } };
  assert.equal(waitingStatus([step], 'c1'), 'waiting_for_approval');
  assert.equal(waitingStatus([step, question], 'c1'), 'waiting_for_user');
  assert.equal(waitingStatus([step], 'c2'), undefined);
  assert.equal(waitingStatus([], 'c1'), undefined);
});

// ------------------------------------------------------------------------------ risk labels

test('each step says in plain words what it could do', () => {
  const label = (name, connector) => risk.toolRisk(name, connector).label;
  assert.equal(label('read_file'), 'Reads only');
  assert.equal(label('list_files'), 'Reads only');
  assert.equal(label('search_code'), 'Reads only');
  assert.equal(label('write_file'), 'Changes files');
  assert.equal(label('edit_file'), 'Changes files');
  assert.equal(label('git_commit'), 'Changes files');
  assert.equal(label('update_memory'), 'Changes files');
  assert.equal(label('delete_file'), 'Changes files');
  assert.equal(label('remove_folder'), 'Changes files');
  assert.equal(label('run_command'), 'Runs a command');
  assert.equal(label('start_process'), 'Runs a command');
  assert.equal(label('mcp_notion_create_page', 'Notion'), 'Uses Notion');
  assert.equal(label('mcp_notion_create_page', '  '), 'Uses a connected app');
  assert.equal(label('mcp_notion_create_page'), 'Uses a connected app');
  assert.equal(label('ask_user'), 'Asks you a question');
  assert.equal(label('dispatch_subagent'), 'Starts a helper');
  assert.equal(label('something_new'), 'Takes an action');
  assert.equal(risk.toolRisk('write_file').kind, 'files');
  assert.equal(risk.toolRisk('mcp_x_y', 'X').kind, 'connector');
});

test('the connected app comes from the connectors in the snapshot, and several labels share one line', () => {
  const servers = [
    { name: 'Notion', tools: [{ axonName: 'mcp_notion_search' }, { axonName: 'mcp_notion_create_page' }] },
    { name: 'Linear' }
  ];
  assert.equal(risk.connectorOf('mcp_notion_create_page', servers), 'Notion');
  assert.equal(risk.connectorOf('write_file', servers), null);
  assert.equal(risk.connectorOf('mcp_notion_create_page', undefined), null);
  const risks = ['write_file', 'edit_file', 'run_command'].map((name) => risk.toolRisk(name));
  assert.equal(risk.riskSummary(risks), 'Changes files (2), Runs a command');
  assert.equal(risk.riskSummary([]), '');
});

// ------------------------------------------------------------------------------ the permission machinery

const asking = (manager, question = { text: 'Which?', options: ['One', 'Two'], allowOther: true }) =>
  manager.createApprovalRequest({ conversationId: 'c1', messageId: 'm', toolCallId: 't', toolName: 'ask_user', args: { question: question.text }, question });

test('a question waits like an approval and is answered with words', async () => {
  const manager = new PermissionManager([], false);
  assert.equal(manager.check({ toolName: 'ask_user', args: { question: 'x' } }).action, 'allow', 'asking you needs no OK');
  const { request, outcome } = asking(manager);
  assert.equal(request.question.text, 'Which?');
  assert.ok(request.createdAt > 0, 'it says when it began to wait');
  assert.deepEqual(manager.pending().map((r) => r.id), [request.id], 'it waits in the same list as approvals');
  assert.equal(manager.resolveApproval({ requestId: request.id, approved: true, answer: '  Two  ' }), true);
  assert.equal(await outcome, 'approved');
  assert.equal(manager.takeAnswer(request.id), 'Two');
  assert.equal(manager.takeAnswer(request.id), undefined, 'taken once');
  assert.deepEqual(manager.pending(), []);
});

test('skipping a question, or approving one with nothing said, hands the decision back', async () => {
  const manager = new PermissionManager([], false);
  const skipped = asking(manager);
  manager.resolveApproval({ requestId: skipped.request.id, approved: false });
  assert.equal(await skipped.outcome, 'rejected');
  assert.equal(manager.takeAnswer(skipped.request.id), undefined);
  // An Approve all that reached a question says "approved" with no words: never an answer.
  const blind = asking(manager);
  manager.resolveApproval({ requestId: blind.request.id, approved: true });
  assert.equal(await blind.outcome, 'rejected');
  const blank = asking(manager);
  manager.resolveApproval({ requestId: blank.request.id, approved: true, answer: '   ' });
  assert.equal(await blank.outcome, 'rejected');
  assert.equal(manager.takeAnswer(blank.request.id), undefined);
});

test('a question never makes a grant', async () => {
  const manager = new PermissionManager([], false);
  const { request, outcome } = asking(manager);
  manager.resolveApproval({ requestId: request.id, approved: true, answer: 'One', alwaysAllowSession: true, allowForTask: true });
  assert.equal(await outcome, 'approved', 'not approved-session, not approved-task');
  assert.equal(manager.check({ toolName: 'ask_user', args: {} }).bySession, undefined);
  assert.equal(manager.check({ toolName: 'write_file', args: { path: 'a' }, conversationId: 'c1' }, { roots: ['/p'], allowShell: false }).action, 'ask');
});

test('stopping the run withdraws a question, and a plain approval still carries no answer', async () => {
  const manager = new PermissionManager([], false);
  const waiting = asking(manager);
  manager.withdraw(waiting.request.id);
  assert.equal(await waiting.outcome, 'withdrawn');
  assert.equal(manager.takeAnswer(waiting.request.id), undefined);
  assert.equal(manager.resolveApproval({ requestId: waiting.request.id, approved: true, answer: 'late' }), false, 'a late answer reaches nothing');
  const step = manager.createApprovalRequest({ conversationId: 'c1', messageId: 'm', toolCallId: 't2', toolName: 'write_file', args: { path: 'a' } });
  assert.equal(step.request.question, undefined);
  manager.resolveApproval({ requestId: step.request.id, approved: true, answer: 'ignored' });
  assert.equal(await step.outcome, 'approved');
  assert.equal(manager.takeAnswer(step.request.id), undefined);
});

test('approving every waiting step one by one is the same as approving each on its own', async () => {
  // Approve all is the window deciding each request alone, with no grant: no step is trusted again.
  const manager = new PermissionManager(['/p'], true);
  const steps = ['write_file', 'run_command', 'edit_file'].map((toolName, i) =>
    manager.createApprovalRequest({ conversationId: 'c1', messageId: 'm', toolCallId: `t${i}`, toolName, args: { path: `a${i}` } })
  );
  for (const { request } of steps) manager.resolveApproval({ requestId: request.id, approved: true });
  assert.deepEqual(await Promise.all(steps.map((s) => s.outcome)), ['approved', 'approved', 'approved']);
  const scope = { roots: ['/p'], allowShell: true };
  assert.equal(manager.check({ toolName: 'write_file', args: { path: 'a0' }, conversationId: 'c1' }, scope).action, 'ask', 'asked again next time');
  assert.equal(manager.check({ toolName: 'run_command', args: { command: 'ls' }, conversationId: 'c1' }, scope).action, 'ask');
});

// ------------------------------------------------------------------------------ which runs may ask

test('who is offered the tool', () => {
  const names = (input) => office.toolsFor({ hasFolder: false, registry: [], ...input }).map((tool) => tool.name);
  assert.ok(names({ agentId: 'backend-developer', askUser: true }).includes('ask_user'), 'a coworker');
  assert.ok(names({ agentId: undefined, askUser: true }).includes('ask_user'), 'your own chat');
  assert.ok(names({ agentId: 'receptionist', askUser: true }).includes('ask_user'));
  assert.ok(!names({ agentId: 'backend-developer' }).includes('ask_user'), 'not offered unless the run asks for it');
  assert.ok(!names({ agentId: 'backend-developer', askUser: false }).includes('ask_user'), 'a team member working on their own');
  const tool = ask.ASK_USER_TOOL;
  assert.deepEqual(tool.parameters.required, ['question']);
  assert.deepEqual(Object.keys(tool.parameters.properties), ['question', 'options', 'allow_other']);
});

test('a long tool list still keeps the question tool', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `tool_${i}`, description: 'something' }));
  const picked = selectTools([...many, ask.ASK_USER_TOOL], 'nothing in particular').map((t) => t.name);
  assert.ok(picked.includes('ask_user'));
});

// ------------------------------------------------------------------------------ a whole run

const makeService = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-asks-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const events = [];
  const service = new Service(repo, vault, dir, (event) => events.push(event), 'parser-worker-path');
  t.after(async () => {
    service.shutdown();
    for (let i = 0; i < 20 && (i === 0 || repo.store.pending.size); i++) {
      await repo.store.flushAll();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { repo, service, events };
};

/** A coworker in a project folder, with a model that asks a question first and then finishes. */
async function askingCoworker(t, args, options = {}) {
  const { repo, service, events } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-asks-project-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  repo.state.providers.push({ id: 'p1', name: 'Mock', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [{ id: 'm1', displayName: 'm1' }], enabled: true, createdAt: 0, hasApiKey: false });
  const notices = [];
  service.attachShell({ notify: (notice) => notices.push(notice), windowFocused: () => options.focused ?? false, applySettings() {} });
  const chat = await service.chatCreate('p1', 'm1', null, options.agentId ?? 'backend-developer', { skillIds: [], roleIds: [] }, folder, 'You help.');
  const providers = require('../src/main/providers.ts');
  const originalStream = providers.streamChat;
  t.after(() => {
    providers.streamChat = originalStream;
  });
  const requests = [];
  let calls = 0;
  providers.streamChat = async (provider, key, request) => {
    requests.push(request);
    return ++calls === 1 ? { toolCalls: [{ id: 'ask1', name: 'ask_user', arguments: JSON.stringify(args) }] } : { toolCalls: [] };
  };
  const waitFor = async (find) => {
    for (let i = 0; i < 200; i++) {
      const found = find();
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return undefined;
  };
  return { repo, service, events, chat, notices, requests, calls: () => calls, waitFor, options };
}

test('a coworker asks, the run waits, and your choice goes back as the tool result', async (t) => {
  const { service, events, chat, notices, requests, calls, waitFor } = await askingCoworker(t, {
    question: 'Which database should I use?',
    options: ['Postgres', 'SQLite']
  });
  const run = service.chatSend(chat.id, 'Set up storage', [], {});
  const request = await waitFor(() => events.find((e) => e.channel === 'chat' && e.approvalRequired)?.approvalRequired);
  assert.ok(request, 'the question reached the window');
  assert.equal(request.toolName, 'ask_user');
  assert.deepEqual(request.question, { text: 'Which database should I use?', options: ['Postgres', 'SQLite'], allowOther: true });
  assert.deepEqual(service.snapshot().pendingApprovals.map((r) => r.id), [request.id]);
  assert.ok(requests[0].tools.some((tool) => tool.name === 'ask_user'), 'the model was offered the tool');
  assert.equal(service.supervisor.list().find((r) => r.conversationId === chat.id).status, 'waiting_for_approval');
  assert.equal(service.supervisor.list().find((r) => r.conversationId === chat.id).activeTool, 'ask_user');
  assert.deepEqual(notices, [
    { title: 'Backend Developer has a question for you', body: 'Which database should I use?', target: { agentId: 'backend-developer', conversationId: chat.id } }
  ]);
  // It is still waiting: no second model call yet, however long it takes.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(calls(), 1, 'the run is paused');

  await service.toolApprove({ requestId: request.id, approved: true, answer: 'SQLite' });
  await run;
  assert.equal(calls(), 2);
  const told = requests[1].messages.findLast((m) => m.role === 'tool');
  assert.equal(told.name, 'ask_user');
  assert.equal(told.content, 'The user chose: SQLite');
  assert.deepEqual(service.snapshot().pendingApprovals, []);
  const logged = service.audit.list({ conversationId: chat.id }).find((e) => e.tool === 'ask_user');
  assert.equal(logged.subject, 'Which database should I use?');
  assert.equal(logged.decision, 'allowed');
  assert.equal(logged.result, 'ok');
  assert.equal(service.supervisor.list().find((r) => r.conversationId === chat.id).status, 'completed');
});

test('your own words go back too, and skipping lets the coworker decide', async (t) => {
  const typed = await askingCoworker(t, { question: 'What should the file be called?' });
  const run = typed.service.chatSend(typed.chat.id, 'Make a file', [], {});
  const request = await typed.waitFor(() => typed.events.find((e) => e.approvalRequired)?.approvalRequired);
  assert.deepEqual(request.question.options, []);
  assert.equal(request.question.allowOther, true);
  await typed.service.toolApprove({ requestId: request.id, approved: true, answer: 'notes.md' });
  await run;
  assert.equal(typed.requests[1].messages.findLast((m) => m.role === 'tool').content, 'The user answered: notes.md');

  const skipped = await askingCoworker(t, { question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] });
  const second = skipped.service.chatSend(skipped.chat.id, 'Format it', [], {});
  const asked = await skipped.waitFor(() => skipped.events.find((e) => e.approvalRequired)?.approvalRequired);
  await skipped.service.toolApprove({ requestId: asked.id, approved: false });
  await second;
  assert.match(skipped.requests[1].messages.findLast((m) => m.role === 'tool').content, /chose not to answer.*Decide for yourself/);
});

test('stopping the run while it waits withdraws the question', async (t) => {
  const { service, events, chat, waitFor, calls } = await askingCoworker(t, { question: 'Shall I continue?', options: ['Yes', 'No'] });
  const run = service.chatSend(chat.id, 'Go', [], {});
  const request = await waitFor(() => events.find((e) => e.approvalRequired)?.approvalRequired);
  assert.ok(request);
  service.chatStop(chat.id);
  await run;
  assert.deepEqual(service.snapshot().pendingApprovals, [], 'the card goes away');
  assert.equal(calls(), 1, 'the run did not carry on');
  assert.equal(await service.toolApprove({ requestId: request.id, approved: true, answer: 'Yes' }), undefined);
  const logged = service.audit.list({ conversationId: chat.id }).find((e) => e.tool === 'ask_user');
  assert.equal(logged.decision, 'withdrawn');
});

test('no notice when you are looking at Axon, and an empty question goes back to the coworker', async (t) => {
  const focused = await askingCoworker(t, { question: 'Fine?', options: ['Yes', 'No'] }, { focused: true });
  const run = focused.service.chatSend(focused.chat.id, 'Go', [], {});
  const request = await focused.waitFor(() => focused.events.find((e) => e.approvalRequired)?.approvalRequired);
  assert.deepEqual(focused.notices, []);
  await focused.service.toolApprove({ requestId: request.id, approved: true, answer: 'Yes' });
  await run;

  const empty = await askingCoworker(t, { question: '  ' });
  await empty.service.chatSend(empty.chat.id, 'Go', [], {});
  assert.deepEqual(empty.events.filter((e) => e.approvalRequired), [], 'nothing to ask you');
  const reply = empty.requests[1].messages.findLast((m) => m.role === 'tool');
  assert.match(reply.content, /question/);
});

test('a team member working on a task is not offered the question tool, but a coworker in a chat is', async (t) => {
  const team = await askingCoworker(t, { question: 'Ignored' });
  await team.service.chatSend(team.chat.id, 'Do your part', [], { teamId: 'team-1', taskId: 'a1' });
  assert.ok(!team.requests[0].tools.some((tool) => tool.name === 'ask_user'));
  // Were it to name the tool anyway, it isn't run: no card.
  assert.deepEqual(team.events.filter((e) => e.approvalRequired), []);
  const chatting = await askingCoworker(t, { question: 'Fine?', options: ['Yes', 'No'] });
  const run = chatting.service.chatSend(chatting.chat.id, 'Hello', [], {});
  const request = await chatting.waitFor(() => chatting.events.find((e) => e.approvalRequired)?.approvalRequired);
  assert.ok(chatting.requests[0].tools.some((tool) => tool.name === 'ask_user'));
  await chatting.service.toolApprove({ requestId: request.id, approved: false });
  await run;
});
