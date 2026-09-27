# Transparency Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every tool call any agent makes (with its permission outcome and who decided), show proposed file changes as real diffs, and let you undo any file a coworker saved.

**Architecture:** A pure `src/shared/audit.ts` defines entries, groups, subjects and wording; `src/main/audit/log.ts` keeps them in an append-only, capped JSON-lines file. `PermissionManager` reports *how* an approval ended. `Service` records an entry at every branch that answers a call (chat run loop, colleague consults, sub-agents). `write_file` hands its previous content to the service, which keeps a checkpoint (`src/main/audit/checkpoints.ts`) that `revertChange` restores after a native confirmation. The renderer gets a shared `DiffLines` component (used by the approval card and the work surface), an Undo button, and Settings → Activity log.

**Tech Stack:** Electron 44, TypeScript 5.6, React 18, Zustand 5; `node:test` CommonJS tests that transpile TypeScript at require time.

**Spec:** `docs/superpowers/specs/2026-09-27-transparency-wave2-design.md` (approved 2026-09-27; read it alongside this plan).

## Global Constraints

- The audit log never stores file contents, prompts or model output: only `subject` (≤ 300 characters) and `detail` (≤ 300 characters).
- Audit log: `<userData>/audit/audit.jsonl`, newest 20,000 kept, compacted past 25,000. A failed write never stops a run.
- Checkpoints: `<userData>/checkpoints/`, newest 500 and 200 MB. A failed checkpoint never stops the write.
- Undo restores only a path taken from its checkpoint, only inside the open project, through `Project`'s safety checks, after a native confirmation whose default is Cancel.
- Decisions: `allowed`, `approved`, `approved-session`, `rejected`, `timed-out`, `withdrawn`, `denied`, `skipped`, `reverted` — exactly these names.
- IPC names: `auditList`, `auditExport`, `revertChange`.
- Every task ends with `npm run typecheck` clean and its tests passing; the last task runs the full `npm test`.
- UI copy: plain second-person sentences; decisions shown as text, never colour alone.
- Edit files with the Edit/Write tools, not shell heredocs (Windows mangles them).
- Renderer files: format with prettier only the lines you wrote when a file already has formatting drift (check the file's `git show HEAD:` version first).
- One commit per task, `feat(audit): …` / `feat(undo): …` / `test(…)`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

1. **Paging uses `afterId`** (the last entry shown), not a timestamp: many entries share a millisecond.
2. **A colleague's call to a tool it wasn't given is recorded** through a new optional `refused` callback in `consult`, so "every tool call" holds there too.
3. **A sub-agent's refused and stopped calls are `skipped` or `denied`**; a sub-agent can never ask, so a call that would ask is `denied` with the reason.
4. **Undo availability travels on the saved change** (`FileChange.undo: 'kept' | 'unreadable'`, `revertedAt`), so the window knows without asking main. Changes saved before this feature have neither and read "Can't be undone".
5. **Checkpoint files are named by a hash of the tool-call id**, so provider id formats can never form a path.
6. **The Activity log's coworker filter lists every coworker** from `src/shared/coworkers.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/audit.ts` (new) | `AuditEntry`, `AuditDecision`, `AuditActor`, `AuditQuery`, `inGroup`, `auditSubject`, `DECISION_WORDS` |
| `src/main/audit/log.ts` (new) | `AuditLog`: append, load, compact, list, all, flush |
| `src/main/audit/checkpoints.ts` (new) | `Checkpoints`: save/get/remove/prune; `hashText` |
| `src/main/security/permissions.ts` | `ApprovalOutcome`; `outcome` promise; `bySession` on checks |
| `src/main/colleagues.ts` | `ConsultDeps.refused` |
| `src/main/tools/registry.ts` | `write_file` checks existence; `ToolHandlerResult.previous` |
| `src/main/project.ts` | `exists()`, `remove()` |
| `src/main/service.ts` | record at every branch; `keepCheckpoint`; `auditList`, `auditExport`, `revertChange` |
| `src/shared/types.ts` | `FileChange.undo`, `FileChange.revertedAt` |
| `src/shared/platform.ts`, `src/main/index.ts`, `src/preload/index.ts` | the three IPC methods |
| `src/renderer/src/ui/DiffLines.tsx` (new) | diff rows with line numbers, highlighting, "Show all" |
| `src/renderer/src/ui/ApprovalCard.tsx`, `src/renderer/src/layout.css` | the card uses `DiffLines` and says what it will do |
| `src/renderer/src/features/office/workspace/WorkViews.tsx`, `workspace.css` | uses `DiffLines`; Undo in the file bar |
| `src/renderer/src/features/office/activity/WorkSummary.tsx` | "Undone" on a reverted write |
| `src/renderer/src/settings/ActivitySection.tsx` (new), `Settings.tsx`, `settings.css` | Settings → Activity log |
| `tests/audit.test.cjs`, `tests/checkpoints.test.cjs` (new); `tests/tools.test.cjs`, `tests/service.test.cjs` | tests |
| `tests/electron-smoke.cjs`, `README.md` | desktop E2E, docs |

---

### Task 1: Audit entries and the log

**Files:**
- Create: `src/shared/audit.ts`, `src/main/audit/log.ts`
- Test: `tests/audit.test.cjs`

**Interfaces:**
- Produces: from `src/shared/audit.ts`: `type AuditDecision`, `interface AuditActor { kind: 'coworker' | 'colleague' | 'subagent' | 'chat' | 'you'; id?: string; name: string; onBehalfOf?: string }`, `interface AuditEntry { id; at; conversationId?; actor; tool; subject; decision; result?: 'ok' | 'error'; detail?; toolCallId?; change?: { added; removed; created } }`, `type AuditGroup = 'all' | 'asked' | 'refused' | 'changes'`, `interface AuditQuery { conversationId?; actorId?; group?; afterId?; limit? }`, `inGroup(entry, group?)`, `auditSubject(tool, args)`, `SUBJECT_MAX = 300`, `DECISION_WORDS: Record<AuditDecision, string>`. From `src/main/audit/log.ts`: `class AuditLog(dir: string, now?: () => number)` with `record(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry`, `list(query?: AuditQuery): AuditEntry[]`, `all(): AuditEntry[]`, `flush(): Promise<void>`; `AUDIT_KEPT = 20_000`, `COMPACT_AT = 25_000`.

- [ ] **Step 1: Write the failing test** — create `tests/audit.test.cjs`:

```js
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

test('filters by conversation, by who, and by kind of decision, and pages on', (t) => {
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/audit.test.cjs`
Expected: FAIL — `Cannot find module '../src/main/audit/log.ts'`.

- [ ] **Step 3: Create `src/shared/audit.ts`**

```ts
/** Every tool call any agent makes, what the permission system decided, and who decided it. */
export type AuditDecision =
  /** Policy allowed it without asking, or a session grant did. */
  | 'allowed'
  /** You approved it. */
  | 'approved'
  /** You approved it and allowed it for the rest of the session. */
  | 'approved-session'
  | 'rejected'
  /** Nobody answered within 5 minutes. */
  | 'timed-out'
  /** The run stopped while it waited for you. */
  | 'withdrawn'
  /** Policy refused it: outside the folders, shell off, tool off. */
  | 'denied'
  /** Not run: bad arguments, an unknown or unavailable tool. */
  | 'skipped'
  /** You undid a saved change. */
  | 'reverted';

export interface AuditActor {
  kind: 'coworker' | 'colleague' | 'subagent' | 'chat' | 'you';
  id?: string;
  name: string;
  /** For a colleague or sub-agent: whose run they were helping. */
  onBehalfOf?: string;
}

export interface AuditEntry {
  id: string;
  at: number;
  conversationId?: string;
  actor: AuditActor;
  tool: string;
  /** What it was about: a path, a command, a connector's arguments. Never file contents; at most 300 characters. */
  subject: string;
  decision: AuditDecision;
  /** For calls that ran: whether the tool succeeded. */
  result?: 'ok' | 'error';
  /** A denial's reason, a tool's error, what an undo did; at most 300 characters. */
  detail?: string;
  toolCallId?: string;
  change?: { added: number; removed: number; created: boolean };
}

export type AuditGroup = 'all' | 'asked' | 'refused' | 'changes';

/** What a list asks for; results come newest first. */
export interface AuditQuery {
  conversationId?: string;
  actorId?: string;
  group?: AuditGroup;
  /** Continue after this entry ("Load more"). */
  afterId?: string;
  limit?: number;
}

const ASKED = new Set<AuditDecision>(['approved', 'approved-session', 'rejected', 'timed-out', 'withdrawn']);
const REFUSED = new Set<AuditDecision>(['denied', 'rejected', 'timed-out', 'skipped']);

/** The Activity log's filters. They overlap on purpose: a rejection was both asked and refused. */
export function inGroup(entry: AuditEntry, group: AuditGroup = 'all'): boolean {
  if (group === 'asked') return ASKED.has(entry.decision);
  if (group === 'refused') return REFUSED.has(entry.decision);
  if (group === 'changes') return entry.decision === 'reverted' || (entry.tool === 'write_file' && entry.result === 'ok');
  return true;
}

/** Each decision in words, for the Activity log's badges. */
export const DECISION_WORDS: Record<AuditDecision, string> = {
  allowed: 'Allowed',
  approved: 'You approved',
  'approved-session': 'You approved for the session',
  rejected: 'You rejected',
  'timed-out': 'No answer in time',
  withdrawn: 'Withdrawn: the run stopped',
  denied: 'Refused by policy',
  skipped: 'Not run',
  reverted: 'You undid it'
};

export const SUBJECT_MAX = 300;
const clip = (text: string, max = SUBJECT_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** Arguments that carry what a tool writes or sends: never kept. */
const BULKY = /^(content|body|text|data|html|markdown)$/i;
const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value));

/** What a call was about, in one line. Never file contents. */
export function auditSubject(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
    case 'write_file':
      return clip(str(args.path));
    case 'list_files':
      return clip(str(args.directory ?? args.directoryPath ?? args.path) || '.');
    case 'search_code':
      return clip(str(args.query));
    case 'run_command':
    case 'start_process':
      return clip(str(args.command));
    case 'read_process':
    case 'stop_process':
      return clip(str(args.id));
    case 'git_commit':
      return clip(str(args.message));
    case 'ask_colleague':
      return clip(`${str(args.colleague)}: ${str(args.question)}`);
    case 'dispatch_subagent':
      return clip(`${str(args.role)}: ${str(args.task)}`);
    case 'read_memory':
    case 'update_memory':
      return '.axon/MEMORY.md';
    default: {
      const shown = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, BULKY.test(key) ? '…' : value]));
      return clip(Object.keys(shown).length ? JSON.stringify(shown) : '');
    }
  }
}
```

- [ ] **Step 4: Create `src/main/audit/log.ts`**

```ts
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { appendFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SUBJECT_MAX, inGroup, type AuditEntry, type AuditQuery } from '../../shared/audit';

/** Entries kept; past COMPACT_AT the file is rewritten with the newest AUDIT_KEPT. */
export const AUDIT_KEPT = 20_000;
export const COMPACT_AT = 25_000;
const DETAIL_MAX = 300;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** An entry as kept: only its known fields, cut to size. Nothing a tool wrote is ever stored. */
function kept(entry: AuditEntry): AuditEntry {
  const { id, at, conversationId, actor, tool, subject, decision, result, detail, toolCallId, change } = entry;
  return {
    id,
    at,
    ...(conversationId ? { conversationId } : {}),
    actor: {
      kind: actor.kind,
      name: cut(actor.name, 80),
      ...(actor.id ? { id: actor.id } : {}),
      ...(actor.onBehalfOf ? { onBehalfOf: cut(actor.onBehalfOf, 80) } : {})
    },
    tool: cut(tool, 120),
    subject: cut(subject ?? '', SUBJECT_MAX),
    decision,
    ...(result ? { result } : {}),
    ...(detail ? { detail: cut(detail, DETAIL_MAX) } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(change ? { change: { added: change.added, removed: change.removed, created: change.created } } : {})
  };
}

const valid = (entry: any): entry is AuditEntry =>
  !!entry && typeof entry.id === 'string' && typeof entry.at === 'number' && typeof entry.tool === 'string'
  && typeof entry.decision === 'string' && !!entry.actor && typeof entry.actor.name === 'string';

/**
 * The audit trail: an append-only JSON-lines file beside the saved state, so backups stay small and
 * restoring a snapshot never rewrites history. Writes are queued, in order; a failed write is logged
 * and dropped, never thrown at a run.
 */
export class AuditLog {
  private entries: AuditEntry[];
  private writes: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string, private readonly now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'audit.jsonl');
    this.entries = this.load();
  }

  record(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
    const full = kept({ ...entry, id: randomUUID(), at: this.now() } as AuditEntry);
    this.entries.push(full);
    const compact = this.entries.length > COMPACT_AT;
    if (compact) this.entries = this.entries.slice(-AUDIT_KEPT);
    const whole = compact ? this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n' : null;
    this.writes = this.writes
      .then(async () => {
        if (whole === null) await appendFile(this.file, JSON.stringify(full) + '\n', 'utf8');
        else {
          await writeFile(`${this.file}.tmp`, whole, 'utf8');
          await rename(`${this.file}.tmp`, this.file);
        }
      })
      .catch((error) => console.error('The audit log could not be written.', error));
    return full;
  }

  /** Newest first, filtered, at most `limit` (100 by default, 500 at most). */
  list(query: AuditQuery = {}): AuditEntry[] {
    const limit = Math.max(1, Math.min(500, query.limit ?? 100));
    const found: AuditEntry[] = [];
    let started = !query.afterId;
    for (let i = this.entries.length - 1; i >= 0 && found.length < limit; i--) {
      const entry = this.entries[i];
      if (!started) {
        if (entry.id === query.afterId) started = true;
        continue;
      }
      if (query.conversationId && entry.conversationId !== query.conversationId) continue;
      if (query.actorId && entry.actor.id !== query.actorId) continue;
      if (!inGroup(entry, query.group)) continue;
      found.push(entry);
    }
    return found;
  }

  /** Everything kept, oldest first (for export). */
  all(): AuditEntry[] {
    return [...this.entries];
  }

  /** Resolves once every recorded entry is on disk. */
  flush(): Promise<void> {
    return this.writes;
  }

  private load(): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const entries: AuditEntry[] = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (valid(entry)) entries.push(entry);
      } catch { /* A damaged line is skipped. */ }
    }
    return entries;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/audit.test.cjs`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/shared/audit.ts src/main/audit/log.ts tests/audit.test.cjs
git commit -m "feat(audit): an audit trail kept beside the saved state, capped and free of file contents"
```

---

### Task 2: Approvals say how they ended

**Files:**
- Modify: `src/main/security/permissions.ts`
- Test: `tests/tools.test.cjs` (append)

**Interfaces:**
- Produces: `type ApprovalOutcome = 'approved' | 'approved-session' | 'rejected' | 'timed-out' | 'withdrawn'` (exported from `permissions.ts`); `createApprovalRequest(...)` returns `{ request, promise: Promise<boolean>, outcome: Promise<ApprovalOutcome> }`; `CheckResult.bySession?: boolean` (true when a session grant allowed the call).

- [ ] **Step 1: Write the failing test** — append to `tests/tools.test.cjs`:

```js
test('an approval says how it ended: approved, for the session, rejected, withdrawn, or timed out', async (t) => {
  const manager = new PermissionManager([], false);
  const ask = () => manager.createApprovalRequest({ conversationId: 'c', messageId: 'm', toolCallId: 't', toolName: 'write_file', args: { path: 'a' } });
  const a = ask();
  manager.resolveApproval({ requestId: a.request.id, approved: true });
  assert.equal(await a.outcome, 'approved');
  assert.equal(await a.promise, true);
  const b = ask();
  manager.resolveApproval({ requestId: b.request.id, approved: true, alwaysAllowSession: true });
  assert.equal(await b.outcome, 'approved-session');
  const c = ask();
  manager.resolveApproval({ requestId: c.request.id, approved: false });
  assert.equal(await c.outcome, 'rejected');
  assert.equal(await c.promise, false);
  const d = ask();
  manager.withdraw(d.request.id);
  assert.equal(await d.outcome, 'withdrawn');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const e = ask();
  t.mock.timers.tick(300_000);
  assert.equal(await e.outcome, 'timed-out');
  assert.equal(await e.promise, false);
  // b allowed write_file for the session: the next one is allowed, and says why.
  assert.deepEqual(manager.check({ toolName: 'write_file', args: { path: 'z' } }), { action: 'allow', bySession: true });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/tools.test.cjs`
Expected: FAIL — `a.outcome` is undefined (`assert.equal(undefined, 'approved')`); other tests pass.

- [ ] **Step 3: Implement in `src/main/security/permissions.ts`**

Add `bySession` to `CheckResult`:

```ts
export interface CheckResult {
  action: PermissionAction;
  reason?: string;
  /** A session grant allowed it ("Always allow this session"). */
  bySession?: boolean;
}

/** How an approval request ended. */
export type ApprovalOutcome = 'approved' | 'approved-session' | 'rejected' | 'timed-out' | 'withdrawn';
```

`PendingApproval.resolve` becomes `resolve: (outcome: ApprovalOutcome) => void;`.

In `check`, the session-grant branch returns `{ action: 'allow', bySession: true }`.

Replace `createApprovalRequest`'s promise/timer section and the three resolvers:

```ts
  createApprovalRequest(params: {
    conversationId: string;
    messageId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, any>;
    preview?: ToolApprovalRequest['preview'];
  }): { request: ToolApprovalRequest; promise: Promise<boolean>; outcome: Promise<ApprovalOutcome> } {
    const id = randomUUID();
    const request: ToolApprovalRequest = {
      id,
      conversationId: params.conversationId,
      messageId: params.messageId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      arguments: params.args,
      preview: params.preview
    };

    let settle: (outcome: ApprovalOutcome) => void = () => {};
    const outcome = new Promise<ApprovalOutcome>((resolve) => {
      settle = resolve;
    });
    const promise = outcome.then((ended) => ended === 'approved' || ended === 'approved-session');

    // 5-minute timeout on user approvals; a waiting approval never keeps the app from quitting.
    const timer = setTimeout(() => {
      this.pendingApprovals.delete(id);
      settle('timed-out');
    }, 300_000);
    timer.unref?.();

    this.pendingApprovals.set(id, { request, resolve: settle, timer });
    return { request, promise, outcome };
  }
```

```ts
  resolveApproval(decision: ToolApprovalDecision): boolean {
    return this.settle(decision.requestId,
      !decision.approved ? 'rejected' : decision.alwaysAllowSession ? 'approved-session' : 'approved');
  }

  /** The run that asked has stopped: the request is answered as withdrawn and leaves the pending list. */
  withdraw(requestId: string): void {
    this.settle(requestId, 'withdrawn');
  }

  private settle(requestId: string, outcome: ApprovalOutcome): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(requestId);
    if (outcome === 'approved-session') {
      const { toolName, arguments: args } = pending.request;
      this.sessionGrants.add(EXACT_GRANTS.has(toolName) ? `${toolName}:${JSON.stringify(args)}` : `${toolName}:*`);
    }
    pending.resolve(outcome);
    return true;
  }

  clearSession() {
    this.sessionGrants.clear();
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timer);
      pending.resolve('withdrawn');
    }
    this.pendingApprovals.clear();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tools.test.cjs tests/service.test.cjs tests/connectors-service.test.cjs tests/planner.test.cjs`
Expected: PASS (the existing approval, stop-withdraw and connector-policy tests still pass).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/main/security/permissions.ts tests/tools.test.cjs
git commit -m "feat(audit): an approval says how it ended, and a session grant says it allowed a call"
```

---

### Task 3: Every tool call goes in the audit trail

**Files:**
- Modify: `src/main/service.ts` (constructor, `answer`, the tool-call loop, `askColleague`, `runSubagent`, new `actorOf`, `auditList`, `auditExport`)
- Modify: `src/main/colleagues.ts` (`ConsultDeps.refused`)
- Modify: `src/shared/platform.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/service.test.cjs` (append)

**Interfaces:**
- Consumes: `AuditLog`, `auditSubject`, `AuditDecision`, `AuditActor`, `AuditEntry`, `AuditQuery` (Task 1); `ApprovalOutcome`, `outcome`, `bySession` (Task 2).
- Produces: `Service.audit: AuditLog` (at `join(dataPath, 'audit')`); `Service.auditList(query: AuditQuery): AuditEntry[]`; `Service.auditExport(): Promise<boolean>`; `runSubagent(..., scope, parent?: { conversationId: string; name: string })`; `window.axon.auditList`, `window.axon.auditExport`.

- [ ] **Step 1: Write the failing tests** — append to `tests/service.test.cjs`:

```js
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
    if (calls === 1) return { toolCalls: [
      { id: 'l', name: 'list_files', arguments: '{}' },
      { id: 'b', name: 'bogus_tool', arguments: '{}' },
      { id: 'j', name: 'read_file', arguments: '{"path": ' },
      { id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'one' }) },
      { id: 'r', name: 'run_command', arguments: JSON.stringify({ command: 'npm test' }) }
    ] };
    if (calls === 2) return { toolCalls: [{ id: 'w2', name: 'write_file', arguments: JSON.stringify({ path: 'b.txt', content: 'two' }) }] };
    if (calls === 3) return { toolCalls: [{ id: 'w3', name: 'write_file', arguments: JSON.stringify({ path: 'c.txt', content: 'three' }) }] };
    onChunk('Done.');
    return { toolCalls: [] };
  });
  const run = service.chatSend(chat.id, 'Do things', []);
  const first = await waitFor(() => events.filter((e) => e.approvalRequired)[0]?.approvalRequired, 'the first approval');
  await service.toolApprove({ requestId: first.id, approved: false });
  const second = await waitFor(() => events.filter((e) => e.approvalRequired)[1]?.approvalRequired, 'the second approval');
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
  mockModel(t, async () => ({ toolCalls: [{ id: 'w', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'x' }) }] }));
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
  let asker = 0, consulted = 0;
  mockModel(t, async (_p, _k, req, onChunk) => {
    if (req.system.includes('is asking you a question')) {
      if (++consulted === 1) return { toolCalls: [
        { id: 'cr', name: 'read_file', arguments: JSON.stringify({ path: 'a.txt' }) },
        { id: 'cw', name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: 'no' }) }
      ] };
      onChunk('It says hello.');
      return { toolCalls: [] };
    }
    if (++asker === 1) return { toolCalls: [{ id: 'ask', name: 'ask_colleague', arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'What is in a.txt?' }) }] };
    onChunk('Thanks.');
    return { toolCalls: [] };
  });
  await service.chatSend(chat.id, 'Ask about a.txt', []);
  const entries = service.audit.all();
  const asking = coworkerById('frontend-developer').name, helping = coworkerById('backend-developer').name;
  assert.deepEqual(entries.map((e) => [e.actor.kind, e.actor.name, e.actor.onBehalfOf ?? null, e.tool, e.decision]), [
    ['colleague', helping, asking, 'read_file', 'allowed'],
    ['colleague', helping, asking, 'write_file', 'skipped'],
    ['coworker', asking, null, 'ask_colleague', 'allowed']
  ]);
  assert.ok(entries.every((e) => e.conversationId === chat.id));
});

test("a sub-agent's calls are recorded on behalf of the run that sent it", async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  addProvider(repo);
  let calls = 0;
  mockModel(t, async () => (++calls === 1
    ? { toolCalls: [
      { id: 's1', name: 'write_file', arguments: JSON.stringify({ path: 'x.ts', content: 'boom' }) },
      { id: 's2', name: 'dispatch_subagent', arguments: JSON.stringify({ role: 'nested', task: 'more' }) }
    ] }
    : { toolCalls: [] }));
  await service.runSubagent('p1', 'm1', 'researcher', 'Look around', null, undefined, undefined, undefined, { conversationId: 'c1', name: 'Assistant' });
  assert.deepEqual(service.audit.all().map((e) => [e.actor.kind, e.actor.onBehalfOf, e.tool, e.decision, e.conversationId]), [
    ['subagent', 'Assistant', 'write_file', 'denied', 'c1'],
    ['subagent', 'Assistant', 'dispatch_subagent', 'denied', 'c1']
  ]);
});

test('the activity log is listed and exported over IPC', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  service.audit.record({ actor: { kind: 'you', name: 'You' }, tool: 'write_file', subject: 'a.txt', decision: 'reverted' });
  assert.equal(service.auditList({ group: 'changes' }).length, 1);
  const out = path.join(dir, 'export.json');
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  t.after(() => { delete electron.dialog.showSaveDialog; });
  assert.equal(await service.auditExport(), true);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8'))[0].subject, 'a.txt');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/service.test.cjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'all')` (no `service.audit`); existing tests pass.

- [ ] **Step 3: Let `consult` report tools it refuses** — in `src/main/colleagues.ts`, add to `ConsultDeps`:

```ts
  /** A tool the colleague asked for but wasn't given: for the audit trail. */
  refused?: (name: string, args: Record<string, unknown>) => void;
```

and in `consult`'s call loop, parse the arguments for every call and report refused ones:

```ts
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments);
      } catch {
        // Arguments the model mangled read as none.
      }
      let content = 'Not available to you here.';
      if (allowed.has(call.name)) content = await deps.execute(call.name, args);
      else deps.refused?.(call.name, args);
      messages.push({ role: 'tool', toolCallId: call.id, content });
    }
```

- [ ] **Step 4: Record in `src/main/service.ts`**

Imports:

```ts
import { AuditLog } from './audit/log';
import { auditSubject, type AuditActor, type AuditDecision, type AuditEntry, type AuditQuery } from '../shared/audit';
```

Field and construction (next to `readonly accounts`, and in the constructor before `this.scm = ...`):

```ts
  /** Every tool call any agent makes, and what was decided. */
  readonly audit: AuditLog;
```

```ts
    this.audit = new AuditLog(join(dataPath, 'audit'));
```

Add after `contextUsageOf`:

```ts
  /** Who is acting in a conversation's run, for the audit trail. */
  private actorOf(chat: Conversation): AuditActor {
    const coworker = coworkerById(chat.agentId);
    return coworker ? { kind: 'coworker', id: coworker.id, name: coworker.name } : { kind: 'chat', name: 'Assistant' };
  }
```

Replace `answer` with a version that takes the decision and records it (declare `const actor = this.actorOf(chat);` just above it):

```ts
    const actor = this.actorOf(chat);
    /** Records a call's outcome: a tool message, the next request, the call itself, the window, and the audit trail. */
    const answer = (tc: ToolCall, outcome: { content: string; isError?: boolean; change?: FileChange; process?: { id: string } }, decision: AuditDecision, note?: string): void => {
      this.state.messages.push({
        id: this.repo.id(),
        conversationId: id,
        role: 'tool',
        toolCallId: tc.id,
        content: outcome.content,
        error: outcome.isError ? outcome.content : undefined,
        createdAt: Date.now()
      });
      requests.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: outcome.content });
      Object.assign(tc, outcome.isError ? { error: outcome.content } : { result: outcome.content, ...(outcome.change ? { change: outcome.change } : {}) },
        outcome.process ? { process: outcome.process } : {});
      this.emit({ channel: 'chat', conversationId: id, messageId: activeAssistant.id, toolCall: { ...tc }, streaming: true, done: false });
      const ran = decision === 'allowed' || decision === 'approved' || decision === 'approved-session';
      this.audit.record({
        conversationId: id, actor, tool: tc.name, subject: auditSubject(tc.name, toolArgs(tc.arguments) ?? {}), decision, toolCallId: tc.id,
        ...(ran ? { result: outcome.isError ? 'error' as const : 'ok' as const } : {}),
        ...(outcome.isError ? { detail: outcome.content } : note ? { detail: note } : {}),
        ...(outcome.change ? { change: outcome.change } : {})
      });
    };
```

Replace the body of `for (const tc of usage.toolCalls) { ... }` with:

```ts
        for (const tc of usage.toolCalls) {
          if (controller.signal.aborted) break;

          const parsedArgs = toolArgs(tc.arguments);
          if (!parsedArgs) {
            answer(tc, { content: `The arguments for ${tc.name} were not valid JSON (perhaps cut off), so it was not run. Call it again with complete arguments.`, isError: true }, 'skipped');
            continue;
          }

          // A coworker asking a colleague: answered by a consult, never by the tool registry.
          if (tc.name === ASK_COLLEAGUE.name && coworkerById(chat.agentId)) {
            if (this.permissions.check({ toolName: tc.name, args: parsedArgs }, scope).action === 'allow')
              answer(tc, await this.askColleague(chat, provider, parsedArgs, scope, asks, controller.signal), 'allowed');
            else answer(tc, { content: 'Tool execution denied by security policy.', isError: true }, 'denied');
            continue;
          }

          // The receptionist keeping the planner: the task records, never the tool registry.
          if (PLANNER_TOOL_NAMES.has(tc.name) && chat.agentId === RECEPTIONIST_ID) {
            if (this.permissions.check({ toolName: tc.name, args: parsedArgs }, scope).action === 'allow')
              answer(tc, runPlannerTool(tc.name, parsedArgs, this.tasks, new Date()), 'allowed');
            else answer(tc, { content: 'Tool execution denied by security policy.', isError: true }, 'denied');
            await this.repo.save();
            continue;
          }

          if (this.mcp.isConnectorTool(tc.name) && !offered.has(tc.name)) {
            answer(tc, { content: `${tc.name} isn't available in this conversation.`, isError: true }, 'skipped');
            continue;
          }

          const toolImpl = this.tools.get(tc.name);
          if (!toolImpl) {
            answer(tc, { content: `Unknown tool: ${tc.name}`, isError: true }, 'skipped');
            continue;
          }

          const check = this.permissions.check({ toolName: tc.name, args: parsedArgs }, scope);
          if (check.action === 'deny') {
            answer(tc, { content: check.reason || 'Tool execution denied by security policy.', isError: true }, 'denied');
            continue;
          }
          let decision: AuditDecision = 'allowed';
          if (check.action === 'ask') {
            let preview = undefined;
            if (toolImpl.preparePreview) {
              preview = await toolImpl.preparePreview(parsedArgs, {
                project: this.project,
                allowShell: scope.allowShell
              });
            }

            const { request, outcome } = this.permissions.createApprovalRequest({
              conversationId: id,
              messageId: activeAssistant.id,
              toolCallId: tc.id,
              toolName: tc.name,
              args: parsedArgs,
              preview
            });

            this.emit({
              channel: 'chat',
              conversationId: id,
              messageId: activeAssistant.id,
              toolCall: tc,
              approvalRequired: request,
              streaming: true,
              done: false
            });
            this.tracker.approvalPending(id);
            // Nobody is looking: say who is waiting, and take them straight there.
            const asking = coworkerById(chat.agentId);
            if (asking && this.shell && !this.shell.windowVisible())
              this.shell.notify({
                title: `${asking.name} needs your approval`,
                body: `To use ${tc.name.replace(/_/g, ' ')}.`,
                target: { agentId: asking.id, conversationId: id }
              });

            // Stopping the run withdraws the request, so a late approval can never run the tool.
            const withdraw = () => this.permissions.withdraw(request.id);
            controller.signal.addEventListener('abort', withdraw, { once: true });
            const ended = await outcome;
            controller.signal.removeEventListener('abort', withdraw);
            this.tracker.approvalResolved(id);
            if (controller.signal.aborted) {
              this.audit.record({ conversationId: id, actor, tool: tc.name, subject: auditSubject(tc.name, parsedArgs), decision: 'withdrawn', toolCallId: tc.id });
              break;
            }
            if (ended !== 'approved' && ended !== 'approved-session') {
              answer(tc, { content: ended === 'timed-out' ? 'Nobody answered within 5 minutes, so it was not run.' : 'Tool execution was rejected by the user.', isError: true }, ended);
              continue;
            }
            decision = ended;
          }

          // The window shows the call as running (a command in its terminal, with its output so far) until it answers.
          const running = (progress?: string) =>
            this.emit({ channel: 'chat', conversationId: id, messageId: activeAssistant.id, toolCall: { ...tc, ...(progress !== undefined ? { progress } : {}) }, streaming: true, done: false });
          running();
          const result = await toolImpl.execute(parsedArgs, {
            project: this.project,
            allowShell: scope.allowShell,
            onOutput: running,
            processes: this.processes,
            conversationId: id,
            subagentRunner: async (subRole, subTask) =>
              this.runSubagent(provider.id, chat.modelId, subRole, subTask, chat.workspaceId, agent?.maxSteps, controller.signal, scope, { conversationId: id, name: actor.name })
          });
          answer(tc, result, decision, check.bySession ? 'Allowed for this session' : undefined);
        }
