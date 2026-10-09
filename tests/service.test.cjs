const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
/** Electron as the service sees it; a test sets the native dialog's answer and watches restarts. */
const electron = {
  app: { isPackaged: false, relaunch() {}, quit() {} },
  dialog: {},
  utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) }
};
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
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
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

const makeService = (emit = () => {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, emit, 'parser-worker-path');
  return { dir, repo, service };
};
const addProvider = (repo) =>
  repo.state.providers.push({
    id: 'p1',
    name: 'MockProvider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });
/** A conversation with an office coworker, as the office starts one. */
const coworkerChat = (service, agentId = 'backend-developer') =>
  service.chatCreate(
    'p1',
    'm1',
    null,
    agentId,
    { skillIds: [], roleIds: [] },
    null,
    `You are Axon's ${agentId}.`
  );
const mockModel = (t, respond) => {
  const providersModule = require('../src/main/providers.ts');
  const original = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = original;
  });
  providersModule.streamChat = respond;
};

test('chatSelectionSet rejects unknown ids and caps at 50', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  repo.state.providers.push({
    id: 'p',
    name: 'P',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm', displayName: 'm' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });
  const chat = await service.chatCreate('p', 'm', null);
  await assert.rejects(
    service.chatSelectionSet(chat.id, { skillIds: ['nope/x'], roleIds: [] }),
    /Unknown skill: nope\/x/
  );
  await assert.rejects(
    service.chatSelectionSet(chat.id, {
      skillIds: [],
      roleIds: Array.from({ length: 51 }, () => 'frontend-developer')
    }),
    /at most 50 roles/
  );
  await service.chatSelectionSet(chat.id, {
    skillIds: ['superpowers/brainstorming'],
    roleIds: ['frontend-developer', 'frontend-developer']
  });
  assert.deepEqual(repo.state.conversations.find((c) => c.id === chat.id).roleIds, ['frontend-developer']);
});

test('chatCreate merges agent selections first', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  repo.state.providers.push({
    id: 'p',
    name: 'P',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm', displayName: 'm' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });
  const agent = {
    id: repo.id(),
    name: 'Agent',
    systemPrompt: 'You are an agent.',
    providerId: null,
    modelId: null,
    tools: [],
    workspaceId: null,
    skillIds: ['ponytail/ponytail-review'],
    roleIds: ['backend-developer'],
    maxSteps: 1,
    schedule: { kind: 'manual' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  repo.state.agents.push(agent);
  const chat = await service.chatCreate('p', 'm', null, agent.id, {
    skillIds: ['superpowers/brainstorming'],
    roleIds: ['backend-developer', 'frontend-developer']
  });
  assert.deepEqual(chat.skillIds, ['ponytail/ponytail-review', 'superpowers/brainstorming']);
  assert.deepEqual(chat.roleIds, ['backend-developer', 'frontend-developer']);
});

test('workspaceSave rejects an unknown role', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ws = repo.state.workspaces[0];
  await assert.rejects(service.workspaceSave({ ...ws, roleIds: ['nope'] }), /Unknown role: nope/);
});

test('subagent enforces permissions: rejects mutating actions and recursive dispatch', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  repo.state.providers.push({
    id: 'p1',
    name: 'MockProvider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });

  // Mock streamChat so that the model returns tool calls
  const providersModule = require('../src/main/providers.ts');
  const originalStreamChat = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = originalStreamChat;
  });

  let callCount = 0;
  providersModule.streamChat = async (provider, key, req, onChunk) => {
    callCount++;
    if (callCount === 1) {
      // The sub-agent is never offered a way to dispatch another.
      assert.ok(!(req.tools ?? []).some((tool) => tool.name === 'dispatch_subagent'));
      // Return a mutating tool call and a dispatch_subagent tool call
      return {
        toolCalls: [
          {
            id: 'call_1',
            name: 'write_file',
            arguments: JSON.stringify({ path: 'src/malicious.ts', content: 'boom' })
          },
          {
            id: 'call_2',
            name: 'dispatch_subagent',
            arguments: JSON.stringify({ role: 'nested', task: 'nested task' })
          }
        ]
      };
    }
    // Final response
    return { toolCalls: [] };
  };

  const output = await service.runSubagent('p1', 'm1', 'researcher', 'Do something', null);
  assert.ok(output);
});

test('project scoping: code workspace (fileAccess disabled) does not expose tools; projectRoot enables tools', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Set a global project root
  const projDir = path.join(dir, 'my-project');
  fs.mkdirSync(projDir, { recursive: true });
  await service.project.choose(projDir);

  repo.state.providers.push({
    id: 'p1',
    name: 'MockProvider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });

  // 1. Built-in Code Assistant workspace has fileAccess.enabled === false
  const codeWs = repo.state.workspaces.find((w) => w.id === 'code');
  assert.ok(codeWs);
  assert.equal(codeWs.fileAccess.enabled, false);

  const chatNormal = await service.chatCreate('p1', 'm1', 'code');
  assert.equal(chatNormal.projectRoot, null);

  // 2. A conversation created with an explicit projectRoot
  const chatProject = await service.chatCreate('p1', 'm1', null, undefined, undefined, projDir);
  assert.equal(chatProject.projectRoot, projDir);
});

test('context budget: long conversation is trimmed with sliding window rather than throwing fatal error', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  repo.state.providers.push({
    id: 'p1',
    name: 'MockProvider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });

  const chat = await service.chatCreate('p1', 'm1', null);

  // Pre-fill conversation with messages exceeding 300,000 characters
  const bigChunk = 'A'.repeat(80000);
  for (let i = 0; i < 5; i++) {
    repo.state.messages.push({
      id: repo.id(),
      conversationId: chat.id,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${bigChunk}`,
      createdAt: Date.now() + i
    });
  }

  // Mock streamChat
  const providersModule = require('../src/main/providers.ts');
  const originalStreamChat = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = originalStreamChat;
  });

  let sentRequests = [];
  providersModule.streamChat = async (provider, key, req, onChunk) => {
    sentRequests = req.messages;
    onChunk('Hello from model!');
    return { toolCalls: [] };
  };

  // Sending another message should trim older messages without throwing
  await service.chatSend(chat.id, 'New user prompt', []);

  assert.ok(sentRequests.length > 0);
  // Older messages were trimmed to fit budget
  assert.ok(sentRequests.length < 5, 'Older messages should have been trimmed');
  assert.equal(sentRequests[sentRequests.length - 1].content, 'New user prompt');
});

test('a coworker conversation gets one task record that follows its runs', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, async (_p, _k, _req, onChunk) => {
    onChunk('Here is the contract.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Design the API contract', []);
  assert.equal(repo.state.tasks.length, 1);
  const [task] = repo.state.tasks;
  assert.deepEqual(
    {
      kind: task.kind,
      status: task.status,
      title: task.title,
      coworkerId: task.coworkerId,
      conversationId: task.conversationId
    },
    {
      kind: 'work',
      status: 'done',
      title: 'Design the API contract',
      coworkerId: 'backend-developer',
      conversationId: chat.id
    }
  );
  const seen = events.filter((e) => e.channel === 'tasks').map((e) => e.tasks[0].status);
  assert.deepEqual(seen, ['working', 'done']);

  mockModel(t, async () => {
    throw new Error('Rate limited');
  });
  await service.chatSend(chat.id, 'Once more', []);
  assert.equal(repo.state.tasks.length, 1);
  assert.equal(task.status, 'attention');
  assert.equal(task.note, 'Rate limited');

  // Chats that belong to no coworker get no record.
  const plain = await service.chatCreate('p1', 'm1', null);
  mockModel(t, async (_p, _k, _req, onChunk) => {
    onChunk('Hi.');
    return { toolCalls: [] };
  });
  await service.chatSend(plain.id, 'Hello', []);
  assert.equal(repo.state.tasks.length, 1);
});

test('an older saved state without task records still loads', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const { initialState } = require('../src/main/repository.ts');
  const old = initialState();
  delete old.tasks;
  old.settings.theme = 'dark';
  fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), JSON.stringify(old));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  assert.deepEqual(repo.state.tasks, []);
  assert.equal(repo.state.settings.theme, 'dark', 'loaded the saved file, not a fresh state');
});

test('a coworker asks colleagues: three answer, the fourth is turned away, and help is recorded', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'frontend-developer');
  let consults = 0;
  let askerCalls = 0;
  let offered;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) {
      consults++;
      onChunk(`Answer ${consults}.`);
      return { toolCalls: [] };
    }
    askerCalls++;
    if (askerCalls === 1) {
      offered = (req.tools ?? []).map((tool) => tool.name);
      const ask = (n) => ({
        id: `ask${n}`,
        name: 'ask_colleague',
        arguments: JSON.stringify({ colleague: 'Backend Developer', question: `Question ${n}?` })
      });
      return { toolCalls: [ask(1), ask(2), ask(3), ask(4)] };
    }
    onChunk('Done, with help.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Build the settings page', []);
  assert.deepEqual(offered, ['ask_colleague', 'read_attachment', 'search_conversation_history', 'retrieve_conversation_turns', 'read_tool_output'], 'no folder: colleague and scoped memory retrieval');
  assert.equal(consults, 3);
  const results = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.equal(results.length, 4);
  const answered = results.slice(0, 3).map((m) => JSON.parse(m.content));
  assert.deepEqual(
    answered.map((r) => [r.colleague, r.name]),
    Array(3).fill(['backend-developer', 'Backend Developer'])
  );
  assert.deepEqual(
    answered.map((r) => r.answer),
    ['Answer 1.', 'Answer 2.', 'Answer 3.']
  );
  assert.match(results[3].content, /asked three colleagues already/);
  assert.ok(results[3].error);
  const help = repo.state.tasks.filter((task) => task.kind === 'help');
  assert.equal(help.length, 3);
  assert.ok(
    help.every(
      (task) =>
        task.status === 'done' &&
        task.coworkerId === 'backend-developer' &&
        task.forCoworkerId === 'frontend-developer' &&
        task.conversationId === chat.id
    )
  );
  const work = repo.state.tasks.find((task) => task.kind === 'work');
  assert.equal(work.status, 'done');
  // The asking message keeps every call's outcome, so the thread reads the same after a reload.
  const asking = repo.state.messages.find((m) => m.conversationId === chat.id && m.toolCalls?.length);
  assert.deepEqual(
    asking.toolCalls.map((tc) => Boolean(tc.result)),
    [true, true, true, false]
  );
  assert.match(asking.toolCalls[3].error, /asked three colleagues already/);
});

test('a colleague who cannot be reached ends their help with the reason', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'frontend-developer');
  let askerCalls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) throw new Error('Provider down');
    askerCalls++;
    if (askerCalls === 1)
      return {
        toolCalls: [
          {
            id: 'a',
            name: 'ask_colleague',
            arguments: JSON.stringify({ colleague: 'engineer', question: 'Q?' })
          },
          {
            id: 'b',
            name: 'ask_colleague',
            arguments: JSON.stringify({ colleague: 'Security Engineer', question: 'Is this safe?' })
          }
        ]
      };
    onChunk('Carrying on.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Harden the login', []);
  const results = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.match(results[0].content, /No single colleague matches "engineer"/);
  assert.match(results[1].content, /Couldn't reach Security Engineer: Provider down/);
  const [help] = repo.state.tasks.filter((task) => task.kind === 'help');
  assert.equal(help.status, 'done');
  assert.equal(help.note, 'Provider down');
});

test('the receptionist keeps the planner with her own tools, knowing the date', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'receptionist');
  let calls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    calls++;
    if (calls === 1) {
      assert.deepEqual(
        req.tools.map((tool) => tool.name),
        ['ask_colleague', 'add_task', 'list_tasks', 'update_task', 'complete_task', 'read_attachment', 'search_conversation_history', 'retrieve_conversation_turns', 'read_tool_output']
      );
      assert.match(
        req.system,
        /Now: \w+day \d+ \w+ \d{4}, \d\d:\d\d \(UTC[+-]\d\d:\d\d\)\. Today is \d{4}-\d\d-\d\d\./
      );
      return {
        toolCalls: [
          {
            id: 'add',
            name: 'add_task',
            arguments: JSON.stringify({
              title: 'Prep the investor deck',
              due: '2099-01-02T10:00',
              remind_at: '2099-01-02T09:30'
            })
          }
        ]
      };
    }
    onChunk('Added: Prep the investor deck.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Remind me to prep the investor deck', []);
  const todos = repo.state.tasks.filter((task) => task.kind === 'todo');
  assert.equal(todos.length, 1);
  assert.equal(todos[0].title, 'Prep the investor deck');
  assert.equal(todos[0].due, '2099-01-02T10:00');
  assert.equal(todos[0].remindAt, new Date(2099, 0, 2, 9, 30).getTime());
  // She has no work records of her own; the call keeps its result for the thread.
  assert.equal(repo.state.tasks.filter((task) => task.kind === 'work').length, 0);
  const call = repo.state.messages.find((m) => m.conversationId === chat.id && m.toolCalls?.length)
    .toolCalls[0];
  assert.match(
    call.result,
    /^Added "Prep the investor deck" \(id [^)]+\) — due Fri 2 Jan 2099 10:00, reminder Fri 2 Jan 2099 09:30\.$/
  );
});

test('the receptionist on a model without tools says so plainly', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service, 'receptionist');
  mockModel(t, async () => {
    throw new Error('registry.ollama.ai/library/gemma:2b does not support tools');
  });
  await service.chatSend(chat.id, 'What is on today?', []);
  const reply = repo.state.messages
    .filter((m) => m.conversationId === chat.id && m.role === 'assistant')
    .pop();
  assert.equal(reply.error, "This model can't use tools, so I can't keep your planner. Pick another model.");
});

/** Resolves once `find` returns something, or fails after about two seconds. */
async function waitFor(find, what) {
  for (let i = 0; i < 200; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const within = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish`)), ms))
  ]);

test('after a tool call fails, the next message still sends every call with its result', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  const sent = [];
  let calls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    sent.push(
      req.messages.map((m) => ({
        role: m.role,
        toolCallId: m.toolCallId,
        calls: m.toolCalls?.map((c) => c.id)
      }))
    );
    if (++calls === 1)
      return { toolCalls: [{ id: 't1', name: 'read_file', arguments: '{"path":"missing.txt"}' }] };
    onChunk('Sorry, I could not read it.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Read missing.txt', []);
  await service.chatSend(chat.id, 'Try again', []);
  assert.deepEqual(sent[2], [
    { role: 'user', toolCallId: undefined, calls: undefined },
    { role: 'assistant', toolCallId: undefined, calls: ['t1'] },
    { role: 'tool', toolCallId: 't1', calls: undefined },
    { role: 'assistant', toolCallId: undefined, calls: undefined },
    { role: 'user', toolCallId: undefined, calls: undefined }
  ]);
});

test('Stop while a tool waits for approval withdraws it, and the tool never runs', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  await service.project.choose(folder);
  const chat = await service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  mockModel(t, async () => ({
    toolCalls: [{ id: 'w', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'x' }) }]
  }));
  const run = service.chatSend(chat.id, 'Write a.txt', []);
  const request = await waitFor(
    () => events.find((e) => e.channel === 'chat' && e.approvalRequired)?.approvalRequired,
    'the approval'
  );
  service.chatStop(chat.id);
  await within(run, 2000, 'the stopped run');
  assert.deepEqual(service.snapshot().pendingApprovals, []);
  await service.toolApprove({ requestId: request.id, approved: true });
  assert.equal(fs.existsSync(path.join(folder, 'a.txt')), false);
});

