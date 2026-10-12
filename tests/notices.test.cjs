// The notification bell: what it lists (steps and questions waiting, tasks that ended, teams' plans and
// reports), how long ago, and what it remembers between sessions about what you have looked at.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {} };
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
const n = require('../src/renderer/src/features/office/notices.ts');

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const conversations = [
  { id: 'c-api', agentId: 'backend-developer', title: 'API' },
  { id: 'c-research', agentId: 'research-analyst', title: 'Research' },
  { id: 'c-lead', agentId: 'chief-of-staff', title: 'Launch' }
];
const work = (over) => ({ id: 't1', kind: 'work', title: 'Build the API', status: 'working', coworkerId: 'backend-developer', conversationId: 'c-api', createdAt: 0, updatedAt: NOW - HOUR, ...over });
const derive = (over = {}) => n.deriveNotices({ approvals: [], tasks: [], teams: [], runs: [], conversations, now: NOW, ...over });

test('a step waiting for you says who, what it could do, and what it is about', () => {
  const step = { id: 'r1', conversationId: 'c-api', messageId: 'm', toolCallId: 'tc', toolName: 'write_file', arguments: { path: 'src/app.ts' }, createdAt: NOW - 2 * MIN };
  const [notice] = derive({ approvals: [step] });
  assert.deepEqual(notice, {
    id: 'approval:r1',
    kind: 'approval',
    agentId: 'backend-developer',
    conversationId: 'c-api',
    who: 'Backend Developer',
    title: 'Needs your OK',
    what: 'Changes files: src/app.ts',
    at: NOW - 2 * MIN
  });
  const command = { ...step, id: 'r2', toolName: 'run_command', arguments: { command: 'npm test' }, preview: { type: 'command', content: 'npm test' } };
  assert.equal(derive({ approvals: [command] })[0].what, 'Runs a command: npm test');
  const connector = { ...step, id: 'r3', toolName: 'mcp_notion_create_page', arguments: {} };
  const servers = [{ name: 'Notion', tools: [{ axonName: 'mcp_notion_create_page' }] }];
  assert.equal(derive({ approvals: [connector], servers })[0].what, 'Uses Notion');
});

test('a question for you is listed with its words', () => {
  const question = { id: 'q1', conversationId: 'c-research', messageId: 'm', toolCallId: 'tc', toolName: 'ask_user', arguments: {}, createdAt: NOW - MIN, question: { text: 'Which   market first?', options: ['UK', 'US'], allowOther: true } };
  const [notice] = derive({ approvals: [question] });
  assert.equal(notice.kind, 'question');
  assert.equal(notice.id, 'question:q1');
  assert.equal(notice.who, 'Research Analyst');
  assert.equal(notice.title, 'Has a question for you');
  assert.equal(notice.what, 'Which market first?');
});

test('a request in a conversation nobody in the office owns is left out, since it could not be opened', () => {
  const stray = { id: 'r9', conversationId: 'c-gone', messageId: 'm', toolCallId: 'tc', toolName: 'write_file', arguments: {} };
  assert.deepEqual(derive({ approvals: [stray] }), []);
});

test('finished, stopped early and failed tasks', () => {
  const finished = work({ id: 'done', status: 'done', doneAt: NOW - 5 * MIN, updatedAt: NOW - 5 * MIN });
  const stopped = work({ id: 'early', status: 'attention', note: 'Stopped at the step limit.', coworkerId: 'research-analyst', conversationId: 'c-research', title: 'Compare tools', updatedAt: NOW - HOUR });
  const failed = work({ id: 'bad', status: 'attention', note: 'The model did not answer.', title: 'Fix the bug', updatedAt: NOW - 2 * HOUR });
  const runs = [
    { conversationId: 'c-api', status: 'failed', startedAt: NOW - 3 * HOUR },
    { conversationId: 'c-research', status: 'completed', startedAt: NOW - 3 * HOUR }
  ];
  const notices = derive({ tasks: [failed, stopped, finished], runs });
  assert.deepEqual(notices.map((x) => [x.kind, x.title, x.what, x.who]), [
    ['finished', 'Finished a task', 'Build the API', 'Backend Developer'],
    ['stopped', 'Stopped early', 'Compare tools', 'Research Analyst'],
    ['failed', 'Couldn’t finish a task', 'Fix the bug', 'Backend Developer']
  ]);
  assert.deepEqual(notices.map((x) => x.id), [`finished:done:${NOW - 5 * MIN}`, `attention:early:${NOW - HOUR}`, `attention:bad:${NOW - 2 * HOUR}`]);
  assert.deepEqual(notices.map((x) => x.at), [NOW - 5 * MIN, NOW - HOUR, NOW - 2 * HOUR], 'newest first');
});