```

In `askColleague`, build the helper's actor after `const colleague = found.coworker;`:

```ts
    const helper: AuditActor = { kind: 'colleague', id: colleague.id, name: colleague.name, onBehalfOf: coworkerById(chat.agentId)?.name };
    const entry = (name: string, args: Record<string, unknown>) => ({ conversationId: chat.id, actor: helper, tool: name, subject: auditSubject(name, args) });
```

and replace the `execute` callback, adding `refused`:

```ts
          execute: async (name, toolArgs) => {
            const tool = this.tools.get(name);
            if (!tool || this.permissions.check({ toolName: name, args: toolArgs }, scope).action !== 'allow') {
              this.audit.record({ ...entry(name, toolArgs), decision: tool ? 'denied' : 'skipped' });
              return 'Not allowed.';
            }
            const result = await tool.execute(toolArgs, { project: this.project, allowShell: false });
            this.audit.record({ ...entry(name, toolArgs), decision: 'allowed', result: result.isError ? 'error' : 'ok', ...(result.isError ? { detail: result.content } : {}) });
            return result.content;
          },
          refused: (name, toolArgs) => this.audit.record({ ...entry(name, toolArgs), decision: 'skipped', detail: 'Not available to a colleague.' })
```

In `runSubagent`, add the last parameter `parent?: { conversationId: string; name: string }` and, at the top of the method body:

```ts
    const subagent: AuditActor = { kind: 'subagent', name: `Sub-agent (${role.slice(0, 60)})`, ...(parent ? { onBehalfOf: parent.name } : {}) };
    /** Answers a call the sub-agent may not make, and records why. */
    const refuse = (tc: { id: string; name: string; arguments: string }, content: string, decision: AuditDecision) => {
      messages.push({ role: 'tool', toolCallId: tc.id, content });
      this.audit.record({ conversationId: parent?.conversationId, actor: subagent, tool: tc.name, subject: auditSubject(tc.name, toolArgs(tc.arguments) ?? {}), decision, detail: content, toolCallId: tc.id });
    };