test('malformed tool arguments go back to the model as an error instead of running with none', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    if (++calls === 1)
      return { toolCalls: [{ id: 'w', name: 'write_file', arguments: '{"path": "a.txt", "cont' }] };
    onChunk('Retrying.');
    return { toolCalls: [] };
  });
  await within(service.chatSend(chat.id, 'Write a.txt', []), 2000, 'the run');
  assert.ok(!events.some((e) => e.approvalRequired), 'nothing to approve');
  const result = repo.state.messages.find((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.match(result.content, /not valid JSON/);
});

test('colleagues and sub-agents answer within the configured max tokens', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  repo.state.settings.defaultMaxTokens = 8000;
  const seen = [];
  let askerCalls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    seen.push({ system: req.system, maxTokens: req.maxTokens, signal: req.signal });
    if (req.system.includes('is asking you a question') || req.system.includes('autonomous subagent')) {
      onChunk('Answer.');
      return { toolCalls: [] };
    }
    if (++askerCalls === 1)
      return {
        toolCalls: [
          {
            id: 'a',
            name: 'ask_colleague',
            arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'Q?' })
          }
        ]
      };
    onChunk('Done.');
    return { toolCalls: [] };
  });
  const chat = await coworkerChat(service, 'frontend-developer');
  await service.chatSend(chat.id, 'Build it', []);
  const stop = new AbortController();
  await service.runSubagent('p1', 'm1', 'Reviewer', 'Review it', null, undefined, stop.signal);
  const consult = seen.find((s) => s.system.includes('is asking you a question'));
  const subagent = seen.find((s) => s.system.includes('autonomous subagent'));
  assert.equal(consult.maxTokens, 8000);
  assert.equal(subagent.maxTokens, 8000);
  assert.ok(subagent.signal instanceof AbortSignal);
  assert.equal(subagent.signal.aborted, false);
});