test('what is not news is left out', () => {
  const youStopped = work({ id: 's', status: 'done', note: 'Stopped', doneAt: NOW - MIN });
  const waitsOnYou = work({ id: 'w', status: 'attention', note: 'Waiting for your approval' });
  const working = work({ id: 'k' });
  const help = work({ id: 'h', kind: 'help', status: 'done', doneAt: NOW - MIN });
  const todo = { id: 'd', kind: 'todo', title: 'Call', status: 'done', doneAt: NOW - MIN, createdAt: 0, updatedAt: NOW };
  const old = work({ id: 'o', status: 'done', doneAt: NOW - n.NOTICE_AGE_MS - HOUR });
  const oldFailure = work({ id: 'of', status: 'attention', note: 'x', updatedAt: NOW - n.NOTICE_AGE_MS - HOUR });
  assert.deepEqual(derive({ tasks: [youStopped, waitsOnYou, working, help, todo, old, oldFailure] }), []);
});

test('a team plan waiting for your OK, and a finished team\'s report', () => {
  const team = (over) => ({ id: 'tm', leadId: 'chief-of-staff', conversationId: 'c-lead', goal: 'Launch   the beta', attendees: [], providerId: 'p', modelId: 'm', status: 'planned', minutes: [], createdAt: 0, updatedAt: NOW - 10 * MIN, ...over });
  const [plan] = derive({ teams: [team({})] });
  assert.deepEqual([plan.id, plan.kind, plan.who, plan.what, plan.conversationId, plan.agentId], ['team:tm:planned', 'plan', 'Chief of Staff', 'Launch the beta', 'c-lead', 'chief-of-staff']);
  assert.equal(derive({ teams: [team({ status: 'done', report: 'All shipped.' })] })[0].kind, 'report');
  assert.deepEqual(derive({ teams: [team({ status: 'done' })] }), [], 'done without a report has nothing to read');
  assert.equal(derive({ teams: [team({ status: 'failed' })] })[0].kind, 'failed');
  assert.deepEqual(derive({ teams: [team({ status: 'working' }), team({ status: 'meeting' }), team({ status: 'stopped' })] }), []);
  assert.deepEqual(derive({ teams: [team({ status: 'done', report: 'x', updatedAt: NOW - n.NOTICE_AGE_MS - HOUR })] }), [], 'an old report is history');
  assert.equal(derive({ teams: [team({ updatedAt: NOW - n.NOTICE_AGE_MS - HOUR })] })[0].kind, 'plan', 'a plan waiting for you stays however long ago');
});

test('the list is newest first and keeps to a sensible length', () => {
  const tasks = Array.from({ length: 60 }, (_, i) => work({ id: `t${i}`, status: 'done', doneAt: NOW - (i + 1) * MIN }));
  const notices = derive({ tasks });
  assert.equal(notices.length, n.MAX_NOTICES);
  assert.deepEqual(notices.map((x) => x.at), notices.map((x) => x.at).sort((a, b) => b - a));
  const step = { id: 'r1', conversationId: 'c-api', messageId: 'm', toolCallId: 'tc', toolName: 'write_file', arguments: {}, createdAt: NOW };
  assert.equal(derive({ tasks, approvals: [step] })[0].kind, 'approval', 'what is happening now is first');
});