```

Declare `messages` before `refuse` (move `const messages: ChatRequestMessage[] = [{ role: 'user', content: task }];` above it). Then the per-call loop becomes:

```ts
      for (const tc of toolCalls) {
        if (signal?.aborted) {
          refuse(tc, 'Stopped.', 'skipped');
          continue;
        }
        if (tc.name === 'dispatch_subagent') {
          refuse(tc, 'Permission denied: Subagents cannot recursively dispatch subagents.', 'denied');
          continue;
        }

        const args = toolArgs(tc.arguments);
        if (!args) {
          refuse(tc, `The arguments for ${tc.name} were not valid JSON, so it was not run.`, 'skipped');
          continue;
        }
        if (this.mcp.isConnectorTool(tc.name)) {
          refuse(tc, `${tc.name} isn't available to sub-agents.`, 'skipped');
          continue;
        }
        const tool = this.tools.get(tc.name);
        if (!tool) {
          refuse(tc, `Unknown tool: ${tc.name}`, 'skipped');
          continue;
        }

        // Subagents permission enforcement:
        // Mutating actions ('ask' or 'deny') cannot run silently without user approval
        const check = this.permissions.check({ toolName: tc.name, args }, scope);
        if (check.action === 'deny') {
          refuse(tc, check.reason || 'Tool execution denied by security policy.', 'denied');
          continue;
        }
        if (check.action === 'ask') {
          refuse(tc, `Permission denied: Mutating tool '${tc.name}' requires interactive user approval and cannot be executed by an autonomous subagent.`, 'denied');
          continue;
        }

        const res = await tool.execute(args, { project: this.project, allowShell: scope.allowShell });
        messages.push({ role: 'tool', toolCallId: tc.id, content: res.content });
        this.audit.record({ conversationId: parent?.conversationId, actor: subagent, tool: tc.name, subject: auditSubject(tc.name, args), decision: 'allowed', result: res.isError ? 'error' : 'ok', ...(res.isError ? { detail: res.content } : {}), toolCallId: tc.id });
      }
