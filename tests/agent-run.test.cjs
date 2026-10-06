// A run as the user lives it: messages sent while a coworker works, calls that can't work, and edits that can be undone.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
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
const providers = require('../src/main/providers.ts');

/** A service with one provider and a project folder, removed after the test. */
async function setup(t, files = {}) {
  const events = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, (event) => events.push(event), 'parser-worker-path');
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
  const folder = path.join(dir, 'project');
  fs.mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
  await service.project.choose(folder);
  const chat = await service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  return { service, repo, events, folder, chat };
}

/** Stands in for the model; each call gets what was sent, and answers with the next reply. */
function mockModel(t, respond) {
  const saved = providers.streamChat;
  t.after(() => {
    providers.streamChat = saved;
  });
  const sent = [];
  providers.streamChat = async (_p, _k, req, onChunk) => {
    sent.push(req.messages.map((m) => ({ role: m.role, content: m.content })));
    return respond(sent.length, req, onChunk);
  };
  return sent;
}

async function waitFor(find, what) {
  for (let i = 0; i < 300; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** A promise you open later: the model "thinks" until the test says so. */
function gate() {
  let open;
  const shut = new Promise((resolve) => {
    open = resolve;
  });
  return { shut, open };
}

test('a message sent while the coworker works reaches them at their next step, not an error', async (t) => {
  const { service, repo, chat } = await setup(t, { 'a.txt': 'hello' });
  const thinking = gate();
  const sent = mockModel(t, async (n) => {
    if (n === 1) {
      await thinking.shut;
      return { toolCalls: [{ id: 'r1', name: 'read_file', arguments: '{"path":"a.txt"}' }] };
    }
    return { toolCalls: [] };
  });
  const first = service.chatSend(chat.id, 'Read a.txt', []);
  await waitFor(() => sent.length === 1, 'the first call');
  await service.chatSend(chat.id, 'Also check b.txt', []);
  thinking.open();
  await first;
  await waitFor(() => sent.length === 2 && !service.runs.has(chat.id), 'the run to end');
  assert.deepEqual(
    sent[1].slice(-2).map((m) => m.role),
    ['tool', 'user']
  );
  assert.equal(sent[1].at(-1).content, 'Also check b.txt');
  // Saved in the order it was read: after the tool's answer, never between a call and its answer.
  const roles = repo.state.messages.filter((m) => m.conversationId === chat.id).map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'tool', 'user', 'assistant']);
});

test('a message sent as the coworker finishes starts their next run', async (t) => {
  const { service, chat } = await setup(t);
  const thinking = gate();
  const sent = mockModel(t, async (n, _req, onChunk) => {
    if (n === 1) await thinking.shut;
    onChunk(`answer ${n}`);
    return { toolCalls: [] };
  });
  const first = service.chatSend(chat.id, 'One', []);
  await waitFor(() => sent.length === 1, 'the first call');
  await service.chatSend(chat.id, 'Two', []);
  thinking.open();
  await first;
  await waitFor(() => sent.length === 2 && !service.runs.has(chat.id), 'the second run');
  assert.equal(sent[1].at(-1).content, 'Two');
});

test('Stop cancels queued messages instead of launching zombie work', async (t) => {
  const { service, chat } = await setup(t);
  const thinking = gate();
  const sent = mockModel(t, async (n, req) => {
    if (n === 1)
      await new Promise((_, reject) =>
        req.signal.addEventListener('abort', () => reject(new Error('Generation stopped.')))
      );
    return { toolCalls: [] };
  });
  const first = service.chatSend(chat.id, 'Long job', []);
  await waitFor(() => sent.length === 1, 'the first call');
  await service.chatSend(chat.id, 'Do this instead', []);
  service.chatStop(chat.id);
  thinking.open();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 1);
  assert.equal(service.runs.has(chat.id), false);
  assert.equal(service.queued.has(chat.id), false);
});