test('how long ago, in a few words', () => {
  const ago = (ms) => n.timeAgo(NOW - ms, NOW);
  assert.equal(ago(0), 'just now');
  assert.equal(ago(30_000), 'just now');
  assert.equal(ago(50_000), '1 min ago');
  assert.equal(ago(2 * MIN), '2 min ago');
  assert.equal(ago(59 * MIN), '59 min ago');
  assert.equal(ago(HOUR), '1 hour ago');
  assert.equal(ago(3 * HOUR), '3 hours ago');
  assert.equal(ago(23 * HOUR), '23 hours ago');
  assert.equal(ago(30 * HOUR), 'yesterday');
  assert.equal(ago(72 * HOUR), '3 days ago');
  assert.equal(n.timeAgo(NOW + 5 * MIN, NOW), 'just now', 'a clock that is a little off never says "ago" backwards');
});

// ------------------------------------------------------------------------------ read or not

const storageOf = (initial) => {
  const kept = new Map(initial === undefined ? [] : [[n.NOTICE_KEY, initial]]);
  return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value) };
};

test('a first start begins now, so work from before the bell is not all news', () => {
  const memory = n.loadMemory(storageOf(), NOW);
  assert.deepEqual(memory, { since: NOW, read: {} });
  const older = { id: 'finished:a:1', kind: 'finished', at: NOW - HOUR };
  const newer = { id: 'finished:b:2', kind: 'finished', at: NOW + MIN };
  assert.equal(n.isRead(older, memory), true, 'older than the bell');
  assert.equal(n.isRead(newer, memory), false);
  const waiting = { id: 'approval:x', kind: 'approval', at: NOW - 5 * HOUR };
  assert.equal(n.isRead(waiting, memory), false, 'what waits for you is always new');
  assert.equal(n.isRead({ ...waiting, id: 'question:y', kind: 'question' }, memory), false);
  assert.equal(n.isRead({ ...waiting, id: 'team:z:planned', kind: 'plan' }, memory), false);
});

test('reading one marks only that one, and it stays read after a reload', () => {
  const storage = storageOf();
  let memory = n.loadMemory(storage, NOW);
  const a = { id: 'approval:a', kind: 'approval', at: NOW };
  const b = { id: 'question:b', kind: 'question', at: NOW };
  const c = { id: 'finished:c:1', kind: 'finished', at: NOW + HOUR };
  assert.equal(n.unreadCount([a, b, c], memory), 3);
  memory = n.saveMemory(storage, n.markRead(memory, ['approval:a'], NOW + 1));
  assert.equal(n.unreadCount([a, b, c], memory), 2);
  const reloaded = n.loadMemory(storage, NOW + 5 * HOUR);
  assert.equal(reloaded.since, NOW, 'the bell keeps the moment it began');
  assert.equal(n.isRead(a, reloaded), true);
  assert.equal(n.isRead(b, reloaded), false);
  // Mark all read.
  const all = n.markRead(reloaded, [a, b, c].map((x) => x.id), NOW + 6 * HOUR);
  assert.equal(n.unreadCount([a, b, c], all), 0);
});

test('only the newest few hundred marks are kept', () => {
  const storage = storageOf();
  const ids = Array.from({ length: 450 }, (_, i) => `finished:t:${i}`);
  let memory = n.loadMemory(storage, 0);
  for (const [i, id] of ids.entries()) memory = n.markRead(memory, [id], 1000 + i);
  const kept = n.saveMemory(storage, memory);
  assert.equal(Object.keys(kept.read).length, 300);
  assert.ok(kept.read['finished:t:449'] && !kept.read['finished:t:0']);
});

test('storage that is blocked or damaged never breaks the bell', () => {
  const blocked = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    }
  };
  assert.deepEqual(n.loadMemory(blocked, NOW), { since: NOW, read: {} });
  const memory = n.saveMemory(blocked, { since: NOW, read: { a: 1 } });
  assert.deepEqual(memory, { since: NOW, read: { a: 1 } }, 'kept for this session');
  assert.deepEqual(n.loadMemory(null, NOW), { since: NOW, read: {} });
  assert.deepEqual(n.loadMemory(storageOf('not json'), NOW), { since: NOW, read: {} });
  assert.deepEqual(n.loadMemory(storageOf('{"since":"soon"}'), NOW), { since: NOW, read: {} });
  assert.deepEqual(n.loadMemory(storageOf('{"since":5,"read":{"a":3,"b":"x"}}'), NOW), { since: 5, read: { a: 3 } });
});