```

Add the two IPC methods after `restoreBackup`:

```ts
  /** Settings → Activity log: newest first, filtered. */
  auditList(query: AuditQuery): AuditEntry[] {
    const q = query ?? {};
    const id = (value: unknown) => (typeof value === 'string' ? text(value, 200) : undefined);
    return this.audit.list({
      conversationId: id(q.conversationId),
      actorId: id(q.actorId),
      group: q.group && ['all', 'asked', 'refused', 'changes'].includes(q.group) ? q.group : 'all',
      afterId: id(q.afterId),
      limit: typeof q.limit === 'number' ? q.limit : undefined
    });
  }
  /** Saves the whole activity log where you choose, as JSON; false when you cancel. */
  async auditExport(): Promise<boolean> {
    const file = await dialog.showSaveDialog({ defaultPath: `axon-activity-${dayKey(new Date())}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (file.canceled || !file.filePath) return false;
    await this.audit.flush();
    await writeFile(file.filePath, JSON.stringify(this.audit.all(), null, 2));
    return true;
  }
```

- [ ] **Step 5: Expose over IPC** — `src/shared/platform.ts`: `import type { AuditEntry, AuditQuery } from './audit';` and after `restoreBackup`:

```ts
  /** Settings → Activity log: every tool call any agent made, newest first. */
  auditList(query: AuditQuery): Promise<AuditEntry[]>;
  /** Saves the activity log where you choose; false when cancelled. */
  auditExport(): Promise<boolean>;
```

`src/main/index.ts`: add `'auditList', 'auditExport',` after `'restoreBackup',`. `src/preload/index.ts`: add `auditList: invoke('auditList'), auditExport: invoke('auditExport'),` after `restoreBackup: invoke('restoreBackup'),`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `node --test tests/service.test.cjs tests/colleagues.test.cjs && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/service.ts src/main/colleagues.ts src/shared/platform.ts src/main/index.ts src/preload/index.ts tests/service.test.cjs
git commit -m "feat(audit): every tool call by coworkers, colleagues and sub-agents is recorded"
```

---

### Task 4: Keep the version a write replaced

**Files:**
- Create: `src/main/audit/checkpoints.ts`
- Modify: `src/shared/types.ts` (`FileChange`), `src/main/tools/registry.ts` (`ToolHandlerResult`, `write_file`), `src/main/project.ts` (`exists`), `src/main/service.ts` (`checkpoints`, `keepCheckpoint`)
- Test: `tests/checkpoints.test.cjs` (new), `tests/service.test.cjs` (append)

**Interfaces:**
- Produces: `FileChange.undo?: 'kept' | 'unreadable'`, `FileChange.revertedAt?: number`; `ToolHandlerResult.previous?: { existed: boolean; content: string | null }`; `Project.exists(path): Promise<boolean>`; `interface Checkpoint { toolCallId; conversationId; root; path; existed: boolean; before?: string; afterHash: string; savedAt: number }`; `class Checkpoints(dir, limits?: { count: number; bytes: number }, now?)` with `save(point: Omit<Checkpoint, 'savedAt'>): Promise<boolean>`, `get(toolCallId): Promise<Checkpoint | null>`, `remove(toolCallId): Promise<void>`; `hashText(text): string`; `CHECKPOINTS_KEPT = 500`, `CHECKPOINT_BYTES = 200 * 1024 * 1024`; `Service.checkpoints: Checkpoints` (at `join(dataPath, 'checkpoints')`).

- [ ] **Step 1: Write the failing tests** — create `tests/checkpoints.test.cjs`:

```js
// Undo's memory: the version each write replaced, kept for the newest writes only.
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
const { Checkpoints, hashText } = require('../src/main/audit/checkpoints.ts');

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-checkpoints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const point = (toolCallId, extra = {}) => ({ toolCallId, conversationId: 'c', root: '/p', path: 'a.txt', existed: true, before: 'old', afterHash: hashText('new'), ...extra });

test('a checkpoint is kept, read back and removed; any id is safe as a name', async (t) => {
  const store = new Checkpoints(temp(t));
  assert.equal(await store.save(point('call/../../evil:1')), true);
  const kept = await store.get('call/../../evil:1');
  assert.equal(kept.before, 'old');
  assert.equal(kept.afterHash, hashText('new'));
  assert.equal(typeof kept.savedAt, 'number');
  await store.remove('call/../../evil:1');
  assert.equal(await store.get('call/../../evil:1'), null);
  assert.equal(await store.get('never-saved'), null);
});

test('only the newest checkpoints are kept', async (t) => {
  let now = 1;
  const store = new Checkpoints(temp(t), { count: 3, bytes: 1e9 }, () => now++);
  for (const id of ['a', 'b', 'c', 'd']) await store.save(point(id));
  assert.equal(await store.get('a'), null);
  assert.ok(await store.get('d'));
});
```

Append to `tests/service.test.cjs`:

```js
/** A chat in a project folder whose model writes `file` once; the write is approved. */
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
  mockModel(t, async () => (++calls === 1 ? { toolCalls: [{ id: 'w1', name: 'write_file', arguments: JSON.stringify({ path: file, content }) }] } : { toolCalls: [] }));
  return { ...made, folder, chat, events, run: async (before) => {
    if (before !== undefined) fs.writeFileSync(path.join(folder, file), before);
    const run = made.service.chatSend(chat.id, 'Write it', []);
    const request = await waitFor(() => events.find((e) => e.approvalRequired)?.approvalRequired, 'the approval');
    await made.service.toolApprove({ requestId: request.id, approved: true });
    await run;
    return made.repo.state.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === 'w1');
  } };
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
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/checkpoints.test.cjs tests/service.test.cjs`
Expected: FAIL — `Cannot find module '../src/main/audit/checkpoints.ts'`; the service tests fail on `call.change.undo` being undefined (and `created` true for the big file).

- [ ] **Step 3: Add the fields to `FileChange`** in `src/shared/types.ts`:

```ts
  /** Undo: 'kept' when Axon kept the version this write replaced; 'unreadable' when it couldn't (over 1 MB or not text). */
  undo?: 'kept' | 'unreadable';
  /** When you undid this change. */
  revertedAt?: number;
```

- [ ] **Step 4: `Project.exists`** — in `src/main/project.ts`, after `read`:

```ts
  /** Whether a file is there, by the same checks as reading it. */
  async exists(path: string): Promise<boolean> {
    try {
      await lstat(await this.safe(path));
      return true;
    } catch {
      return false;
    }
  }
```

- [ ] **Step 5: `write_file` stops guessing** — in `src/main/tools/registry.ts`, add to `ToolHandlerResult`:

```ts
  /** A write's previous content, for undo; kept by the service, never sent to the model or the window. */
  previous?: { existed: boolean; content: string | null };
```

and replace `write_file`'s `execute`:

```ts
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const filePath = String(args.path);
          const content = String(args.content);
          // Whether it exists is asked first: a file too big (or too binary) to read is not a new file.
          const existed = await ctx.project.exists(filePath);
          let before: string | null = null;
          if (existed) {
            try {
              before = await ctx.project.read(filePath);
            } catch {
              before = null;
            }
          }
          await ctx.project.write(filePath, content);
          const change = fileChange(before, content);
          if (existed && before === null) change.created = false;
          return {
            content: `Successfully wrote ${content.length} characters to ${filePath}.`,
            change,
            previous: { existed, content: before }
          };
        } catch (err: any) {
          return { content: `Error writing file: ${err.message}`, isError: true };
        }
      }
```

- [ ] **Step 6: Create `src/main/audit/checkpoints.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** The version a write replaced, so you can undo it. */
export interface Checkpoint {
  toolCallId: string;
  conversationId: string;
  /** The project folder it was written in, and the path inside it. */
  root: string;
  path: string;
  /** Whether the file was there before; with no `before`, it was but couldn't be read. */
  existed: boolean;
  before?: string;
  /** What the write left, to tell whether the file has changed since. */
  afterHash: string;
  savedAt: number;
}

export const CHECKPOINTS_KEPT = 500;
export const CHECKPOINT_BYTES = 200 * 1024 * 1024;
export const hashText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** One file per checkpoint, named by a hash of its tool call: provider ids never become paths. */
export class Checkpoints {
  constructor(
    private readonly dir: string,
    private readonly limits = { count: CHECKPOINTS_KEPT, bytes: CHECKPOINT_BYTES },
    private readonly now: () => number = Date.now
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private fileOf(toolCallId: string): string {
    return join(this.dir, `${createHash('sha1').update(toolCallId).digest('hex')}.json`);
  }

  /** Keeps a checkpoint and prunes the oldest; false when it couldn't be kept. */
  async save(point: Omit<Checkpoint, 'savedAt'>): Promise<boolean> {
    try {
      await writeFile(this.fileOf(point.toolCallId), JSON.stringify({ ...point, savedAt: this.now() }), 'utf8');
      await this.prune();
      return true;
    } catch {
      return false;
    }
  }

  async get(toolCallId: string): Promise<Checkpoint | null> {
    try {
      const point = JSON.parse(await readFile(this.fileOf(toolCallId), 'utf8')) as Checkpoint;
      return point.toolCallId === toolCallId && typeof point.root === 'string' && typeof point.path === 'string' ? point : null;
    } catch {
      return null;
    }
  }

  async remove(toolCallId: string): Promise<void> {
    try { await unlink(this.fileOf(toolCallId)); } catch { /* already gone */ }
  }

  /** Newest first by when each was saved; past the count or the bytes, the rest go. */
  private async prune(): Promise<void> {
    const files = await Promise.all((await readdir(this.dir)).filter((name) => name.endsWith('.json')).map(async (name) => {
      const path = join(this.dir, name);
      const info = await stat(path);
      let savedAt = info.mtimeMs;
      try { savedAt = (JSON.parse(await readFile(path, 'utf8')) as Checkpoint).savedAt ?? savedAt; } catch { /* keep the file time */ }
      return { path, size: info.size, savedAt };
    }));
    files.sort((a, b) => b.savedAt - a.savedAt);
    let count = 0, bytes = 0;
    for (const file of files) {
      count++;
      bytes += file.size;
      if (count > this.limits.count || bytes > this.limits.bytes) await unlink(file.path).catch(() => undefined);
    }
  }
}
```

- [ ] **Step 7: The service keeps it** — in `src/main/service.ts`:

Imports: `import { Checkpoints, hashText } from './audit/checkpoints';` and `import type { ToolHandlerResult } from './tools/registry';`.

Field and construction (next to `audit`):

```ts
  /** The versions writes replaced, for undo. */
  readonly checkpoints: Checkpoints;
```

```ts
    this.checkpoints = new Checkpoints(join(dataPath, 'checkpoints'));
```

Add after `actorOf`:

```ts
  /** Keeps the version a write replaced so you can undo it, and says on the change whether it could. */
  private async keepCheckpoint(conversationId: string, tc: ToolCall, args: Record<string, any>, result: ToolHandlerResult): Promise<void> {
    const previous = result.previous!;
    if (previous.existed && previous.content === null) {
      result.change!.undo = 'unreadable';
      return;
    }
    const kept = await this.checkpoints.save({
      toolCallId: tc.id,
      conversationId,
      root: this.project.root!,
      path: String(args.path),
      existed: previous.existed,
      ...(previous.content !== null ? { before: previous.content } : {}),
      afterHash: hashText(String(args.content))
    });
    if (kept) result.change!.undo = 'kept';
  }
```

In the tool-call loop, between `const result = await toolImpl.execute(...)` and `answer(...)`, keep the checkpoint; the audit entry says when a write can't be undone. The `answer(...)` line becomes:

```ts
          if (tc.name === 'write_file' && result.previous && result.change && !result.isError && this.project.root)
            await this.keepCheckpoint(id, tc, parsedArgs, result);
          const notes = [
            check.bySession ? 'Allowed for this session' : '',
            tc.name === 'write_file' && result.change && result.change.undo !== 'kept' ? "Can't be undone" : ''
          ].filter(Boolean);
          answer(tc, result, decision, notes.join('. ') || undefined);
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `node --test tests/checkpoints.test.cjs tests/service.test.cjs tests/tools.test.cjs && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 9: Commit**

```bash
git add src/main/audit/checkpoints.ts src/shared/types.ts src/main/tools/registry.ts src/main/project.ts src/main/service.ts tests/checkpoints.test.cjs tests/service.test.cjs
git commit -m "feat(undo): each saved write keeps the version it replaced; unreadable files aren't called new"
```

---

### Task 5: Undo a saved change

**Files:**
- Modify: `src/main/project.ts` (`remove`), `src/main/service.ts` (`revertChange`)
- Modify: `src/shared/platform.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/service.test.cjs` (append)

**Interfaces:**
- Consumes: `Checkpoints`, `hashText` (Task 4); `answerDialog`, `electron` (service tests, Wave 1).
- Produces: `Project.remove(path): Promise<void>`; `Service.revertChange(toolCallId: string): Promise<void>` (rejects with "Undo cancelled." on Cancel); `window.axon.revertChange`.

- [ ] **Step 1: Write the failing tests** — append to `tests/service.test.cjs`:

```js
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
  assert.deepEqual(service.audit.all().at(-1).decision, 'reverted');
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/service.test.cjs`
Expected: FAIL — `service.revertChange is not a function`.

- [ ] **Step 3: `Project.remove`** — in `src/main/project.ts`, import `unlink` from `node:fs/promises` and add after `write`:

```ts
  /** Deletes a file inside the project (undoing one a coworker created). Same checks as reading it. */
  async remove(path: string): Promise<void> {
    const target = await this.safe(path);
    if ((await lstat(target)).isDirectory()) throw new Error('Only files can be removed.');
    await unlink(target);
  }
```

- [ ] **Step 4: `Service.revertChange`** — in `src/main/service.ts` (import `resolve` from `node:path` alongside `basename, join`), add after `auditExport`:

```ts
  /**
   * Undoes a coworker's saved write: puts back the version it replaced, or deletes a file it created.
   * Only a path from the write's checkpoint, only in the project it was made in, and only after you
   * confirm (Cancel is the default); it warns when the file has changed since.
   */
  async revertChange(toolCallId: string): Promise<void> {
    const point = await this.checkpoints.get(text(toolCallId, 200));
    if (!point) throw new Error("This change can't be undone any more (only the last 500 are kept).");
    if (point.existed && point.before === undefined) throw new Error("Axon couldn't keep this file's previous version (it's over 1 MB or not text).");
    if (!this.project.root || resolve(this.project.root) !== resolve(point.root)) throw new Error(`Open ${point.root} to undo this change.`);
    let current: string | null = null;
    try { current = await this.project.read(point.path); } catch { current = null; }
    const changedSince = current === null ? point.existed : hashText(current) !== point.afterHash;
    const message = this.state.messages.find(m => m.toolCalls?.some(c => c.id === point.toolCallId));
    const call = message?.toolCalls?.find(c => c.id === point.toolCallId);
    const chat = this.state.conversations.find(c => c.id === point.conversationId);
    const who = coworkerById(chat?.agentId)?.name ?? 'the assistant';
    const choice = await dialog.showMessageBox({
      type: 'warning',
      message: `Undo ${who}'s change to ${point.path}?`,
      detail: [
        point.existed ? `Puts back the version from before ${new Date(point.savedAt).toLocaleString()}.` : 'Deletes the file they created.',
        changedSince ? 'The file has changed since they saved it: undoing replaces those later edits too.' : ''
      ].filter(Boolean).join('\n\n'),
      buttons: ['Cancel', 'Undo change'],
      defaultId: 0,
      cancelId: 0
    });
    if (choice.response !== 1) throw new Error('Undo cancelled.');
    if (point.existed) await this.project.write(point.path, point.before!);
    else if (current !== null) await this.project.remove(point.path);
    if (call?.change) call.change.revertedAt = Date.now();
    this.audit.record({
      conversationId: point.conversationId, actor: { kind: 'you', name: 'You' }, tool: 'write_file', subject: point.path,
      decision: 'reverted', toolCallId: point.toolCallId, detail: point.existed ? 'Put back the previous version.' : 'Deleted the file they created.'
    });
    await this.checkpoints.remove(point.toolCallId);
    await this.repo.save();
  }