test('an answer cut off at the token limit says so', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  mockModel(t, async (_p, _k, _req, onChunk) => {
    onChunk('The first half of');
    return { truncated: true };
  });
  await service.chatSend(chat.id, 'Write an essay', []);
  const reply = repo.state.messages
    .filter((m) => m.conversationId === chat.id && m.role === 'assistant')
    .pop();
  assert.equal(reply.content, 'The first half of');
  assert.match(reply.error, /max-token limit/);
});

test('a thinking model that runs out of tokens before answering is told apart, with the limit to set', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  mockModel(t, async (_p, _k, _req, onChunk) => {
    onChunk('', { type: 'thought', text: 'Let me think about every step of this carefully...' });
    return { truncated: true };
  });
  await service.chatSend(chat.id, 'Plan my week', []);
  const reply = repo.state.messages
    .filter((m) => m.conversationId === chat.id && m.role === 'assistant')
    .pop();
  assert.equal(reply.content, '');
  assert.match(reply.error, /thinking/);
  assert.match(reply.error, /Raise Max tokens/);
});

test("each tool round sends the provider's own turn back with it", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  const replay = {
    kind: 'anthropic',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'list_files', input: {} }
    ]
  };
  let second;
  let calls = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (++calls === 1) return { toolCalls: [{ id: 't1', name: 'list_files', arguments: '{}' }], replay };
    second = req.messages;
    onChunk('Listed.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'List files', []);
  assert.deepEqual(second.find((m) => m.role === 'assistant').replay, replay);
});