test('a call missing its path goes back to the model and never reaches an approval card', async (t) => {
  const { service, repo, events, chat } = await setup(t);
  mockModel(t, async (n) =>
    n === 1
      ? { toolCalls: [{ id: 'w', name: 'write_file', arguments: '{"content":"x"}' }] }
      : { toolCalls: [] }
  );
  await service.chatSend(chat.id, 'Write it', []);
  assert.ok(!events.some((e) => e.approvalRequired), 'nothing to approve');
  const result = repo.state.messages.find((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.match(result.content, /'path'/);
});

test('an edit that cannot apply goes back to the model before anyone is asked', async (t) => {
  const { service, repo, events, chat } = await setup(t, { 'a.txt': 'one\n' });
  mockModel(t, async (n) =>
    n === 1
      ? {
          toolCalls: [
            {
              id: 'e',
              name: 'edit_file',
              arguments: JSON.stringify({ path: 'a.txt', old_string: 'two', new_string: '2' })
            }
          ]
        }
      : { toolCalls: [] }
  );
  await service.chatSend(chat.id, 'Edit it', []);
  assert.ok(!events.some((e) => e.approvalRequired), 'nothing to approve');
  assert.match(repo.state.messages.find((m) => m.role === 'tool').content, /not found/);
});

test('an approved edit can be undone, and undo knows the file is as the edit left it', async (t) => {
  const { service, repo, events, folder, chat } = await setup(t, { 'a.txt': 'one\ntwo\n' });
  mockModel(t, async (n) =>
    n === 1
      ? {
          toolCalls: [
            {
              id: 'e1',
              name: 'edit_file',
              arguments: JSON.stringify({ path: 'a.txt', old_string: 'two', new_string: 'TWO' })
            }
          ]
        }
      : { toolCalls: [] }
  );
  const run = service.chatSend(chat.id, 'Edit it', []);
  const request = await waitFor(
    () => events.find((e) => e.approvalRequired)?.approvalRequired,
    'the approval'
  );
  assert.equal(request.preview.type, 'diff');
  await service.toolApprove({ requestId: request.id, approved: true });
  await run;
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'one\nTWO\n');
  const call = repo.state.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === 'e1');
  assert.equal(call.change.undo, 'kept');
  let asked = null;
  electron.dialog.showMessageBox = async (options) => {
    asked = options;
    return { response: 1 };
  };
  t.after(() => {
    delete electron.dialog.showMessageBox;
  });
  await service.revertChange('e1');
  assert.doesNotMatch(asked.detail ?? '', /changed since/);
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'one\ntwo\n');
  assert.ok(service.audit.all().some((e) => e.tool === 'edit_file' && e.result === 'ok'));
});

/** Replaces fetch for one test; returns the parsed request bodies it saw. */
function mockFetch(t, body) {
  const saved = global.fetch;
  const bodies = [];
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(body);
  };
  t.after(() => {
    global.fetch = saved;
  });
  return bodies;
}
const afterTools = [
  { role: 'user', content: 'Read a' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: '{"path":"a"}' }] },
  { role: 'tool', toolCallId: 'a', content: 'A' },
  { role: 'user', content: 'Also b' }
];

test('Anthropic: a message sent mid-run joins the tool results in one user turn', async (t) => {
  const bodies = mockFetch(
    t,
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n'
  );
  await providers.streamChat(
    { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: [] },
    'k',
    { model: 'm', maxTokens: 10, messages: afterTools },
    () => {}
  );
  const sent = bodies[0].messages;
  assert.deepEqual(
    sent.map((m) => m.role),
    ['user', 'assistant', 'user']
  );
  assert.deepEqual(
    sent[2].content.map((b) => b.type),
    ['tool_result', 'text']
  );
  assert.equal(sent[2].content[1].text, 'Also b');
});

test('Gemini: a message sent mid-run joins the function answers in one user turn', async (t) => {
  const bodies = mockFetch(t, 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n');
  await providers.streamChat(
    { kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [] },
    'k',
    { model: 'g', maxTokens: 10, messages: afterTools },
    () => {}
  );
  const contents = bodies[0].contents;
  assert.deepEqual(
    contents.map((c) => c.role),
    ['user', 'model', 'user']
  );
  assert.ok(contents[2].parts[0].functionResponse);
  assert.equal(contents[2].parts[1].text, 'Also b');
});