```

- [ ] **Step 5: Expose over IPC** — `platform.ts` after `auditExport`:

```ts
  /** Undoes a coworker's saved write after asking; rejects with "Undo cancelled." on Cancel. */
  revertChange(toolCallId: string): Promise<void>;
```

`index.ts`: add `'revertChange',` after `'auditExport',`. Preload: add `revertChange: invoke('revertChange'),` after `auditExport: invoke('auditExport'),`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `node --test tests/service.test.cjs && npm run typecheck`
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add src/main/project.ts src/main/service.ts src/shared/platform.ts src/main/index.ts src/preload/index.ts tests/service.test.cjs
git commit -m "feat(undo): undo a coworker's saved change after asking, in the project it was made in"
```

---

### Task 6: The approval card shows a real diff

**Files:**
- Create: `src/renderer/src/ui/DiffLines.tsx`
- Modify: `src/renderer/src/features/office/workspace/WorkViews.tsx` (use it; remove the moved code)
- Modify: `src/renderer/src/ui/ApprovalCard.tsx`, `src/renderer/src/layout.css`

**Interfaces:**
- Consumes: `diffRows`, `diffStats`, `languageOf`, `baseName`, `type DiffRow` from `features/office/workspace/work.ts`.
- Produces: `DiffLines({ rows: DiffRow[]; path: string; limit?: number })`, `escapeHtml(text): string` from `src/renderer/src/ui/DiffLines.tsx`.