test('max tokens can be set up to 128,000 for long answers', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await service.settingsSave({ ...repo.state.settings, defaultMaxTokens: 64000 });
  assert.equal(repo.state.settings.defaultMaxTokens, 64000);
  await assert.rejects(
    service.settingsSave({ ...repo.state.settings, defaultMaxTokens: 200000 }),
    /Invalid settings/
  );
});

test('an agent with an interval schedule from an older build never runs on its own', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  addProvider(repo);
  const now = Date.now();
  // Put straight into memory, as an older build left it, before the service starts.
  repo.state.agents.push({
    id: 'old',
    name: 'Nightly digest',
    systemPrompt: 'Summarise.',
    providerId: 'p1',
    modelId: 'm1',
    tools: [],
    workspaceId: null,
    skillIds: [],
    roleIds: [],
    maxSteps: 3,
    schedule: { kind: 'interval', intervalMinutes: 1, input: 'Write the digest.' },
    createdAt: now,
    updatedAt: now
  });
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    calls++;
    onChunk('Digest.');
    return { toolCalls: [] };
  });
  const service = new Service(
    repo,
    { has: () => false, get: () => null, set() {}, remove() {} },
    dir,
    () => {},
    'worker'
  );
  t.after(() => service.shutdown());
  t.mock.timers.tick(5 * 60_000);
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0, 'no model call');
  assert.equal(repo.state.conversations.length, 0, 'no conversation started');
});

test('each step of a run stops showing as generating when the next one starts', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    if (++calls === 1) {
      onChunk('Let me look.');
      return { toolCalls: [{ id: 't1', name: 'list_files', arguments: '{}' }] };
    }
    onChunk('Done.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Look around', []);
  const replies = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'assistant');
  assert.equal(replies.length, 2);
  const first = events.filter((e) => e.channel === 'chat' && e.messageId === replies[0].id);
  const finished = first.findIndex((e) => e.streaming === false);
  assert.ok(finished >= 0, 'the first step is marked finished');
  assert.equal(first[finished].contentSoFar, 'Let me look.');
  assert.equal(first[finished].done, false, 'the run itself goes on');
  const second = events.findIndex((e) => e.channel === 'chat' && e.messageId === replies[1].id);
  assert.ok(events.indexOf(first[finished]) < second, 'before the next step speaks');
});

test('the context meter comes with each step, measured from compiled token sections, and again when the run ends', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  let sent;
  mockModel(t, async (_p, _k, req, onChunk) => {
    sent = { system: req.system, size: JSON.stringify(req.messages).length };
    onChunk('Hello there.');
    return { toolCalls: [], promptTokens: 20, completionTokens: 3 };
  });
  await service.chatSend(chat.id, 'Say hello', []);
  const metered = events.filter((e) => e.channel === 'chat' && e.contextUsage);
  const first = metered[0].contextUsage;
  assert.ok(first.tokenBasis.usedTokens > 0);
  assert.ok(first.outputReserve + first.safetyMargin + first.tokenBasis.usedTokens <= first.tokenBasis.windowTokens);
  assert.equal(first.estimated, true);
  const last = metered.at(-1);
  assert.equal(last.done, true);
  assert.ok(
    last.contextUsage.tokenBasis.usedTokens > 0,
    'the reply counts once it is part of the conversation'
  );
});

