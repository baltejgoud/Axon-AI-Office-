// Retry a coworker's reply, and edit a message you sent earlier: the cut itself (across page
// boundaries, with its bookkeeping), and the runs that carry on from it.
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
const rewrite = require('../src/shared/rewrite.ts');

const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-rewrite-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  return dir;
};
const open = (dir) => new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
const message = (i, conversationId = 'c', extra = {}) => ({
  id: `m${i}`,
  conversationId,
  role: i % 2 ? 'assistant' : 'user',
  content: `Message ${i}`,
  createdAt: i,
  ...extra
});
const conversation = (id, extra = {}) => ({
  id,
  title: id,
  workspaceId: null,
  providerId: 'p1',
  modelId: 'm1',
  skillIds: [],
  roleIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra
});
const manifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'db', 'platform-v1.json'), 'utf8')).messagePages;
const countsFor = (dir, id) => manifest(dir).filter((ref) => ref.conversationId === id).map((ref) => ref.count);
const ids = (repo, id) => repo.conversationMessages(id).map((m) => m.id);
const range = (from, to) => Array.from({ length: to - from }, (_, i) => `m${from + i}`);

/** 150 messages in c (pages of 100 + 50) and three in another conversation, saved and reopened cold. */
async function seeded() {
  const dir = temp();
  let repo = open(dir);
  repo.state.conversations.push(conversation('c'), conversation('other'));
  repo.state.messages.push(...Array.from({ length: 150 }, (_, i) => message(i)), ...[0, 1, 2].map((i) => message(i, 'other', { id: `o${i}` })));
  await repo.save();
  assert.deepEqual(countsFor(dir, 'c'), [100, 50]);
  repo = open(dir);
  return { dir, repo };
}