- [ ] **Step 1: Create `src/renderer/src/ui/DiffLines.tsx`** — move `DiffText`, `hunkLabel` and `HIGHLIGHT_ROWS` out of `WorkViews.tsx`, renamed and with a row limit:

```tsx
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { baseName, languageOf, type DiffRow } from '../features/office/workspace/work';

/** Past this many rows, lines are not highlighted (it would stall the window). */
const HIGHLIGHT_ROWS = 3000;

export const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Lines 12–18" for a hunk header. */
function hunkLabel(header: string): string {
  const [, start, count = '1'] = /\+(\d+)(?:,(\d+))?/.exec(header) ?? [];
  const from = Number(start);
  const to = from + Number(count) - 1;
  return to > from ? `Lines ${from}–${to}` : `Line ${from}`;
}

/**
 * A file's changes: each hunk with its old and new line numbers, scrolled to the first change. With
 * `limit`, longer diffs show their first rows and a button for the rest.
 */
export function DiffLines({ rows: all, path, limit }: { rows: DiffRow[]; path: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = limit && !expanded && all.length > limit ? all.slice(0, limit) : all;
  const scroller = useRef<HTMLDivElement>(null);
  const language = languageOf(path);
  const markup = useMemo(
    () =>
      rows.map((row) =>
        row.kind === 'hunk'
          ? ''
          : rows.length <= HIGHLIGHT_ROWS && language && hljs.getLanguage(language)
            ? hljs.highlight(row.text, { language, ignoreIllegals: true }).value
            : escapeHtml(row.text)
      ),
    [rows, language]
  );
  const first = rows.findIndex((row) => row.kind === 'add' || row.kind === 'del');
  useLayoutEffect(() => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>(`[data-row="${first}"]`);
    if (el && row) el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 3);
  }, [first]);
  return (
    <div className="work-code-scroll work-diff" ref={scroller} tabIndex={0} aria-label={`Changes to ${baseName(path)}`}>
      <table className="work-diff-table">
        <tbody>
          {rows.map((row, i) =>
            row.kind === 'hunk' ? (
              <tr key={i} className="work-diff-hunk">
                <td colSpan={3}>{hunkLabel(row.text)}</td>
              </tr>
            ) : (
              <tr key={i} className={`work-diff-${row.kind}`} data-row={i}>
                <td className="work-diff-num">{row.oldLine ?? ''}</td>
                <td className="work-diff-num">{row.newLine ?? ''}</td>
                <td className="work-diff-code">
                  <span className="work-diff-mark" aria-hidden="true">
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                  <code className="hljs" dangerouslySetInnerHTML={{ __html: markup[i] }} />
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      {rows.length < all.length && (
        <button type="button" className="work-diff-more" onClick={() => setExpanded(true)}>
          Show all {all.length} lines
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it in `WorkViews.tsx`** — delete `HIGHLIGHT_ROWS`, `hunkLabel`, `DiffText` and the `escapeHtml` constant from `WorkViews.tsx`; add `import { DiffLines, escapeHtml } from '../../../ui/DiffLines';`; replace `<DiffText key={`${file.path}|changes`} rows={rows} path={file.path} />` with `<DiffLines key={`${file.path}|changes`} rows={rows} path={file.path} />`. Remove imports left unused (typecheck says which).

- [ ] **Step 3: The approval card** — in `src/renderer/src/ui/ApprovalCard.tsx`, add:

```tsx
import { DiffLines } from './DiffLines';
import { diffRows, diffStats } from '../features/office/workspace/work';
```

After `const preview = request.preview;`:

```tsx
  const path = preview?.path ?? String(request.arguments.path ?? '');
  const stats = preview?.type === 'diff' ? diffStats(preview.content) : null;