test('a long conversation shows a healthy compiled meter while history remains saved', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  for (let i = 0; i < 5; i++)
    repo.state.messages.push({
      id: repo.id(),
      conversationId: chat.id,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'A'.repeat(80000)}`,
      createdAt: Date.now() + i
    });
  let count;
  mockModel(t, async (_p, _k, req, onChunk) => {
    count = req.messages.length;
    onChunk('ok');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'New user prompt', []);
  const first = events.find((e) => e.channel === 'chat' && e.contextUsage).contextUsage;
  assert.ok(first.pct < 0.85);
  assert.ok(first.archivedTokens > 0);
  assert.ok(count < 6, 'and the request was trimmed');
});

test('the meter is there before anything is sent, as a token estimate for the selected model', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  repo.state.providers[0].models[0].contextWindow = 8192;
  const chat = await service.chatCreate('p1', 'm1', null);
  assert.equal(await service.getContextUsage('nope'), null);
  const fresh = await service.getContextUsage(chat.id);
  assert.equal(fresh.estimated, true);
  assert.ok(fresh.tokenBasis.usedTokens > 0, 'the system prompt already takes room');
  repo.state.messages.push(
    { id: repo.id(), conversationId: chat.id, role: 'user', content: 'hi', createdAt: 1 },
    {
      id: repo.id(),
      conversationId: chat.id,
      role: 'assistant',
      content: 'hello',
      createdAt: 2,
      providerId: 'p1',
      modelId: 'm1',
      usage: { promptTokens: 4096, completionTokens: 5 }
    }
  );
  const measured = await service.getContextUsage(chat.id);
  assert.equal(measured.tokenBasis.windowTokens, 8192);
  assert.equal(measured.estimated, true);
  assert.equal(measured.pct, measured.tokenBasis.usedTokens / 8192);
});

test('a priced model gets an estimate before each call; an unpriced one gets none', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  let sent;
  mockModel(t, async (_p, _k, req, onChunk) => {
    sent = { size: req.system.length + JSON.stringify(req.messages).length, maxTokens: req.maxTokens };
    onChunk('ok');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Unpriced', []);
  assert.ok(!events.some((e) => e.estimate), 'no price, no estimate');
  Object.assign(repo.state.providers[0].models[0], {
    pricePerMillionInputTokens: 3,
    pricePerMillionOutputTokens: 15
  });
  events.length = 0;
  await service.chatSend(chat.id, 'Priced', []);
  const { estimate } = events.find((e) => e.estimate);
  assert.equal(estimate.inputTokens, events.find(e => e.estimate).contextUsage.tokenBasis.usedTokens);
  assert.equal(estimate.maxOutputTokens, sent.maxTokens);
  assert.ok(Math.abs(estimate.maxOutputCost - (sent.maxTokens * 15) / 1e6) < 1e-12);
});

test("each step's reported usage reaches the window as the step ends", async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await service.chatCreate('p1', 'm1', null);
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    if (++calls === 1) {
      onChunk('Let me look.');
      return {
        toolCalls: [{ id: 't1', name: 'list_files', arguments: '{}' }],
        promptTokens: 100,
        completionTokens: 10
      };
    }
    onChunk('Done.');
    return { toolCalls: [], promptTokens: 150, completionTokens: 5 };
  });
  await service.chatSend(chat.id, 'Look around', []);
  const replies = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'assistant');
  const ended = events.find(
    (e) => e.channel === 'chat' && e.messageId === replies[0].id && e.streaming === false
  );
  assert.deepEqual(ended.usage, { promptTokens: 100, completionTokens: 10 });
});

test("a model keeps the context window and prices you give it; a detail that isn't a number is refused", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const provider = {
    id: 'px',
    name: 'Priced',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    enabled: true,
    createdAt: 0,
    hasApiKey: false,
    models: [
      {
        id: 'm',
        displayName: 'm',
        contextWindow: 128000,
        pricePerMillionInputTokens: 3,
        pricePerMillionOutputTokens: 15,
        junk: 'x'
      },
      { id: 'free', displayName: 'free', pricePerMillionInputTokens: 0, pricePerMillionOutputTokens: 0 }
    ]
  };
  await service.providerSave(provider);
  assert.deepEqual(repo.state.providers[0].models, [
    {
      id: 'm',
      displayName: 'm',
      contextWindow: 128000,
      pricePerMillionInputTokens: 3,
      pricePerMillionOutputTokens: 15
    },
    { id: 'free', displayName: 'free', pricePerMillionInputTokens: 0, pricePerMillionOutputTokens: 0 }
  ]);
  for (const bad of [
    { pricePerMillionInputTokens: -1 },
    { pricePerMillionOutputTokens: 'lots' },
    { pricePerMillionInputTokens: NaN },
    { contextWindow: 0 },
    { contextWindow: 1.5 }
  ])
    await assert.rejects(
      service.providerSave({ ...provider, id: 'py', models: [{ id: 'm', displayName: 'm', ...bad }] }),
      /whole number of tokens|dollar amount/,
      JSON.stringify(bad)
    );
  assert.equal(repo.state.providers.length, 1);
});

test("Settings → Usage adds up every reply's reported usage", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  Object.assign(repo.state.providers[0].models[0], {
    pricePerMillionInputTokens: 2,
    pricePerMillionOutputTokens: 10
  });
  const chat = await service.chatCreate('p1', 'm1', null);
  repo.state.messages.push({
    id: repo.id(),
    conversationId: chat.id,
    role: 'assistant',
    content: 'ok',
    createdAt: Date.now(),
    providerId: 'p1',
    modelId: 'm1',
    usage: { promptTokens: 1000, completionTokens: 200 }
  });
  const report = service.usageReport();
  assert.equal(report.allTime.turns, 1);
  assert.ok(Math.abs(report.allTime.cost - 0.004) < 1e-12);
  assert.equal(report.conversations[0].key, chat.id);
});

const backupFile = 'state-2026-09-20T08-00-00-000Z.json';
const seedBackup = (dir) =>
  fs.writeFileSync(
    path.join(dir, 'backups', backupFile),
    JSON.stringify({
      version: 1,
      settings: {},
      providers: [],
      conversations: [{ id: 'old' }],
      messages: [],
      workspaces: [],
      agents: [],
      documents: [],
      chunks: []
    })
  );
const answerDialog = (t, response) => {
  const seen = { asked: null, restarts: 0, quits: 0 };
  electron.dialog.showMessageBox = async (options) => {
    seen.asked = options;
    return { response };
  };
  electron.app.relaunch = () => {
    seen.restarts++;
  };
  electron.app.quit = () => {
    seen.quits++;
  };
  t.after(() => {
    delete electron.dialog.showMessageBox;
    electron.app.relaunch = () => {};
    electron.app.quit = () => {};
  });
  return seen;
};

test('restore points are listed over IPC', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedBackup(dir);
  assert.equal((await service.listBackups()).find((b) => b.file === backupFile)?.conversations, 1);
});

test('restoring asks first, Cancel being the default, and Cancel changes nothing', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedBackup(dir);
  const seen = answerDialog(t, 0);
  await assert.rejects(service.restoreBackup(backupFile), /cancelled/);
  assert.match(seen.asked.detail, /backed up first/);
  assert.equal(seen.asked.defaultId, 0);
  assert.equal(seen.asked.cancelId, 0);
  assert.equal(seen.restarts, 0);
  const saved = path.join(dir, 'db', 'platform-v1.json');
  assert.ok(
    !fs.existsSync(saved) ||
      !JSON.parse(fs.readFileSync(saved, 'utf8')).conversations.some((c) => c.id === 'old'),
    'nothing restored'
  );
});

test('restoring after you confirm puts the backup back and restarts Axon', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedBackup(dir);
  const seen = answerDialog(t, 1);
  await service.restoreBackup(backupFile);
  assert.equal(seen.restarts, 1);
  assert.equal(seen.quits, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'db', 'platform-v1.json'), 'utf8'));
  assert.deepEqual(
    saved.conversations.map((c) => c.id),
    ['old']
  );
});

test('an unknown restore point is refused before anything is asked', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const seen = answerDialog(t, 1);
  await assert.rejects(service.restoreBackup('state-2026-01-01T00-00-00-000Z.json'), /gone/);
  assert.equal(seen.asked, null);
});

const decisions = (service) => service.audit.all().map((e) => [e.tool, e.decision, e.result ?? null]);

test('every call in a run is in the audit trail with its decision and result', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  await service.project.choose(folder);
  const chat = await service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    calls++;
    if (calls === 1)
      return {
        toolCalls: [
          { id: 'l', name: 'list_files', arguments: '{}' },
          { id: 'b', name: 'bogus_tool', arguments: '{}' },
          { id: 'j', name: 'read_file', arguments: '{"path": ' },
          { id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'one' }) },
          { id: 'r', name: 'run_command', arguments: JSON.stringify({ command: 'npm test' }) }
        ]
      };
    if (calls === 2)
      return {
        toolCalls: [
          { id: 'w2', name: 'write_file', arguments: JSON.stringify({ path: 'b.txt', content: 'two' }) }
        ]
      };
    if (calls === 3)
      return {
        toolCalls: [
          { id: 'w3', name: 'write_file', arguments: JSON.stringify({ path: 'c.txt', content: 'three' }) }
        ]
      };
    onChunk('Done.');
    return { toolCalls: [] };
  });
  const run = service.chatSend(chat.id, 'Do things', []);
  const first = await waitFor(
    () => events.filter((e) => e.approvalRequired)[0]?.approvalRequired,
    'the first approval'
  );
  await service.toolApprove({ requestId: first.id, approved: false });
  const second = await waitFor(
    () => events.filter((e) => e.approvalRequired)[1]?.approvalRequired,
    'the second approval'
  );
  await service.toolApprove({ requestId: second.id, approved: true, alwaysAllowSession: true });
  await run;
  assert.deepEqual(decisions(service), [
    ['list_files', 'allowed', 'ok'],
    ['bogus_tool', 'skipped', null],
    ['read_file', 'skipped', null],
    ['write_file', 'rejected', null],
    ['run_command', 'denied', null],
    ['write_file', 'approved-session', 'ok'],
    ['write_file', 'allowed', 'ok']
  ]);
  const entries = service.audit.all();
  assert.deepEqual(entries[0].actor, { kind: 'chat', name: 'Assistant' });
  assert.equal(entries[0].conversationId, chat.id);
  assert.equal(entries[3].subject, 'a.txt');
  assert.deepEqual(entries[5].change, { added: 1, removed: 0, created: true });
  assert.equal(entries[6].detail, 'Allowed for this session');
  assert.match(entries[4].detail, /disabled/);
});

test("a stopped run's waiting call is recorded as withdrawn", async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  await service.project.choose(folder);
  const chat = await service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  mockModel(t, async () => ({
    toolCalls: [{ id: 'w', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'x' }) }]
  }));
  const run = service.chatSend(chat.id, 'Write a.txt', []);
  await waitFor(() => events.find((e) => e.approvalRequired), 'the approval');
  service.chatStop(chat.id);
  await within(run, 2000, 'the stopped run');
  assert.deepEqual(decisions(service), [['write_file', 'withdrawn', null]]);
});

test("a colleague's lookups are recorded on behalf of the coworker who asked", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'a.txt'), 'hello');
  await service.project.choose(folder);
  const { coworkerById } = require('../src/shared/coworkers.ts');
  const chat = await coworkerChat(service, 'frontend-developer');
  let asker = 0,
    consulted = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) {
      if (++consulted === 1)
        return {
          toolCalls: [
            { id: 'cr', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) },
            { id: 'cw', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'no' }) }
          ]
        };
      onChunk('It says hello.');
      return { toolCalls: [] };
    }
    if (++asker === 1)
      return {
        toolCalls: [
          {
            id: 'ask',
            name: 'ask_colleague',
            arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'What is in a.txt?' })
          }
        ]
      };
    onChunk('Thanks.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Ask about a.txt', []);
  const entries = service.audit.all();
  const asking = coworkerById('frontend-developer').name,
    helping = coworkerById('backend-developer').name;
  assert.deepEqual(
    entries.map((e) => [e.actor.kind, e.actor.name, e.actor.onBehalfOf ?? null, e.tool, e.decision]),
    [
      ['colleague', helping, asking, 'read_file', 'allowed'],
      ['colleague', helping, asking, 'write_file', 'skipped'],
      ['coworker', asking, null, 'ask_colleague', 'allowed']
    ]
  );
  assert.ok(entries.every((e) => e.conversationId === chat.id));
});

test("a sub-agent's calls are recorded on behalf of the run that sent it", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  let calls = 0;
  mockModel(t, async () =>
    ++calls === 1
      ? {
          toolCalls: [
            { id: 's1', name: 'write_file', arguments: JSON.stringify({ path: 'x.ts', content: 'boom' }) },
            {
              id: 's2',
              name: 'dispatch_subagent',
              arguments: JSON.stringify({ role: 'nested', task: 'more' })
            }
          ]
        }
      : { toolCalls: [] }
  );
  await service.runSubagent('p1', 'm1', 'researcher', 'Look around', null, undefined, undefined, undefined, {
    conversationId: 'c1',
    name: 'Assistant'
  });
  assert.deepEqual(
    service.audit.all().map((e) => [e.actor.kind, e.actor.onBehalfOf, e.tool, e.decision, e.conversationId]),
    [
      ['subagent', 'Assistant', 'write_file', 'denied', 'c1'],
      ['subagent', 'Assistant', 'dispatch_subagent', 'denied', 'c1']
    ]
  );
});

test('the activity log is listed and exported over IPC', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  service.audit.record({
    actor: { kind: 'you', name: 'You' },
    tool: 'write_file',
    subject: 'a.txt',
    decision: 'reverted'
  });
  assert.equal(service.auditList({ group: 'changes' }).length, 1);
  const out = path.join(dir, 'export.json');
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  t.after(() => {
    delete electron.dialog.showSaveDialog;
  });
  assert.equal(await service.auditExport(), true);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8'))[0].subject, 'a.txt');
});

/** A chat in a project folder whose model writes `file` once; the write is approved. */
test('Allow for this task covers a second write, but the next run asks again', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder);
  await service.project.choose(folder);
  const chat = await service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  let calls = 0;
  mockModel(t, async (_p, _k, _req, onChunk) => {
    calls++;
    if ([1, 2, 4].includes(calls)) return { toolCalls: [{ id: `write-${calls}`, name: 'write_file', arguments: JSON.stringify({ path: `${calls}.txt`, content: `write ${calls}` }) }] };
    onChunk('The files are saved.');
    return { toolCalls: [] };
  });
  const firstRun = service.chatSend(chat.id, 'Save two files', []);
  const first = await waitFor(() => events.find((e) => e.approvalRequired)?.approvalRequired, 'first write approval');
  await service.toolApprove({ requestId: first.id, approved: true, allowForTask: true });
  await firstRun;
  assert.equal(events.filter((e) => e.approvalRequired).length, 1);
  assert.equal(fs.readFileSync(path.join(folder, '2.txt'), 'utf8'), 'write 2');
  const nextRun = service.chatSend(chat.id, 'Save another file', []);
  const next = await waitFor(() => events.filter((e) => e.approvalRequired)[1]?.approvalRequired, 'next run approval');
  assert.notEqual(next.id, first.id);
  assert.equal(fs.existsSync(path.join(folder, '4.txt')), false);
  await service.toolApprove({ requestId: next.id, approved: true });
  await nextRun;
  assert.equal(fs.readFileSync(path.join(folder, '4.txt'), 'utf8'), 'write 4');
});

const writeOnce = async (t, file, content) => {
  const events = [];
  const made = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(made.dir, { recursive: true, force: true }));
  addProvider(made.repo);
  const folder = path.join(made.dir, 'project');
  fs.mkdirSync(folder, { recursive: true });
  await made.service.project.choose(folder);
  const chat = await made.service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  let calls = 0;
  mockModel(t, async () =>
    ++calls === 1
      ? { toolCalls: [{ id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: file, content }) }] }
      : { toolCalls: [] }
  );
  return {
    ...made,
    folder,
    chat,
    events,
    run: async (before) => {
      if (before !== undefined) fs.writeFileSync(path.join(folder, file), before);
      const run = made.service.chatSend(chat.id, 'Write it', []);
      const request = await waitFor(
        () => events.find((e) => e.approvalRequired)?.approvalRequired,
        'the approval'
      );
      await made.service.toolApprove({ requestId: request.id, approved: true });
      await run;
      return made.repo.state.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === 'w1');
    }
  };
};

test('a saved write keeps the version it replaced, so it can be undone', async (t) => {
  const { service, run } = await writeOnce(t, 'a.txt', 'new');
  const call = await run('old');
  assert.equal(call.change.undo, 'kept');
  const kept = await service.checkpoints.get('w1');
  assert.equal(kept.before, 'old');
  assert.equal(kept.existed, true);
  assert.equal(kept.path, 'a.txt');
});

test("an existing file Axon couldn't read is saved, is not reported as new, and can't be undone", async (t) => {
  const { service, run } = await writeOnce(t, 'big.txt', 'small now');
  const call = await run('x'.repeat(1_000_001));
  assert.equal(call.change.created, false);
  assert.equal(call.change.undo, 'unreadable');
  assert.equal(await service.checkpoints.get('w1'), null);
  assert.equal(service.audit.all().at(-1).detail, "Can't be undone");
});

test('undo puts back the version a write replaced, once, and says so in the audit trail', async (t) => {
  const { service, repo, folder, run } = await writeOnce(t, 'a.txt', 'new');
  await run('old');
  const seen = answerDialog(t, 1);
  await service.revertChange('w1');
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'old');
  assert.match(seen.asked.message, /Undo .*a\.txt/);
  assert.equal(seen.asked.defaultId, 0);
  const call = repo.state.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === 'w1');
  assert.equal(typeof call.change.revertedAt, 'number');
  assert.equal(service.audit.all().at(-1).decision, 'reverted');
  await assert.rejects(service.revertChange('w1'), /can't be undone any more/);
});

test('undo of a file a coworker created deletes it', async (t) => {
  const { service, folder, run } = await writeOnce(t, 'fresh.txt', 'hello');
  await run();
  const seen = answerDialog(t, 1);
  await service.revertChange('w1');
  assert.equal(fs.existsSync(path.join(folder, 'fresh.txt')), false);
  assert.match(seen.asked.detail, /Deletes the file/);
});

test('undo asks first, and Cancel changes nothing', async (t) => {
  const { service, folder, run } = await writeOnce(t, 'a.txt', 'new');
  await run('old');
  answerDialog(t, 0);
  await assert.rejects(service.revertChange('w1'), /cancelled/);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'new');
  assert.ok(await service.checkpoints.get('w1'), 'still undoable');
});

test('undo warns when the file changed since the write', async (t) => {
  const { service, folder, run } = await writeOnce(t, 'a.txt', 'new');
  await run('old');
  fs.writeFileSync(path.join(folder, 'a.txt'), 'edited later');
  const seen = answerDialog(t, 1);
  await service.revertChange('w1');
  assert.match(seen.asked.detail, /changed since/);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'old');
});

test('undo only works in the project the change was made in', async (t) => {
  const { service, dir, run } = await writeOnce(t, 'a.txt', 'new');
  await run('old');
  const other = path.join(dir, 'other');
  fs.mkdirSync(other);
  await service.project.choose(other);
  const seen = answerDialog(t, 1);
  await assert.rejects(service.revertChange('w1'), /Open .* to undo this change/);
  assert.equal(seen.asked, null);
});

test('provider context overflow recompiles and retries exactly once without duplicate text', async t => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
  addProvider(repo);
  const chat = await service.chatCreate('p1','m1',null);
  let calls = 0;
  mockModel(t, async (_p,_k,req,onChunk) => {
    calls++;
    assert.equal(req.messages.at(-1).content,'Continue current task');
    if (calls === 1) throw new Error('context_length_exceeded');
    onChunk('Recovered safely.');
    return {toolCalls:[],promptTokens:100,completionTokens:4};
  });
  await service.chatSend(chat.id,'Continue current task',[]);
  assert.equal(calls,2);
  assert.equal(repo.state.messages.filter(m=>m.role==='assistant').at(-1).content,'Recovered safely.');
});
test('a second overflow offers recovery guidance and never loops', async t => {
  const {dir,repo,service} = makeService();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  addProvider(repo);
  const chat=await service.chatCreate('p1','m1',null);
  let calls=0;
  mockModel(t,async()=>{ calls++; throw new Error('prompt too long'); });
  await service.chatSend(chat.id,'Keep my task',[]);
  assert.equal(calls,2);
  assert.match(repo.state.messages.filter(m=>m.role==='assistant').at(-1).error,/Your full conversation is saved/);
  assert.equal(repo.state.messages.find(m=>m.role==='user').content,'Keep my task');
});

test('oversize required input saves the user request and emits a finished recovery state', async t => {
  const events=[];
  const {dir,repo,service}=makeService(event=>events.push(event));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  addProvider(repo);
  const chat=await service.chatCreate('p1','m1',null);
  let calls=0;
  mockModel(t,async()=>{ calls++; return {toolCalls:[]}; });
  const input='z'.repeat(50000);
  await service.chatSend(chat.id,input,[]);
  assert.equal(calls,0);
  assert.equal(repo.state.messages.find(m=>m.role==='user').content,input);
  const finished=events.findLast(event=>event.channel==='chat' && event.done);
  assert.equal(finished.contextUsage.state,'recovery-required');
  assert.match(finished.error,/Split the input/);
});


test('background semantic checkpoint retains unlabeled user requirements independently of compilation', async t => {
  const { dir, repo, service } = makeService();
  t.after(() => { service.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  addProvider(repo);
  const chat = await coworkerChat(service);
  repo.appendMessages({ id: 'semantic-source', conversationId: chat.id, role: 'user', content: 'I would prefer the quiet theme. The launch belongs on Friday.', createdAt: Date.now() });
  service.scheduleSemanticCheckpoint(chat);
  assert.equal(chat.memoryNeedsCheckpoint, true);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(chat.memoryNeedsCheckpoint, false);
  const canonical = chat.memory.facts.find(f => f.sourceMessageId === 'semantic-source').text;
  await service.chatMemoryCorrect(chat.id, canonical, 'Prefer the blue theme.');
  assert.equal(chat.memoryCorrections[canonical], 'Prefer the blue theme.');
  assert.ok(chat.memory.facts.some(f => f.text === canonical));
  assert.ok(chat.memory.facts.some(f => f.sourceMessageId === 'semantic-source' && f.text.includes('quiet theme')));
  const restart = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  assert.ok(restart.state.conversations.find(c => c.id === chat.id).memory.facts.some(f => f.text.includes('Friday')));
});

test('background semantic checkpoint rejects stale results and classifies changed source again', async t => {
  const { dir, repo, service } = makeService();
  t.after(() => { service.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  addProvider(repo);
  service.vault.has = () => true;
  service.vault.get = () => 'key';
  const chat = await coworkerChat(service);
  const source = { id: 'semantic-stale', conversationId: chat.id, role: 'user', content: 'Friday launch', createdAt: Date.now() };
  repo.appendMessages(source);
  let calls = 0;
  mockModel(t, async (_provider, _key, _request, emit) => {
    calls++;
    if (calls === 1) source.content = 'Monday launch';
    emit(JSON.stringify([{ kind: 'goal', text: calls === 1 ? 'Friday launch' : 'Monday launch', sourceMessageId: source.id }]));
    return {};
  });
  service.scheduleSemanticCheckpoint(chat);
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(calls, 2);
  assert.ok(chat.memory.facts.some(f => f.text === 'Monday launch'));
  assert.ok(!chat.memory.facts.some(f => f.text === 'Friday launch'));
});

test('a run that reaches its step limit asks once for a final answer and is marked stopped early', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  let steps = 0;
  let wrapUp;
  mockModel(t, async (_p, _k, req, onChunk) => {
    const last = req.messages.at(-1);
    if (last?.role === 'user' && /step limit/i.test(last.content)) {
      wrapUp = req;
      onChunk('Here is what I found so far.');
      return { toolCalls: [] };
    }
    if (req.messages.some((m) => m.content === 'Research the market')) {
      steps++;
      return { toolCalls: [{ id: `call-${steps}`, name: 'no_such_tool', arguments: JSON.stringify({ n: steps }) }] };
    }
    return {};
  });
  await service.chatSend(chat.id, 'Research the market', []);
  assert.equal(steps, 20);
  assert.ok(wrapUp, 'the model was asked for a final answer');
  const last = repo.conversationMessages(chat.id).findLast((m) => m.role === 'assistant');
  assert.equal(last.content, 'Here is what I found so far.');
  assert.equal(last.incomplete, 'step-limit');
  assert.match(last.notice, /20-step limit/);
  assert.equal(last.error, undefined);
  assert.equal(repo.state.tasks.find((task) => task.conversationId === chat.id).status, 'attention');
});

test('a run that ends with no reply, or only says what it will do, is marked stopped early', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  let reply = '';
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (reply && req.messages.at(-1)?.role === 'user') onChunk(reply);
    return { toolCalls: [] };
  });
  const lastReply = () => repo.conversationMessages(chat.id).findLast((m) => m.role === 'assistant');

  reply = '';
  await service.chatSend(chat.id, 'Write the plan', []);
  assert.equal(lastReply().incomplete, 'no-answer');
  assert.match(lastReply().notice, /without a reply/);

  reply = "I'll outline the ideal customer profile per vertical and check the guidance.";
  await service.chatSend(chat.id, 'Write the plan', []);
  assert.equal(lastReply().incomplete, 'preamble');

  reply = 'Here is the plan:\n\n1. Pick three verticals.\n2. Write the sequence.';
  await service.chatSend(chat.id, 'Write the plan', []);
  assert.equal(lastReply().incomplete, undefined);
  assert.equal(lastReply().notice, undefined);
  assert.equal(repo.state.tasks.find((task) => task.conversationId === chat.id).status, 'done');
});

test('"Notify me when done" sends one desktop notice when the run ends, leading back to the coworker', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const notices = [];
  service.attachShell({ notify: (notice) => notices.push(notice), windowVisible: () => true, applySettings() {} });
  const chat = await coworkerChat(service);
  // Nothing is running: there is nothing to wait for.
  assert.equal(await service.chatNotifyWhenDone(chat.id, true), false);
  let release;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (!req.messages.some((m) => m.content === 'Draft the launch email')) return {};
    await new Promise((resolve) => (release = resolve));
    onChunk('Here is the launch email.');
    return { toolCalls: [] };
  });
  const sent = service.chatSend(chat.id, 'Draft the launch email', []);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await service.chatNotifyWhenDone(chat.id, true), true);
  release();
  await sent;
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /is done$/);
  assert.equal(notices[0].body, 'Here is the launch email.');
  assert.deepEqual(notices[0].target, { agentId: 'backend-developer', conversationId: chat.id });
  // It was for that run only.
  mockModel(t, async (_p, _k, _req, onChunk) => {
    onChunk('Again.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Once more', []);
  assert.equal(notices.length, 1);
});