test('cutting after message 119 keeps 120 and rewrites the manifest across the page boundary', async () => {
  const { dir, repo } = await seeded();
  try {
    const removed = repo.truncateMessages('c', 'm119', { inclusive: false });
    assert.equal(removed.length, 30);
    assert.equal(removed[0].id, 'm120');
    assert.deepEqual(ids(repo, 'c'), range(0, 120));
    assert.equal(repo.historyPage('c').total, 120);
    await repo.save();
    assert.deepEqual(countsFor(dir, 'c'), [100, 20]);
    const again = open(dir);
    assert.deepEqual(ids(again, 'c'), range(0, 120));
    assert.equal(again.historyPage('c', 100, 100).messages.length, 100);
    assert.deepEqual(ids(again, 'other'), ['o0', 'o1', 'o2'], 'other conversations are untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cutting at and around the page boundary (99, 100) leaves whole, valid pages', async () => {
  for (const [from, inclusive, kept, pages] of [
    ['m99', false, 100, [100]], // exactly one full page
    ['m99', true, 99, [99]], // the boundary message itself goes
    ['m100', false, 101, [100, 1]],
    ['m100', true, 100, [100]],
    ['m0', true, 0, []] // everything
  ]) {
    const { dir, repo } = await seeded();
    try {
      repo.truncateMessages('c', from, { inclusive });
      await repo.save();
      assert.deepEqual(countsFor(dir, 'c'), pages, `${from} inclusive=${inclusive}`);
      const again = open(dir);
      assert.deepEqual(ids(again, 'c'), range(0, kept));
      assert.equal(again.historyPage('c').total, kept);
      assert.deepEqual(ids(again, 'other'), ['o0', 'o1', 'o2']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('old pages stay on disk, so an older restore point still opens', async () => {
  const { dir, repo } = await seeded();
  try {
    const before = manifest(dir);
    repo.truncateMessages('c', 'm119', { inclusive: false });
    await repo.save();
    const pagesDir = path.join(dir, 'db', 'message-pages');
    for (const ref of before) assert.ok(fs.existsSync(path.join(pagesDir, `${ref.hash}.json`)), 'a page the old manifest names is still there');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with every message already in memory the cut is made in place and saved the same way', async () => {
  const { dir, repo } = await seeded();
  try {
    const all = repo.state.messages; // reading them all switches to in-memory mode
    assert.equal(all.length, 153);
    repo.truncateMessages('c', 'm120', { inclusive: true });
    assert.equal(repo.state.messages, all, 'the same array');
    assert.equal(all.length, 123);
    await repo.save();
    assert.deepEqual(countsFor(dir, 'c'), [100, 20]);
    assert.deepEqual(ids(open(dir), 'c'), range(0, 120));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a cut that cannot be written changes nothing', async () => {
  const { dir, repo } = await seeded();
  try {
    const pagesDir = path.join(dir, 'db', 'message-pages');
    assert.equal(repo.conversationMessages('c').length, 150); // read before the disk goes bad
    fs.rmSync(pagesDir, { recursive: true, force: true });
    fs.writeFileSync(pagesDir, 'not a folder'); // no page can be written any more
    assert.throws(() => repo.truncateMessages('c', 'm110', { inclusive: false }));
    assert.deepEqual(ids(repo, 'c'), range(0, 150));
    assert.throws(() => repo.truncateMessages('c', 'nope', { inclusive: false }), /no longer in this conversation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the first system message is never cut away', async () => {
  const dir = temp();
  try {
    const repo = open(dir);
    repo.state.conversations.push(conversation('c'));
    repo.appendMessages({ ...message(0), id: 's', role: 'system' }, message(2), message(3));
    assert.throws(() => repo.truncateMessages('c', 's', { inclusive: true }), /instructions/);
    repo.truncateMessages('c', 's', { inclusive: false });
    assert.deepEqual(ids(repo, 'c'), ['s']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memory and attachments no longer point at messages that were cut away', async () => {
  const dir = temp();
  try {
    let repo = open(dir);
    const block = (id) => `\n\n<attachment name="${id}.txt" attachmentId="${id}">\nfirst lines\n[Full document ingested.]\n</attachment>`;
    repo.state.conversations.push(
      conversation('c', {
        attachmentRefs: [
          { id: 'old', name: 'old.txt' },
          { id: 'gone', name: 'gone.txt' },
          { id: 'edited', name: 'edited.txt' }
        ],
        memory: {
          updatedAt: 1,
          sourceMessageIds: ['m0', 'm1', 'm2', 'm3'],
          sourceHashes: { m0: 'a', m1: 'b', m2: 'c', m3: 'd' },
          facts: [
            { kind: 'constraint', text: 'kept fact', sourceTurn: 0, sourceMessageId: 'm0' },
            { kind: 'decision', text: 'removed fact', sourceTurn: 1, sourceMessageId: 'm3' },
            { kind: 'goal', text: 'unsourced fact', sourceTurn: 0 }
          ]
        }
      })
    );
    repo.appendMessages(
      { ...message(0), content: `Look at this${block('old')}` },
      message(1),
      { ...message(2), content: `And this${block('gone')}` },
      message(3)
    );
    // The edit being sent carries `edited` along, though the message that brought it is cut away.
    repo.truncateMessages('c', 'm2', { inclusive: true, keepAttachmentIds: ['edited'] });
    const chat = repo.state.conversations[0];
    assert.deepEqual(chat.attachmentRefs.map((ref) => ref.id), ['old', 'edited']);
    assert.deepEqual(chat.memory.sourceMessageIds, ['m0', 'm1']);
    assert.deepEqual(chat.memory.sourceHashes, { m0: 'a', m1: 'b' });
    assert.deepEqual(chat.memory.facts.map((f) => f.text), ['kept fact', 'unsourced fact']);
    assert.equal(chat.memoryNeedsCheckpoint, true, 'memory is read again');
    await repo.save();
    repo = open(dir);
    const saved = repo.state.conversations[0];
    assert.deepEqual(saved.memory.sourceMessageIds, ['m0', 'm1']);
    assert.deepEqual(saved.attachmentRefs.map((ref) => ref.id), ['old', 'edited']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a cut that touches no memory leaves the conversation record alone', async () => {
  const dir = temp();
  try {
    const repo = open(dir);
    repo.state.conversations.push(conversation('c', { memory: { updatedAt: 1, sourceMessageIds: ['m0'], facts: [] } }));
    repo.appendMessages(message(0), message(1), message(2));
    const before = repo.state.conversations[0].memory;
    repo.truncateMessages('c', 'm1', { inclusive: false });
    assert.equal(repo.state.conversations[0].memory, before);
    assert.equal(repo.state.conversations[0].memoryNeedsCheckpoint, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shared helpers: the blocks after your words, the attachments they name, and who may be edited', () => {
  const content = 'Please review.\n\nSecond paragraph.\n\n<attachment name="a \\"b\\".txt" attachmentId="att-1">\nbody\n</attachment>\n\n<file path="src/x.ts">\ncode\n</file>';
  assert.equal(rewrite.userBlocks(content).startsWith('\n\n<attachment'), true);
  assert.equal(rewrite.userBlocks('Just words'), '');
  assert.deepEqual(rewrite.attachmentIdsIn(content), ['att-1']);
  assert.deepEqual(rewrite.attachmentIdsIn('mentions attachmentId="x" in plain words'), [], 'only real blocks count');
  assert.equal(rewrite.writtenByYou({ role: 'user' }), true);
  assert.equal(rewrite.writtenByYou({ role: 'user', from: 'Chief of Staff' }), false);
  assert.equal(rewrite.writtenByYou({ role: 'assistant' }), false);
  const teams = [{ plan: { assignments: [{ conversationId: 'worker' }, {}] } }, {}];
  assert.equal(rewrite.isTeamTask(teams, 'worker'), true);
  assert.equal(rewrite.isTeamTask(teams, 'lead'), false);
  const call = (change) => ({ id: 'x', name: 'write_file', arguments: '{}', change });
  const messages = [
    { role: 'user' },
    { role: 'assistant', toolCalls: [call({ revertedAt: 5 }), call({}), { id: 'y', name: 'read_file', arguments: '{}' }] },
    { role: 'assistant', toolCalls: [call({})] }
  ];
  assert.equal(rewrite.filesChangedAfter(messages, 1), 2, 'undone changes do not count');
  assert.equal(rewrite.filesChangedAfter(messages, 2), 1);
  assert.equal(rewrite.filesChangedAfter(messages, 3), 0);
});

/* -------------------------------- the service -------------------------------- */

const makeService = (emit = () => {}) => {
  const dir = temp();
  const repo = open(dir);
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
const coworkerChat = (service, agentId = 'backend-developer') =>
  service.chatCreate('p1', 'm1', null, agentId, { skillIds: [], roleIds: [] }, null, `You are Axon's ${agentId}.`);
/** The model answers each turn with the next reply in `replies`, and remembers the requests it was sent. */
const mockModel = (t, replies) => {
  const providersModule = require('../src/main/providers.ts');
  const originalStream = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = originalStream;
  });
  const requests = [];
  providersModule.streamChat = async (provider, _key, req, onChunk) => {
    requests.push({ provider: provider.id, model: req.model, messages: req.messages.map((m) => ({ ...m })), system: req.system });
    const reply = typeof replies === 'function' ? replies(requests.length, req) : replies[requests.length - 1];
    if (reply?.toolCalls) return { toolCalls: reply.toolCalls };
    onChunk(reply ?? '');
    return { toolCalls: [] };
  };
  return requests;
};
const roles = (repo, id) => repo.conversationMessages(id).map((m) => m.role);
const userTurns = (repo, id) => repo.conversationMessages(id).filter((m) => m.role === 'user');

test('retry answers your last message again, without a second copy of it', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  const requests = mockModel(t, ['Plan v1', 'Plan v2']);
  await service.chatSend(chat.id, 'Write the plan', []);
  const asked = userTurns(repo, chat.id)[0];
  const firstReply = repo.conversationMessages(chat.id).findLast((m) => m.role === 'assistant');
  assert.equal(firstReply.content, 'Plan v1');
  await service.chatRetry(chat.id);

  const messages = repo.conversationMessages(chat.id);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant']);
  assert.equal(userTurns(repo, chat.id).length, 1, 'your message is not duplicated');
  assert.equal(userTurns(repo, chat.id)[0].id, asked.id, 'it is the very same message');
  const reply = messages.at(-1);
  assert.equal(reply.content, 'Plan v2');
  assert.notEqual(reply.id, firstReply.id);
  assert.ok(!reply.streaming);
  assert.ok(!messages.some((m) => m.id === firstReply.id), 'the old reply is gone');
  // The model saw your message once, last, and nothing of the reply it is replacing.
  const retried = requests[1];
  assert.deepEqual(retried.messages.map((m) => [m.role, m.content]), [['user', 'Write the plan']]);
  assert.equal(retried.messages[0].sourceMessageId, asked.id);
  assert.deepEqual([retried.provider, retried.model], ['p1', 'm1'], 'same provider and model');
  assert.equal(repo.state.tasks.find((task) => task.conversationId === chat.id).status, 'done');
});

test('retry replaces a run of tool work and keeps what came before your last message', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, (n, req) => {
    const last = req.messages.at(-1);
    if (n === 2 && last.role === 'user') return { toolCalls: [{ id: 'call-1', name: 'no_such_tool', arguments: '{}' }] };
    return n === 1 ? 'First answer.' : n === 3 ? 'Used a tool.' : 'Second try.';
  });
  await service.chatSend(chat.id, 'First question', []);
  await service.chatSend(chat.id, 'Second question', []);
  assert.ok(roles(repo, chat.id).includes('tool'));
  await service.chatRetry(chat.id);
  const messages = repo.conversationMessages(chat.id);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(messages[2].content, 'First answer.');
  assert.equal(messages.at(-1).content, 'Second try.');
  assert.ok(!messages.some((m) => m.toolCalls?.length || m.role === 'tool'));
});

test('the window is told to read the conversation again, and the saved copy survives a restart', async (t) => {
  const events = [];
  const { dir, repo, service } = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, ['One', 'Two']);
  await service.chatSend(chat.id, 'Question', []);
  assert.equal(events.filter((event) => event.rewritten).length, 0, 'a plain send is not a rewrite');
  await service.chatRetry(chat.id);
  const told = events.filter((event) => event.rewritten);
  assert.equal(told.length, 1);
  assert.equal(told[0].conversationId, chat.id);
  const live = repo.conversationMessages(chat.id).map((m) => [m.id, m.content]);
  const again = open(dir);
  assert.deepEqual(again.conversationMessages(chat.id).map((m) => [m.id, m.content]), live);
  assert.equal(again.conversationMessages(chat.id).at(-1).content, 'Two');
});

test('retry is refused with nothing to retry, no reply yet, or a teammate\'s message', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  const requests = mockModel(t, ['unused']);
  await assert.rejects(service.chatRetry(chat.id), /nothing to ask again/);
  repo.appendMessages({ id: 'u1', conversationId: chat.id, role: 'user', content: 'Hello', createdAt: 1 });
  await assert.rejects(service.chatRetry(chat.id), /no reply to replace/);
  repo.appendMessages({ id: 'u2', conversationId: chat.id, role: 'user', content: 'Brief', from: 'Chief of Staff', createdAt: 2 }, { id: 'a2', conversationId: chat.id, role: 'assistant', content: 'On it', createdAt: 3 });
  await assert.rejects(service.chatRetry(chat.id), /teammate/);
  await assert.rejects(service.chatRetry('no-such-chat'), /not found/);
  assert.deepEqual(repo.conversationMessages(chat.id).map((m) => m.id).slice(1), ['u1', 'u2', 'a2'], 'nothing was removed');
  assert.equal(requests.length, 0, 'the model was never asked');
});

test('nothing is rewritten while they are working, waiting on an approval, or a message is queued', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  let release;
  let requests = 0;
  const providersModule = require('../src/main/providers.ts');
  const originalStream = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = originalStream;
  });
  providersModule.streamChat = async (_p, _k, _req, onChunk) => {
    requests++;
    if (requests > 1) await new Promise((resolve) => (release = resolve));
    onChunk(`Answer ${requests}`);
    return { toolCalls: [] };
  };
  await service.chatSend(chat.id, 'Question', []);
  const settled = repo.conversationMessages(chat.id).map((m) => m.id);
  const running = service.chatSend(chat.id, 'Another question', []);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  const during = repo.conversationMessages(chat.id).map((m) => m.id);
  await assert.rejects(service.chatRetry(chat.id), /still working/);
  await assert.rejects(service.chatEdit(chat.id, settled[1], 'Changed'), /still working/);
  assert.deepEqual(repo.conversationMessages(chat.id).map((m) => m.id), during, 'the running conversation is untouched');
  release();
  await running;

  // A step waiting on you.
  const waiting = service.permissions.createApprovalRequest({ conversationId: chat.id, messageId: 'x', toolCallId: 't', toolName: 'write_file', args: {} });
  await assert.rejects(service.chatRetry(chat.id), /waiting for your OK/);
  await assert.rejects(service.chatEdit(chat.id, settled[1], 'Changed'), /waiting for your OK/);
  service.permissions.withdraw(waiting.request.id);

  // A message queued for their next step.
  service.queued.set(chat.id, ['later']);
  await assert.rejects(service.chatRetry(chat.id), /waiting for them/);
  service.queued.delete(chat.id);
  assert.equal(requests, 2);
  release = undefined;
  providersModule.streamChat = async (_p, _k, _req, onChunk) => {
    onChunk('Fine now');
    return { toolCalls: [] };
  };
  await service.chatRetry(chat.id);
  assert.equal(repo.conversationMessages(chat.id).at(-1).content, 'Fine now');
});

test('a team member\'s task conversation is not rewritten, and neither is a team that is still meeting', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const worker = await coworkerChat(service, 'frontend-developer');
  const lead = await coworkerChat(service, 'chief-of-staff');
  repo.appendMessages(
    { id: 'w1', conversationId: worker.id, role: 'user', content: 'Your task', createdAt: 1 },
    { id: 'w2', conversationId: worker.id, role: 'assistant', content: 'Done', createdAt: 2 },
    { id: 'l1', conversationId: lead.id, role: 'user', content: 'Plan it', createdAt: 1 },
    { id: 'l2', conversationId: lead.id, role: 'assistant', content: 'Meeting called', createdAt: 2 }
  );
  repo.state.teams.push({
    id: 't1', leadId: 'chief-of-staff', conversationId: lead.id, goal: 'g', attendees: [], providerId: 'p1', modelId: 'm1',
    status: 'working', minutes: [], createdAt: 0, updatedAt: 0,
    plan: { assignments: [{ id: 'a1', ownerId: 'frontend-developer', title: 't', brief: 'b', dependsOn: [], files: [], status: 'working', conversationId: worker.id }] }
  });
  const requests = mockModel(t, ['unused']);
  await assert.rejects(service.chatRetry(worker.id), /team member's task/);
  await assert.rejects(service.chatEdit(worker.id, 'w1', 'Changed'), /team member's task/);
  await assert.rejects(service.chatRetry(lead.id), /still working/);
  await assert.rejects(service.chatEdit(lead.id, 'l1', 'Changed'), /still working/);
  repo.state.teams[0].status = 'done';
  await service.chatRetry(lead.id); // a finished team no longer holds the lead's conversation
  assert.equal(requests.length, 1);
  assert.deepEqual(repo.conversationMessages(worker.id).map((m) => m.id).slice(1), ['w1', 'w2']);
});

test('edit replaces your message and everything after it, and sends the new words', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  const requests = mockModel(t, ['Reply 1', 'Reply 2', 'Reply 3', 'Reply to the edit']);
  await service.chatSend(chat.id, 'Question one', []);
  await service.chatSend(chat.id, 'Question two', []);
  await service.chatSend(chat.id, 'Question three', []);
  const [first, second] = userTurns(repo, chat.id);
  const keptReply = repo.conversationMessages(chat.id).find((m) => m.content === 'Reply 1');
  const everyone = repo.conversationMessages(chat.id).map((m) => m.id);
  const stored = repo.state.conversations.find((c) => c.id === chat.id);
  stored.memory = {
    updatedAt: 1,
    sourceMessageIds: everyone,
    sourceHashes: Object.fromEntries(everyone.map((id) => [id, 'h'])),
    facts: [
      { kind: 'constraint', text: 'Question one', sourceTurn: 0, sourceMessageId: first.id },
      { kind: 'constraint', text: 'Question two', sourceTurn: 1, sourceMessageId: second.id }
    ]
  };

  await service.chatEdit(chat.id, second.id, 'Question two, reworded');

  // Memory no longer names anything that was cut away.
  const remaining = new Set(repo.conversationMessages(chat.id).map((m) => m.id));
  assert.ok(stored.memory.sourceMessageIds.every((id) => remaining.has(id)));
  assert.ok(Object.keys(stored.memory.sourceHashes).every((id) => remaining.has(id)));
  assert.deepEqual(stored.memory.facts.map((f) => f.text), ['Question one']);

  const messages = repo.conversationMessages(chat.id);
  assert.deepEqual(messages.map((m) => m.content), ['You are Axon\'s backend-developer.', 'Question one', 'Reply 1', 'Question two, reworded', 'Reply to the edit']);
  assert.equal(messages[1].id, first.id);
  assert.equal(messages[2].id, keptReply.id);
  assert.notEqual(messages[3].id, second.id, 'it is a new message');
  assert.equal(messages[3].role, 'user');
  assert.equal(messages[3].from, undefined);
  // The model got the earlier turns, then the edited message once, and none of the replies that were replaced.
  assert.deepEqual(requests[3].messages.map((m) => [m.role, m.content]), [['user', 'Question one'], ['assistant', 'Reply 1'], ['user', 'Question two, reworded']]);
  assert.equal(requests[3].messages.at(-1).sourceMessageId, messages[3].id);
  assert.deepEqual(open(dir).conversationMessages(chat.id).map((m) => m.id), messages.map((m) => m.id), 'saved');
});

test('edit keeps the original\'s attachment and file blocks, and the attachments they name', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  const requests = mockModel(t, ['Read it.', 'Read both.', 'Read the notes again.']);
  const blocks = '\n\n<attachment name="notes.txt" attachmentId="att-1">\nfirst lines\n[Full document ingested. Use read_attachment with attachmentId att-1 for relevant sections.]\n</attachment>\n\n<file path="src/app.ts">\nexport {};\n</file>';
  const later = '\n\n<attachment name="later.txt" attachmentId="att-2">\nlater lines\n</attachment>';
  const stored = repo.state.conversations.find((c) => c.id === chat.id);
  stored.attachmentRefs = [{ id: 'att-1', name: 'notes.txt' }, { id: 'att-2', name: 'later.txt' }];
  repo.appendMessages(
    { id: 'u1', conversationId: chat.id, role: 'user', content: `Summarise the notes.${blocks}`, createdAt: 1 },
    { id: 'a1', conversationId: chat.id, role: 'assistant', content: 'Summary.', createdAt: 2 },
    { id: 'u2', conversationId: chat.id, role: 'user', content: `And these too.${later}`, createdAt: 3 },
    { id: 'a2', conversationId: chat.id, role: 'assistant', content: 'Both.', createdAt: 4 }
  );

  await service.chatEdit(chat.id, 'u1', 'Summarise the notes in three bullets.');

  const messages = repo.conversationMessages(chat.id);
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user', 'assistant']);
  assert.equal(messages[1].content, `Summarise the notes in three bullets.${blocks}`, 'new words, same blocks');
  assert.deepEqual(stored.attachmentRefs, [{ id: 'att-1', name: 'notes.txt' }], 'the attachment that was cut away is no longer readable');
  assert.equal(requests[0].messages.at(-1).content.includes('Summarise the notes in three bullets.'), true);
  assert.equal(requests[0].messages.length, 1);
  assert.ok(!stored.attachmentRefs.some((ref) => ref.id === 'att-2'));
  // The kept attachment can still be read by the model in the conversation that continues.
  assert.equal(stored.attachmentRefs.some((ref) => ref.id === 'att-1'), true);
  // And the edit can be edited again, still carrying the same blocks.
  await service.chatEdit(chat.id, messages[1].id, 'Just the first bullet.');
  assert.equal(repo.conversationMessages(chat.id)[1].content, `Just the first bullet.${blocks}`);
  assert.deepEqual(stored.attachmentRefs, [{ id: 'att-1', name: 'notes.txt' }]);
});

test('edit is only for messages you wrote, with words in them', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  repo.appendMessages(
    { id: 'b1', conversationId: chat.id, role: 'user', content: 'Brief', from: 'Chief of Staff', createdAt: 1 },
    { id: 'r1', conversationId: chat.id, role: 'assistant', content: 'Reply', createdAt: 2 },
    { id: 'u1', conversationId: chat.id, role: 'user', content: 'Mine', createdAt: 3 },
    { id: 'r2', conversationId: chat.id, role: 'assistant', content: 'Reply two', createdAt: 4 }
  );
  const requests = mockModel(t, ['unused']);
  await assert.rejects(service.chatEdit(chat.id, 'b1', 'Changed'), /only messages you wrote/i);
  await assert.rejects(service.chatEdit(chat.id, 'r1', 'Changed'), /only messages you wrote/i);
  await assert.rejects(service.chatEdit(chat.id, 'missing', 'Changed'), /no longer in this conversation/);
  await assert.rejects(service.chatEdit(chat.id, 'u1', '   '), /cannot be empty/);
  await assert.rejects(service.chatEdit(chat.id, 'u1', 'x'.repeat(60001)), /Invalid text/);
  await assert.rejects(service.chatEdit(chat.id, 'u1', 42), /Invalid text/);
  assert.deepEqual(repo.conversationMessages(chat.id).map((m) => m.id).slice(1), ['b1', 'r1', 'u1', 'r2']);
  assert.equal(requests.length, 0);
});

test('a retry that cannot start costs nothing: the replies it was to replace are still there', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, ['Answer']);
  await service.chatSend(chat.id, 'Question', []);
  const before = repo.conversationMessages(chat.id).map((m) => m.id);
  repo.state.providers[0].enabled = false; // the model is no longer available
  await assert.rejects(service.chatRetry(chat.id), /model is unavailable/);
  await assert.rejects(service.chatEdit(chat.id, before[1], 'Changed'), /model is unavailable/);
  assert.deepEqual(repo.conversationMessages(chat.id).map((m) => m.id), before);
  assert.equal(service.runs.has(chat.id), false, 'no run is left claimed');
});

test('a failing model leaves the retried turn with its error, ready to retry again', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  mockModel(t, ['Answer']);
  await service.chatSend(chat.id, 'Question', []);
  const providersModule = require('../src/main/providers.ts');
  providersModule.streamChat = async () => {
    throw new Error('Provider is down');
  };
  await service.chatRetry(chat.id);
  const last = repo.conversationMessages(chat.id).at(-1);
  assert.equal(last.role, 'assistant');
  assert.match(last.error, /./);
  assert.equal(userTurns(repo, chat.id).length, 1);
  providersModule.streamChat = async (_p, _k, _req, onChunk) => {
    onChunk('Back again');
    return { toolCalls: [] };
  };
  await service.chatRetry(chat.id);
  assert.equal(repo.conversationMessages(chat.id).at(-1).content, 'Back again');
  assert.equal(userTurns(repo, chat.id).length, 1);
});

test('files a removed reply changed stay changed, and their undo records are kept', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  const chat = await coworkerChat(service);
  await service.checkpoints.save({ toolCallId: 'call-w', conversationId: chat.id, root: dir, path: 'notes.txt', existed: true, before: 'old', afterHash: 'h' });
  repo.appendMessages(
    { id: 'u1', conversationId: chat.id, role: 'user', content: 'Edit the notes', createdAt: 1 },
    { id: 'a1', conversationId: chat.id, role: 'assistant', content: '', createdAt: 2, toolCalls: [{ id: 'call-w', name: 'write_file', arguments: '{}', change: { added: 1, removed: 0, created: false, undo: 'kept' } }] },
    { id: 't1', conversationId: chat.id, role: 'tool', toolCallId: 'call-w', content: 'Wrote notes.txt', createdAt: 3 },
    { id: 'a2', conversationId: chat.id, role: 'assistant', content: 'Done', createdAt: 4 }
  );
  mockModel(t, ['Again']);
  await service.chatRetry(chat.id);
  assert.ok(!repo.conversationMessages(chat.id).some((m) => m.toolCalls?.length || m.role === 'tool'));
  assert.equal((await service.checkpoints.get('call-w')).path, 'notes.txt', 'the undo record is still there');
});