```

Replace the description `div` with:

```tsx
      <div className="approval-description">
        {stats ? (
          stats.created ? (
            <>
              Create <code>{path}</code>: {stats.added} line{stats.added === 1 ? '' : 's'}.
            </>
          ) : (
            <>
              Save changes to <code>{path}</code>: {stats.added} added, {stats.removed} removed.
            </>
          )
        ) : (
          <>
            The assistant is requesting permission to execute <code>{request.toolName}</code>
            {request.arguments.path ? (
              <>
                {' '}
                on file <code>{String(request.arguments.path)}</code>
              </>
            ) : request.arguments.command ? (
              <>
                : command <code>{String(request.arguments.command)}</code>
              </>
            ) : null}
            .
          </>
        )}
      </div>
```

and replace the whole `{preview?.type === 'diff' && (<div className="approval-preview-diff">…</div>)}` block with:

```tsx
      {preview?.type === 'diff' && (
        <div className="approval-preview-diff">
          <DiffLines rows={diffRows(preview.content)} path={path} limit={400} />
        </div>
      )}
```

- [ ] **Step 4: Style it** — in `src/renderer/src/layout.css`, replace the rules for `.approval-diff-line` (and its `.add`/`.del`/`.hdr` variants) with:

```css
/* The proposed change, as the work surface shows it; long ones scroll inside the card. */
.approval-preview-diff .work-diff {
  max-height: 320px;
  overflow: auto;
}
.work-diff-more {
  display: block;
  width: 100%;
  padding: 6px;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npx prettier --check src/renderer/src/ui/DiffLines.tsx src/renderer/src/ui/ApprovalCard.tsx`
Expected: clean (for `WorkViews.tsx`, check only your lines against its `git show HEAD:` version). The card is checked on screen in Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/ui/DiffLines.tsx src/renderer/src/ui/ApprovalCard.tsx src/renderer/src/features/office/workspace/WorkViews.tsx src/renderer/src/layout.css
git commit -m "feat(audit): the approval card shows the proposed change as a real diff, and says it in words"
```

---

### Task 7: Undo in the work surface

**Files:**
- Modify: `src/renderer/src/features/office/workspace/WorkViews.tsx` (`FileBar`, new `UndoChange`), `src/renderer/src/features/office/workspace/workspace.css`
- Modify: `src/renderer/src/features/office/activity/WorkSummary.tsx`

**Interfaces:**
- Consumes: `window.axon.revertChange` (Task 5); `FileChange.undo`, `revertedAt` (Task 4); `WorkStep` (`id` is the tool call's id; `change`).

- [ ] **Step 1: `UndoChange`** — in `WorkViews.tsx`, import `useApp` from `'../../../state'` and add before `FileBar`:

```tsx
/** Undo for a saved write: asks natively first, and says why when it can't. */
function UndoChange({ step }: { step: WorkStep }) {
  const [busy, setBusy] = useState(false);
  const change = step.change;
  if (!change || step.state !== 'done') return null;
  if (change.revertedAt) return <span className="work-file-note">Undone</span>;
  if (change.undo !== 'kept')
    return (
      <span className="work-file-note">
        {change.undo === 'unreadable' ? "Can't be undone: over 1 MB or not text" : "Can't be undone"}
      </span>
    );
  const undo = async () => {
    setBusy(true);
    try {
      await window.axon.revertChange(step.id);
      await useApp.getState().refresh();
      useApp.getState().pushToast('Change undone');
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
      if (!/cancelled/i.test(message)) useApp.getState().patch({ error: message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="work-undo" disabled={busy} onClick={() => void undo()}>
      {busy ? 'Undoing…' : 'Undo this change'}
    </button>
  );
}
```

In `FileBar`'s `work-file-actions`, after `{request && <Decision request={request} approve="Approve" />}`:

```tsx
        {!request && file.written && <UndoChange step={file.written} />}
```

- [ ] **Step 2: Style it** — append to `workspace.css`:

```css
/* Undo a saved change: quiet until you need it. */
.work-undo {
  padding: 3px 9px;
  border: 1px solid var(--office-border);
  border-radius: 7px;
  background: var(--office-paper);
  color: var(--office-ink);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.work-undo:hover:not(:disabled) {
  background: var(--office-soft);
}
.work-undo:disabled {
  opacity: 0.6;
  cursor: default;
}
```

- [ ] **Step 3: "Undone" in the work summary** — in `WorkSummary.tsx`, the `state` helper's first branch becomes:

```tsx
  const state = (step: WorkStep, done: string, failed: string) =>
    step.change?.revertedAt
      ? { label: 'Undone', tone: 'done' }
      : requests.has(step.id)
        ? { label: 'Waiting for your OK', tone: 'waiting' }
        : step.state === 'running'
          ? { label: step.name === 'write_file' ? 'Saving…' : 'Running…', tone: 'running' }
          : step.state === 'failed'
            ? { label: failed, tone: 'failed' }
            : { label: done, tone: 'done' };
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: clean; all tests pass.

```bash
git add src/renderer/src/features/office/workspace/WorkViews.tsx src/renderer/src/features/office/workspace/workspace.css src/renderer/src/features/office/activity/WorkSummary.tsx
git commit -m "feat(undo): undo a saved change from the work surface; undone changes say so"
```

---

### Task 8: Settings → Activity log

**Files:**
- Create: `src/renderer/src/settings/ActivitySection.tsx`
- Modify: `src/renderer/src/Settings.tsx`, `src/renderer/src/settings/settings.css`

**Interfaces:**
- Consumes: `window.axon.auditList`, `window.axon.auditExport` (Task 3); `AuditEntry`, `AuditGroup`, `DECISION_WORDS` (Task 1); `COWORKERS` from `src/shared/coworkers.ts`; `useOfficeStore` (`openOverlay`, `focusOn`, `focusWork`).
- Produces: Settings section id `'activity'` (tab `#settings-tab-activity`), label "Activity log".

- [ ] **Step 1: Create `src/renderer/src/settings/ActivitySection.tsx`**

```tsx
import { useEffect, useState } from 'react';
import type { AuditEntry, AuditGroup } from '../../../shared/audit';
import { DECISION_WORDS } from '../../../shared/audit';
import { COWORKERS } from '../../../shared/coworkers';
import { useApp } from '../state';
import { useOfficeStore } from '../features/office/store/officeStore';
import { Button, IconDownload, IconRefresh } from '../ui';
import { SettingsGroup } from './controls';

const PAGE = 100;
const GROUPS: { value: AuditGroup; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'asked', label: 'Asked you' },
  { value: 'refused', label: 'Refused or not run' },
  { value: 'changes', label: 'File changes' }
];
const TONE: Record<AuditEntry['decision'], string> = {
  allowed: 'ok', approved: 'ok', 'approved-session': 'ok', reverted: 'you',
  rejected: 'bad', denied: 'bad', 'timed-out': 'warn', withdrawn: 'warn', skipped: 'warn'
};
const errorText = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(err);
const toolWords = (tool: string) => tool.replace(/^mcp_/, '').replace(/_/g, ' ');
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const byName = [...COWORKERS].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Settings → Activity log: every tool call any agent made (coworkers, the colleagues they asked,
 * sub-agents), what was decided and by whom. Kept on this computer; exportable.
 */
export function ActivitySection() {
  const conversations = useApp((s) => s.data?.conversations ?? []);
  const [group, setGroup] = useState<AuditGroup>('all');
  const [actorId, setActorId] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');

  const load = async (after?: AuditEntry) => {
    setError('');
    try {
      const page = await window.axon.auditList({ group, actorId: actorId || undefined, afterId: after?.id, limit: PAGE });
      setEntries((current) => (after ? [...(current ?? []), ...page] : page));
      setMore(page.length === PAGE);
    } catch (err) {
      setError(errorText(err));
    }
  };
  useEffect(() => {
    void load();
  }, [group, actorId]);

  const show = (entry: AuditEntry) => {
    const chat = conversations.find((c) => c.id === entry.conversationId);
    if (!chat?.agentId || !entry.toolCallId) return;
    const office = useOfficeStore.getState();
    office.openOverlay(null);
    office.focusOn({ agentId: chat.agentId, conversationId: chat.id });
    office.focusWork(chat.id, entry.toolCallId);
  };
  const exportLog = async () => {
    try {
      if (await window.axon.auditExport()) useApp.getState().pushToast('Activity log saved');
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h3>Activity log</h3>
          <p>
            Every tool your coworkers used, including the colleagues they asked and the sub-agents they sent, and
            what was decided: allowed, asked you, refused.
          </p>
        </div>
        <Button icon={IconDownload} onClick={() => void exportLog()}>
          Export…
        </Button>
      </header>
      <div className="activity-log-filters">
        <select className="select" aria-label="Show" value={group} onChange={(e) => setGroup(e.target.value as AuditGroup)}>
          {GROUPS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Who" value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">Everyone</option>
          {byName.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" icon={IconRefresh} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {error && (
        <div className="banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {entries && (
        <SettingsGroup>
          {entries.length === 0 ? (
            <p className="usage-empty">Nothing here yet.</p>
          ) : (
            <ul className="activity-log" aria-label="Activity">
              {entries.map((entry) => {
                const chat = conversations.find((c) => c.id === entry.conversationId);
                return (
                  <li key={entry.id} className="activity-log-row">
                    <time>{when(entry.at)}</time>
                    <div className="activity-log-main">
                      <div>
                        <strong>{entry.actor.name}</strong>
                        {entry.actor.onBehalfOf && <span className="usage-muted"> for {entry.actor.onBehalfOf}</span>}{' '}
                        {toolWords(entry.tool)}
                        {entry.subject && <code className="activity-log-subject">{entry.subject}</code>}
                      </div>
                      {(entry.result === 'error' || entry.detail) && (
                        <div className="usage-muted">
                          {entry.result === 'error' ? 'Failed: ' : ''}
                          {entry.detail}
                        </div>
                      )}
                    </div>
                    <span className={`audit-badge tone-${TONE[entry.decision]}`}>{DECISION_WORDS[entry.decision]}</span>
                    {chat?.agentId && entry.toolCallId ? (
                      <Button size="sm" variant="ghost" onClick={() => show(entry)}>
                        Show
                      </Button>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SettingsGroup>
      )}
      {more && entries && (
        <Button variant="ghost" onClick={() => void load(entries[entries.length - 1])}>
          Load more
        </Button>
      )}
      <p className="settings-footnote">
        Kept on this computer, newest 20,000 entries. It holds what each call was about (a path, a command), never
        what was in a file.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `Settings.tsx`** — `import { ActivitySection } from './settings/ActivitySection';`, add `IconHistory` to the `./ui` import, extend `Section` with `'activity'`, add `{ id: 'activity', label: 'Activity log', icon: IconHistory },` after the `usage` entry, and `{section === 'activity' && <ActivitySection />}` after the usage line.

- [ ] **Step 3: Style it** — append to `src/renderer/src/settings/settings.css`:

```css
/* Activity log: filters in one row, then one line per call */
.activity-log-filters {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.activity-log-filters .select {
  width: auto;
}
.activity-log {
  margin: 0;
  padding: 0;
  list-style: none;
}
.activity-log-row {
  display: grid;
  grid-template-columns: 9.5em minmax(0, 1fr) auto auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-sm);
}
.activity-log-row + .activity-log-row {
  border-top: 1px solid var(--border-subtle);
}
.activity-log-row time {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.activity-log-subject {
  margin-left: var(--space-2);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--surface-hover);
  font-size: var(--text-xs);
  word-break: break-all;
}
.audit-badge {
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  white-space: nowrap;
}
.audit-badge.tone-ok {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.audit-badge.tone-bad {
  background: var(--danger-soft);
  color: var(--danger-text);
}
.audit-badge.tone-warn {
  background: var(--surface-hover);
  color: var(--warning-text);
}
.audit-badge.tone-you {
  background: var(--surface-hover);
  color: var(--text-primary);
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npx prettier --check src/renderer/src/settings/ActivitySection.tsx src/renderer/src/Settings.tsx src/renderer/src/settings/settings.css`
Expected: clean (run `npx prettier --write` on the new file if needed).

```bash
git add src/renderer/src/settings/ActivitySection.tsx src/renderer/src/Settings.tsx src/renderer/src/settings/settings.css
git commit -m "feat(audit): Settings → Activity log, filtered by who and what, with export"
```

---

### Task 9: Desktop end-to-end, docs, and the whole suite

**Files:**
- Modify: `tests/electron-smoke.cjs`, `README.md`

- [ ] **Step 1: A tool call in the smoke run** — in the mock provider's request handler, before the success response, answer the first "List the files" request with a tool call:

```js
    const parsed = (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; } })();
    const last = parsed.messages?.at(-1);
    if (last?.role === 'user' && last.content === 'List the files') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_list","type":"function","function":{"name":"list_files","arguments":"{}"}}]}}]}\n\n');
      response.write('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n');
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
```

(It goes after the `lastAuth` check, so the key is still asserted.)

In the first script block, after the restore-points check, add:

```js
        // Wave 2: a tool call lands in the activity log, with its decision.
        await window.axon.chatSend(chat.id, 'List the files', []);
        const activity = await window.axon.auditList({});
        if (!activity.some((e) => e.tool === 'list_files' && e.decision === 'allowed')) throw new Error('Activity log wrong: ' + JSON.stringify(activity));
```

The IPC usage assertion (`report.allTime.turns !== 1`) already runs before this send: keep that order. The on-screen Usage check later sees two priced replies, so change its cost test from `!usage.includes('<$0.0001')` to `!/\$0\.000/.test(usage)` (both `<$0.0001` and `$0.0002` match).

- [ ] **Step 2: The page on screen** — after the restore-points screenshot, add:

```js
      result.activityLog = await contents.executeJavaScript(`(async () => {
        document.querySelector('#settings-tab-activity').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const rows = document.querySelectorAll('.activity-log-row');
        if (!rows.length || !rows[0].textContent.includes('list files') || !rows[0].textContent.includes('Allowed')) throw new Error('Activity log not shown: ' + document.querySelector('.settings-content').textContent);
        return rows.length;
      })()`);
      await shot('activity-log');
```

- [ ] **Step 3: Build and run**

Run: `npm run build && npm run test:desktop`
Expected: no failure from the new steps (the first failure, if any, is the pre-existing layered-Escape `tagName` one). `test-results/activity-log.png` has today's time.

- [ ] **Step 4: Look at it** — open `test-results/activity-log.png` with the Read tool. Check: one line per call, the badge readable in dark mode, the subject not overflowing. Fix CSS if needed, rebuild, rerun, look again.

- [ ] **Step 5: Document it** — in `README.md` under `## Implemented`, add:

```markdown
- Settings → Activity log: every tool call any agent made (coworkers, the colleagues they consulted, sub-agents) with what was decided and by whom. Kept on this computer (newest 20,000), never with file contents; exportable.
- Undo a coworker's saved file change from the work surface. Axon keeps the version each write replaced (newest 500), asks before undoing, and warns if the file changed since. Approval cards show the proposed change as a diff.
```

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm test`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add tests/electron-smoke.cjs README.md
git commit -m "test(audit): the desktop app records a tool call and shows it in the activity log; docs"
```
