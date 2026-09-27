// The audit trail: every tool call, what was decided, and by whom; kept small and free of file contents.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AuditLog, AUDIT_KEPT, COMPACT_AT } = require('../src/main/audit/log.ts');
const { DECISION_WORDS, auditSubject, inGroup } = require('../src/shared/audit.ts');

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const writer = { kind: 'coworker', id: 'writer', name: 'Writer' };
const call = (extra = {}) => ({ actor: writer, tool: 'read_file', subject: 'a.txt', decision: 'allowed', result: 'ok', ...extra });

test('entries come back newest first, and survive a restart', async (t) => {
  const dir = temp(t);
  let now = 1000;
  const log = new AuditLog(dir, () => now++);
  log.record(call({ subject: 'first' }));
  log.record(call({ subject: 'second' }));
  await log.flush();
  assert.deepEqual(log.list().map((e) => e.subject), ['second', 'first']);
  assert.deepEqual(new AuditLog(dir).list().map((e) => e.subject), ['second', 'first']);
});

test('filters by conversation, by who, and by kind of decision, and pages on', async (t) => {
  const log = new AuditLog(temp(t));
  log.record(call({ conversationId: 'c1', subject: 'read' }));
  log.record(call({ conversationId: 'c1', tool: 'write_file', decision: 'rejected', result: undefined, subject: 'rejected' }));
  log.record(call({ conversationId: 'c2', actor: { kind: 'coworker', id: 'designer', name: 'Designer' }, tool: 'run_command', decision: 'denied', result: undefined, subject: 'denied' }));
  log.record(call({ conversationId: 'c1', actor: { kind: 'you', name: 'You' }, tool: 'write_file', decision: 'reverted', result: undefined, subject: 'reverted' }));
  log.record(call({ conversationId: 'c1', tool: 'write_file', decision: 'approved', subject: 'written', change: { added: 2, removed: 1, created: false } }));
  assert.equal(log.list({ conversationId: 'c1' }).length, 4);
  assert.deepEqual(log.list({ actorId: 'designer' }).map((e) => e.subject), ['denied']);
  assert.deepEqual(log.list({ group: 'asked' }).map((e) => e.subject), ['written', 'rejected']);
  assert.deepEqual(log.list({ group: 'refused' }).map((e) => e.subject), ['denied', 'rejected']);
  assert.deepEqual(log.list({ group: 'changes' }).map((e) => e.subject), ['written', 'reverted']);
  const first = log.list({ limit: 2 });
  assert.deepEqual(first.map((e) => e.subject), ['written', 'reverted']);
  assert.deepEqual(log.list({ limit: 2, afterId: first[1].id }).map((e) => e.subject), ['denied', 'rejected']);
  await log.flush();
});

test('never keeps what a tool wrote, and cuts long subjects and details', async (t) => {
  const dir = temp(t);
  const log = new AuditLog(dir);
  log.record({ ...call(), subject: 'x'.repeat(1000), detail: 'e'.repeat(1000), content: 'SECRET FILE BODY' });
  await log.flush();
  assert.ok(!fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').includes('SECRET'));
  const [entry] = log.list();
  assert.equal(entry.subject.length, 300);
  assert.equal(entry.detail.length, 300);
  assert.equal(entry.content, undefined);
});

test('past the cap the log keeps the newest entries, on disk too', async (t) => {
  const dir = temp(t);
  const line = (i) => JSON.stringify({ id: `e${i}`, at: i, actor: { kind: 'you', name: 'You' }, tool: 't', subject: String(i), decision: 'allowed' });
  fs.writeFileSync(path.join(dir, 'audit.jsonl'), Array.from({ length: COMPACT_AT }, (_, i) => line(i)).join('\n') + '\n');
  const log = new AuditLog(dir);
  assert.equal(log.all().length, COMPACT_AT);
  log.record(call({ subject: 'newest' }));
  await log.flush();
  assert.equal(log.all().length, AUDIT_KEPT);
  assert.equal(log.all()[0].id, `e${COMPACT_AT - AUDIT_KEPT + 1}`);
  const lines = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, AUDIT_KEPT);
  assert.equal(JSON.parse(lines.at(-1)).subject, 'newest');
});

test('a damaged line is skipped, never fatal', (t) => {
  const dir = temp(t);
  const good = JSON.stringify({ id: 'a', at: 1, actor: { kind: 'you', name: 'You' }, tool: 't', subject: 'ok', decision: 'allowed' });
  fs.writeFileSync(path.join(dir, 'audit.jsonl'), `${good}\n{ half a line\n\n${JSON.stringify({ id: 1 })}\n`);
  assert.deepEqual(new AuditLog(dir).list().map((e) => e.subject), ['ok']);
});

test('what a call was about, in one line, never its contents', () => {
  assert.equal(auditSubject('write_file', { path: 'src/a.ts', content: 'SECRET' }), 'src/a.ts');
  assert.equal(auditSubject('run_command', { command: 'npm test' }), 'npm test');
  assert.equal(auditSubject('list_files', {}), '.');
  assert.equal(auditSubject('ask_colleague', { colleague: 'Designer', question: 'Which blue?' }), 'Designer: Which blue?');
  const connector = auditSubject('mcp_gmail_send', { to: 'a@b.c', body: 'SECRET' });
  assert.ok(connector.includes('a@b.c') && !connector.includes('SECRET'));
  assert.equal(auditSubject('run_command', { command: 'x'.repeat(500) }).length, 300);
});

test('every decision has words, and groups overlap as described', () => {
  for (const decision of ['allowed', 'approved', 'approved-session', 'rejected', 'timed-out', 'withdrawn', 'denied', 'skipped', 'reverted'])
    assert.ok(DECISION_WORDS[decision], decision);
  const entry = (decision, extra = {}) => ({ id: 'x', at: 0, actor: writer, tool: 'write_file', subject: '', decision, ...extra });
  assert.equal(inGroup(entry('rejected'), 'asked'), true);
  assert.equal(inGroup(entry('rejected'), 'refused'), true);
  assert.equal(inGroup(entry('timed-out'), 'refused'), true);
  assert.equal(inGroup(entry('allowed', { result: 'ok' }), 'changes'), true);
  assert.equal(inGroup(entry('allowed', { result: 'error' }), 'changes'), false);
  assert.equal(inGroup(entry('denied')), true);
});
