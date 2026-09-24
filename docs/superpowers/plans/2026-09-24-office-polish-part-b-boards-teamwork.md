# Office polish — Part B: Task boards and teamwork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task you give a coworker becomes a live card on their team's board. Coworkers can ask a colleague a question while they work: the colleague answers from their own expertise, walks over in the office, and shows "Helping …" on their own board.

**Architecture:**
- The main process keeps **task records** in the saved state (`PlatformState.tasks`).
  - A `TaskStore` owns them.
  - A `TaskTracker` turns each run's lifecycle into `work` records. Its hooks in `chatSend` are start, approval pending/resolved and end.
  - Every change is pushed to the renderer as a `tasks` stream event carrying the full list.
- **Conversations get a toolset from their coworker** (`toolsFor`). File tools still need a folder. Every coworker gets `ask_colleague`, which runs a **consult**: the existing sub-agent loop, generalised, with the colleague's own prompt and roles, read-only tools and no further asking. Each consult is a `help` record. The coworker directory and the specialty search move to `src/shared` so the main process can resolve colleagues.
- **In the renderer:**
  - people's status comes from the task records;
  - boards draw their cards from one atlas;
  - a board click opens the **team list** in the side panel;
  - `ask_colleague` calls render as **colleague cards**;
  - `help` records send the colleague to the asker's desk in the simulation.

**Tech Stack:** Electron main (TypeScript), React 18 + Zustand, three r186, `node:test` with the TS transpile hook and the `electron` stub used by `tests/service.test.cjs`, and the Electron desktop check.

**Spec:** [docs/superpowers/specs/2026-09-24-office-polish-teamwork-reception-design.md](../specs/2026-09-24-office-polish-teamwork-reception-design.md) §5, §7, §8, §9, §10 (Part B items).

## Global Constraints

- One `work` record per conversation with a coworker. The receptionist (`receptionist`, arriving in Part C) never gets `work` records.
- A work record's title is the first line of the first message's visible text (no file context or attachments), at most 80 characters.
- Status comes from the run:
  - `working` while it generates;
  - `attention` with the note "Waiting for your approval" while an approval is pending, or with the error text when the run fails;
  - `done` when it finishes; `done` with the note "Stopped" when stopped by the user;
  - on start-up, `working` records become `attention` with the note "Interrupted".
- At most **3** `ask_colleague` calls per `chatSend` run. The fourth returns "You have asked three colleagues already; finish with what you have."
- Consults:
  - use the asker's provider and model, at most 5 steps;
  - get read-only file tools only when the asker's conversation has a folder;
  - never get `ask_colleague`, `dispatch_subagent` or planner tools.
- `PermissionManager.check` returns `allow` for `ask_colleague`.
- Office tools live in their own registry, never in `ToolRegistry`.
- Boards: up to 4 cards, most recently updated first, with `attention` pinned first. Colours: **Working** blue, **Needs attention** amber, **Done** green.
- Help walks count as required walkers; reduced motion means no walk.
- Draw calls at the whole-campus view stay ≤ 733 (Part A's budget); boards add one draw call.
- Every task ends with `npm run typecheck` and `npm test` green (`TEMP`/`TMP` = `D:\axon-tmp`). Commits go on `feature/look-and-shell` with the `Co-Authored-By` trailer.
- Only format files that were Prettier-clean before (see Part A).

## Deviations from the spec (recorded in its revisions at the end)

1. **Boards show a 2 × 2 grid of status-coloured tiles** with a short title and the person's initials, not four text rows. At the camera's closest zoom a 1.1 m board fits about 7 px text per row, so four text rows would be unreadable. The tiles read at a glance, and the team list has the details.
2. **Department boards widen from 2.0 m to 2.4 m** (the Sales gong and Customer Success trophies move over). The Library, Planning, Lounge and Files room each get a board. Leadership gets one in front of its offices, since it had none.
3. **`ask_colleague` returns a small JSON object** `{ colleague, name, answer }`, so the card knows who answered. Errors return plain text.
4. **`TaskItem` gains `runStartedAt`** on work records, so a colleague's walk-over belongs to the run that asked.
5. **`MessageView` gains a `renderToolCall` prop**, so the office draws its own cards without the chat renderer knowing about coworkers.

## File map

| File | Responsibility |
|---|---|
| `src/shared/coworkers.ts` (new) | the 207-person directory: core team text, specialists from `roles.json` + Business Analyst, `coworkerById`, `RECEPTIONIST_ID` |
| `src/shared/coworkerSearch.ts` (new) | `scoreCoworkers` / `rankCoworkers` over any list, given its fields |
| `src/renderer/src/features/office/data/officeAgents.ts`, `coworkerCatalog.ts`, `shell/search.ts` | built on the shared directory and search |
| `src/shared/types.ts`, `src/shared/platform.ts` | `TaskItem`, `tasks` event, `PlatformState.tasks` |
| `src/main/repository.ts` | migration and validation of `tasks` |
| `src/main/tasks/store.ts` (new) | `TaskStore`: list, add, update, find, emit |
| `src/main/tasks/tracker.ts` (new) | `TaskTracker` and `taskTitle` |
| `src/main/officeTools.ts` (new) | `toolsFor`, the office tool registry |
| `src/main/colleagues.ts` (new) | `ASK_COLLEAGUE`, `resolveColleague`, `consult` |
| `src/main/service.ts` | thin hooks: tracker calls, toolset, office tools, consult; `runSubagent` guard fix |
| `src/main/security/permissions.ts` | allow `ask_colleague` |
| `src/renderer/src/App.tsx` | `tasks` events patch `data.tasks` |
| `features/office/tasks.ts` (new) | pure: `teamOf`, `boardCards`, `teamList`, `statusesFromTasks`, `activeHelp`, `parseColleagueCall` |
| `features/office/campus/boards.ts` (new) | board list, room and Leadership boards |
| `features/office/scene/room/boards.ts` (new) | `BoardLayer`: atlas, faces, redraw, picking |
| `features/office/scene/OfficeScene.ts`, `OfficeCanvas.tsx` | boards, help walks, status sync, board clicks |
| `features/office/simulation/OfficeSimulation.ts` | `startHelp` / `endHelp` |
| `features/office/activity/TeamList.tsx`, `ColleagueCard.tsx` (new), `ActivityPanel.tsx`, `Conversation.tsx`, `chat/MessageView.tsx`, `store/officeStore.ts`, `office.css` | the team list, colleague cards, status sync |
| `tests/tasks.test.cjs`, `tests/colleagues.test.cjs` (new), `tests/service.test.cjs`, `tests/office-boards.test.cjs` (new), `tests/office-sim.test.cjs`, `tests/office-desktop.cjs` | tests |

---

### Task 1: One coworker directory and search, shared by both processes

**Files:**
- Create: `src/shared/coworkers.ts`, `src/shared/coworkerSearch.ts`
- Modify: `features/office/data/officeAgents.ts`, `data/coworkerCatalog.ts`, `shell/search.ts`
- Test: `tests/colleagues.test.cjs` (new; same TS hook header as `office-campus.test.cjs`)

**Interfaces:**

```ts
// src/shared/coworkers.ts
export const RECEPTIONIST_ID = 'receptionist';
export interface Coworker {
  id: string; name: string;
  role: string;            // 'Research & Insights' for the core team, the department for specialists
  department: string;      // 'Library', 'Planning', … for the core team; the catalog group for specialists
  description: string; capabilities: string[]; systemPrompt: string;
  roleIds: string[]; core: boolean;
}
export const SPECIALIST_ROLES: readonly Role[];   // roles.json + Business Analyst (moved here)
export const SPECIALIST_GROUPS: readonly string[];
export const COWORKERS: readonly Coworker[];      // 8 core, then specialists in catalog order
export function coworkerById(id: string): Coworker | undefined;

// src/shared/coworkerSearch.ts
export interface SearchFields { name: string; area: string; about: string; prompt: string }
export function scoreCoworkers<T>(query: string, items: readonly T[], fields: (item: T) => SearchFields): { item: T; score: number }[];
export function rankCoworkers<T>(query: string, items: readonly T[], fields: (item: T) => SearchFields, limit?: number): T[];
```

- `OFFICE_AGENTS` becomes `COWORKERS.map(...)`, adding `district`, `accentColor`, `accentSoft` and `status`. The core looks move to a small `CORE_LOOKS` map, and district colours stay for specialists.
- `searchCoworkers(query, agents, limit)` in `shell/search.ts` wraps `rankCoworkers`:
  - `area` = department, role and district name;
  - `about` = capabilities and description;
  - `prompt` = the system prompt.

  The existing search tests stay unchanged and must still pass.

- [ ] **Step 1: Write the failing tests** (`tests/colleagues.test.cjs`):

```js
const shared = require('../src/shared/coworkers.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

test('the shared directory holds the whole office, core team first', () => {
  assert.equal(shared.COWORKERS.length, 207);
  assert.deepEqual(shared.COWORKERS.slice(0, 8).map((c) => c.core), Array(8).fill(true));
  assert.deepEqual(shared.COWORKERS.map((c) => c.id), agents.OFFICE_AGENTS.map((a) => a.id));
  const backend = shared.coworkerById('backend-developer');
  assert.match(backend.systemPrompt, /Backend Developer/);
  assert.deepEqual(backend.roleIds, ['backend-developer']);
  assert.equal(shared.coworkerById('nobody'), undefined);
  assert.equal(shared.SPECIALIST_GROUPS.length, 22);
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/colleagues.test.cjs`
- [ ] **Step 3: Move the data and the scoring.** The core team's text is unchanged, and the specialist prompt keeps today's exact wording.
- [ ] **Step 4: Run** `npm test` (the campus search tests included) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `refactor(office): one coworker directory and search shared by main and renderer`

---

### Task 2: Task records and the run tracker

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/platform.ts`, `src/main/repository.ts`, `src/main/service.ts`, `src/renderer/src/App.tsx`
- Create: `src/main/tasks/store.ts`, `src/main/tasks/tracker.ts`
- Test: `tests/tasks.test.cjs` (new), `tests/service.test.cjs`

**Interfaces:**

```ts
// src/shared/types.ts
export type TaskKind = 'work' | 'help' | 'todo';
export type TaskStatus = 'open' | 'working' | 'attention' | 'done';
export interface TaskItem {
  id: ID; kind: TaskKind; title: string; notes?: string;
  status: TaskStatus; note?: string;
  coworkerId?: string; forCoworkerId?: string; conversationId?: ID;
  /** Work records: when the current run began, so help from that run can be tied to it. */
  runStartedAt?: number;
  due?: string; remindAt?: number; remindedAt?: number;
  createdAt: number; updatedAt: number; doneAt?: number;
}
// StreamEvent gains:  | { channel: 'tasks'; tasks: TaskItem[] }

// src/main/tasks/store.ts
export class TaskStore {
  constructor(state: { tasks: TaskItem[] }, id: () => string, emit: (tasks: TaskItem[]) => void, now?: () => number);
  list(): TaskItem[];
  add(input: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>): TaskItem;
  update(id: string, patch: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): TaskItem;
  find(predicate: (task: TaskItem) => boolean): TaskItem | undefined;
}

// src/main/tasks/tracker.ts
export function taskTitle(input: string): string;
export class TaskTracker {
  constructor(store: TaskStore, isCoworker: (agentId: string | undefined) => boolean, now?: () => number);
  runStarted(chat: { id: string; agentId?: string }, input: string): void;
  approvalPending(conversationId: string): void;
  approvalResolved(conversationId: string): void;
  runEnded(conversationId: string, outcome: { error?: string; stopped?: boolean }): void;
  interrupted(): void;
  helpStarted(colleagueId: string, askerId: string, conversationId: string, question: string): TaskItem;
  helpEnded(id: string, error?: string): void;
}
```

Rules:
- `taskTitle` cuts the input at `\n\n<file path=`, `\n\nFile context: ` and `\n\n<attachment`, takes the first non-empty line, trims it, and cuts it to 80 characters with an ellipsis.
- `isCoworker(id)` is `!!coworkerById(id) && id !== RECEPTIONIST_ID`.
- `runStarted` creates the conversation's `work` record the first time; later runs set it back to `working` and clear `note`. Either way `runStartedAt = now`.
- `runEnded` sets:
  - `done` with no note when the run finished;
  - `done` with the note "Stopped" when stopped;
  - `attention` with the error text otherwise.

  It also sets `doneAt` when the status is `done`.
- `help` records: the title is "Helping <asker name>" and `notes` is the question (≤ 2,000 characters). They start `working` and end `done`, with the error as `note` when the consult failed.
- **Service:**
  - `this.tasks = new TaskStore(this.state, () => this.repo.id(), (tasks) => this.emit({ channel: 'tasks', tasks }))`;
  - `this.tracker.interrupted()` runs in the constructor;
  - in `chatSend`: `runStarted` before the first save; `approvalPending` right after emitting `approvalRequired`; `approvalResolved` after the approval promise settles, whether allowed or rejected; `runEnded` in `finally`.
  - Whether a run was stopped comes from `controller.signal.aborted` with no error other than the abort.
- **Repository:** `migrate` sets `state.tasks ??= []`. `validate` requires an array whose items have string `id` and `title`, a known `kind` and a known `status`.
- **Renderer (`App.tsx`):** a `tasks` event patches `data.tasks` in place and does not trigger a snapshot refresh.

- [ ] **Step 1: Write the failing tests** (`tests/tasks.test.cjs`):

```js
const { TaskStore } = require('../src/main/tasks/store.ts');
const { TaskTracker, taskTitle } = require('../src/main/tasks/tracker.ts');

const setup = () => {
  let t = 1000;
  let n = 0;
  const state = { tasks: [] };
  const events = [];
  const store = new TaskStore(state, () => `id${++n}`, (tasks) => events.push(tasks), () => t);
  const tracker = new TaskTracker(store, (id) => !!id && id !== 'receptionist', () => t);
  return { state, events, store, tracker, tick: (ms) => (t += ms) };
};

test('titles come from the first visible line', () => {
  assert.equal(taskTitle('Draft the API contract\\nwith examples'), 'Draft the API contract');
  assert.equal(taskTitle('Summarize this\\n\\n<file path="a.txt">x</file>'), 'Summarize this');
  assert.equal(taskTitle('  \\n  Review the plan'), 'Review the plan');
  assert.equal(taskTitle('x'.repeat(100)).length, 80);
  assert.ok(taskTitle('x'.repeat(100)).endsWith('…'));
});

test('one work record per conversation follows the run', () => {
  const { state, events, tracker, tick } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'Design the API');
  assert.equal(state.tasks.length, 1);
  assert.deepEqual(
    { kind: state.tasks[0].kind, status: state.tasks[0].status, title: state.tasks[0].title, coworkerId: state.tasks[0].coworkerId },
    { kind: 'work', status: 'working', title: 'Design the API', coworkerId: 'backend-developer' }
  );
  tracker.approvalPending('c1');
  assert.equal(state.tasks[0].status, 'attention');
  assert.equal(state.tasks[0].note, 'Waiting for your approval');
  tracker.approvalResolved('c1');
  assert.equal(state.tasks[0].status, 'working');
  tick(5);
  tracker.runEnded('c1', {});
  assert.equal(state.tasks[0].status, 'done');
  assert.equal(state.tasks[0].doneAt, 1005);
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'And add pagination');
  assert.equal(state.tasks.length, 1, 'follow-ups reuse the record');
  assert.equal(state.tasks[0].title, 'Design the API');
  tracker.runEnded('c1', { error: 'Rate limited' });
  assert.equal(state.tasks[0].status, 'attention');
  assert.equal(state.tasks[0].note, 'Rate limited');
  tracker.runStarted({ id: 'c1', agentId: 'backend-developer' }, 'Try again');
  tracker.runEnded('c1', { stopped: true });
  assert.equal(state.tasks[0].note, 'Stopped');
  assert.ok(events.length >= 6);
});

test('no records for the receptionist or for chats without a coworker', () => {
  const { state, tracker } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'receptionist' }, 'Remind me Friday');
  tracker.runStarted({ id: 'c2' }, 'Hello');
  tracker.runEnded('c1', {});
  assert.equal(state.tasks.length, 0);
});

test('interrupted runs need attention; help records open and close', () => {
  const { state, tracker } = setup();
  tracker.runStarted({ id: 'c1', agentId: 'writer' }, 'Draft');
  tracker.interrupted();
  assert.equal(state.tasks[0].status, 'attention');
  assert.equal(state.tasks[0].note, 'Interrupted');
  const help = tracker.helpStarted('backend-developer', 'frontend-developer', 'c9', 'Which status code?');
  assert.equal(help.title, 'Helping Frontend Developer');
  assert.equal(help.status, 'working');
  tracker.helpEnded(help.id);
  assert.equal(state.tasks.find((t) => t.id === help.id).status, 'done');
  const failed = tracker.helpStarted('backend-developer', 'frontend-developer', 'c9', 'Again?');
  tracker.helpEnded(failed.id, 'Provider down');
  assert.equal(state.tasks.find((t) => t.id === failed.id).note, 'Provider down');
});
```

  In `tests/service.test.cjs`, add a lifecycle test that drives `chatSend` for a coworker conversation with `streamChat` mocked. It checks:
  - one `work` record goes `working → done`, and a `tasks` event was emitted;
  - an error run ends in `attention`;
  - the repository migrates an old state file without `tasks`.

  The test sets the emitter with `new Service(repo, vault, dir, (e) => events.push(e), 'p')`.

- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the types, store, tracker, repository and service hooks, and the `App.tsx` handling.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tasks): task records for every coworker conversation, following each run`

---

### Task 3: Toolsets and "Ask a colleague"

**Files:**
- Create: `src/main/officeTools.ts`, `src/main/colleagues.ts`
- Modify: `src/main/service.ts`, `src/main/security/permissions.ts`
- Test: `tests/colleagues.test.cjs`, `tests/service.test.cjs`

**Interfaces:**

```ts
// src/main/colleagues.ts
export const MAX_ASKS = 3;
export const ASK_COLLEAGUE: ToolDefinition;   // parameters: colleague (string), question (string); both required
export function resolveColleague(name: string, askerId: string): { coworker: Coworker } | { error: string };
export function consultSystemPrompt(colleague: Coworker, askerName: string): string;
export interface ConsultDeps {
  stream: typeof streamChat;          // injectable for tests
  tools: ToolDefinition[];            // read-only tools, or none
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}
export async function consult(
  provider: ProviderConfig, key: string | null, modelId: string,
  colleague: Coworker, askerName: string, question: string, deps: ConsultDeps
): Promise<string>;

// src/main/officeTools.ts
export const READ_ONLY_TOOLS = ['read_file', 'list_files', 'search_code'];
export function toolsFor(input: { agentId?: string; hasFolder: boolean; registry: ToolDefinition[] }): ToolDefinition[];
```

Rules:
- **`ASK_COLLEAGUE` description:** "Ask a colleague at Axon a question while you work on this task; they answer from their own expertise. Name them by role, e.g. "Backend Developer" or "Security Engineer". Departments: …" (the 22 department names, comma-separated). It finishes with "At most three questions per task."
- **`resolveColleague`:**
  - an exact name match (case-insensitive, also without a trailing parenthesis such as "(SRE)") or an id match wins;
  - otherwise it takes `scoreCoworkers` over `COWORKERS` (with the asker removed), using the top hit when its score is at least 55 and above the second's;
  - otherwise it returns the error `No single colleague matches "<name>". Closest: A, B, C, D, E.`;
  - asking yourself returns "Ask someone other than yourself."
- **`consultSystemPrompt`:** the colleague's `systemPrompt`, then `rolesBlock(roleProfiles(colleague.roleIds))`, then: "<asker> is asking you a question while working on a task for the user. Answer from your expertise, concisely. You cannot ask other colleagues."
- **`consult`:**
  - the loop of today's `runSubagent`: at most 5 steps, temperature 0.3;
  - it offers only `deps.tools` and runs calls through `deps.execute`;
  - any other tool name gets "Not available to you here.";
  - it returns the text, or "(no answer)".
- **`toolsFor`:**
  - with a folder, the registry's tools, dropping `dispatch_subagent` when the agent is a coworker;
  - plus `ASK_COLLEAGUE` for any coworker (including the receptionist);
  - otherwise nothing.
- **Service `chatSend`:**
  - `availableTools = toolsFor({ agentId: chat.agentId, hasFolder: roots.length > 0, registry: this.tools.getDefinitions() })`;
  - an `asks` counter per run;
  - an `ask_colleague` call goes through `PermissionManager.check` (allowed), then `askColleague(...)`:
    - over the limit, the limit message;
    - otherwise it resolves the colleague (on error, it returns it as a tool error), starts a `help` record, and consults with the asker's provider and model;
    - the colleague's tools are read-only tools when `roots.length > 0`, executed through the registry with the permission check (only `allow` runs);
    - it ends the `help` record and returns `JSON.stringify({ colleague: id, name, answer })`.
  - A consult failure ends the help record with the error and returns `Couldn't reach <name>: <reason>` as a tool error.
- **Fix:** `runSubagent`'s filter and its recursion check use `dispatch_subagent` (it was `dispatch_agent`).
- **Permissions:** `ask_colleague` → `allow`.

- [ ] **Step 1: Write the failing tests** (`tests/colleagues.test.cjs`):

```js
const colleagues = require('../src/main/colleagues.ts');
const office = require('../src/main/officeTools.ts');

test('colleagues resolve by name, id or specialty, and ambiguity is explained', () => {
  assert.equal(colleagues.resolveColleague('Backend Developer', 'frontend-developer').coworker.id, 'backend-developer');
  assert.equal(colleagues.resolveColleague('backend-developer', 'frontend-developer').coworker.id, 'backend-developer');
  assert.equal(colleagues.resolveColleague('site reliability engineer', 'x').coworker.id.includes('site-reliability'), true);
  assert.match(colleagues.resolveColleague('engineer', 'x').error, /No single colleague matches "engineer"\. Closest: /);
  assert.match(colleagues.resolveColleague('Frontend Developer', 'frontend-developer').error, /someone other than yourself/);
});

test('toolsFor: coworkers can always ask a colleague; file tools still need a folder', () => {
  const registry = [{ name: 'read_file' }, { name: 'dispatch_subagent' }, { name: 'write_file' }];
  const names = (x) => x.map((t) => t.name).sort();
  assert.deepEqual(names(office.toolsFor({ agentId: 'frontend-developer', hasFolder: false, registry })), ['ask_colleague']);
  assert.deepEqual(names(office.toolsFor({ agentId: undefined, hasFolder: false, registry })), []);
  assert.deepEqual(names(office.toolsFor({ agentId: undefined, hasFolder: true, registry })), ['dispatch_subagent', 'read_file', 'write_file']);
  assert.deepEqual(names(office.toolsFor({ agentId: 'frontend-developer', hasFolder: true, registry })), ['ask_colleague', 'read_file', 'write_file']);
});

test('a consult speaks as the colleague and cannot ask further', async () => {
  const backend = require('../src/shared/coworkers.ts').coworkerById('backend-developer');
  let seen;
  const answer = await colleagues.consult({ id: 'p', kind: 'openai-compatible' }, null, 'm', backend, 'Frontend Developer', 'Which status code for a conflict?', {
    stream: async (_p, _k, req, onChunk) => { seen = req; onChunk('409 Conflict.'); return { toolCalls: [] }; },
    tools: [],
    execute: async () => ''
  });
  assert.equal(answer, '409 Conflict.');
  assert.match(seen.system, /Backend Developer/);
  assert.match(seen.system, /Frontend Developer is asking you/);
  assert.equal(seen.tools, undefined);
  assert.equal(seen.messages[0].content, 'Which status code for a conflict?');
});
```

  In `tests/service.test.cjs`:
  - **The ask path:** a coworker `chatSend` with `streamChat` mocked, so the first call returns four `ask_colleague` tool calls, the consults answer, and the final call returns text. Assert:
    - three consults ran (count the calls whose `system` contains "is asking you");
    - the fourth call's tool message is the limit message;
    - three `help` records end `done`;
    - the tool results parse as `{ colleague, name, answer }`;
    - the asker's `work` record ends `done`.
  - **The subagent test:** it now sends `dispatch_subagent` and asserts the offered tools exclude it.

- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(tasks): coworkers can ask a colleague, who answers from their own expertise`

---

### Task 4: Office status from tasks, colleague cards, and walking over to help

**Files:**
- Create: `features/office/tasks.ts`, `activity/ColleagueCard.tsx`
- Modify:
  - `chat/MessageView.tsx` (`renderToolCall` prop), `activity/Conversation.tsx`;
  - `store/officeStore.ts` (`syncTaskStatuses`), `App.tsx` (drop the status writes on `done`; keep the activity feed);
  - `simulation/OfficeSimulation.ts` (`startHelp`, `endHelp`), `scene/OfficeScene.ts` (`startHelp`, `endHelp`), `OfficeCanvas.tsx` (sync help pairs), `office.css`.
- Test: `tests/office-boards.test.cjs` (new), `tests/office-sim.test.cjs`

**Interfaces** (`features/office/tasks.ts`, pure):

```ts
export type Team = string;   // a department name, or 'Library' | 'Planning' | 'Lounge' | 'Files room'
export function teamOf(coworkerId: string): Team | null;       // core: research-analyst, writer, knowledge-librarian → Library;
                                                               // product-coach, designer, ops-coordinator → Planning;
                                                               // marketing-strategist → Lounge; files-agent → Files room;
                                                               // receptionist → null; specialists → their department
export function boardCards(tasks: readonly TaskItem[], team: Team, limit?: number): TaskItem[];   // work + help, attention first, then newest
export function teamList(tasks: readonly TaskItem[], team: Team): { attention: TaskItem[]; working: TaskItem[]; done: TaskItem[] };
export function statusesFromTasks(tasks: readonly TaskItem[]): Record<string, AgentStatus>;
//   the newest work record per coworker: working → 'working', attention with the approval note → 'waiting',
//   other attention → 'error', done → 'completed'
export function activeHelp(tasks: readonly TaskItem[]): { helper: string; host: string }[];
//   a help record that is working, or whose asker's work record (same conversation) is working/attention
//   with runStartedAt ≤ help.createdAt; hosts are forCoworkerId
export function parseColleagueCall(call: ToolCall): { colleague: string; question: string; name?: string; answer?: string; error?: string; pending: boolean };
```

- **Simulation:**
  - `startHelp(helperId, hostId): boolean`:
    - refuses when reduced motion is on, when the helper is on a task, or when the host's visit spot is taken;
    - otherwise it cancels the helper's plan, reserves `visit-<host home>`, sets `visitHostId`, and plans `[leave, carry prop, goto spot, do visit (no end)]` of kind `help`;
    - the budget of 12 away does not refuse it.
  - `endHelp(helperId)` sends them home.
  - In a `help` plan, the visit step never ends on its own, and the helper alternates talking and listening.
- **Scene:** `startHelp` and `endHelp` pass through to the simulation.
- **`OfficeCanvas`:** keeps the last set of help pairs and, when `data.tasks` changes, starts the new pairs and ends the ones that went away.
- **`ColleagueCard`:**
  - the colleague's portrait (`AgentPortrait`) and "Asked Backend Developer";
  - the question, clamped to two lines with "More";
  - then "Thinking…" while pending, or the answer as markdown, clamped to six lines with "Show all";
  - or the error in the error style.

- [ ] **Step 1: Write the failing tests** (`tests/office-boards.test.cjs`, TS hook header):

```js
const t = require('../src/renderer/src/features/office/tasks.ts');
const task = (over) => ({ id: over.id, kind: 'work', title: over.id, status: 'done', createdAt: 0, updatedAt: 0, ...over });

test('teams: the core team by room, specialists by department', () => {
  assert.equal(t.teamOf('writer'), 'Library');
  assert.equal(t.teamOf('ops-coordinator'), 'Planning');
  assert.equal(t.teamOf('files-agent'), 'Files room');
  assert.equal(t.teamOf('backend-developer'), 'Backend & APIs');
  assert.equal(t.teamOf('receptionist'), null);
});

test('board cards: attention first, then newest, four at most, help included', () => {
  const tasks = [
    task({ id: 'a', coworkerId: 'backend-developer', updatedAt: 5 }),
    task({ id: 'b', coworkerId: 'backend-developer', updatedAt: 9, status: 'working' }),
    task({ id: 'c', coworkerId: 'backend-developer', updatedAt: 1, status: 'attention' }),
    task({ id: 'd', coworkerId: 'api-developer', updatedAt: 7 }),
    task({ id: 'e', kind: 'help', coworkerId: 'backend-developer', forCoworkerId: 'frontend-developer', updatedAt: 8, status: 'working' }),
    task({ id: 'f', coworkerId: 'frontend-developer', updatedAt: 99 }),
    task({ id: 'g', kind: 'todo', updatedAt: 100 })
  ];
  assert.deepEqual(t.boardCards(tasks, 'Backend & APIs').map((x) => x.id), ['c', 'b', 'e', 'd']);
  const list = t.teamList(tasks, 'Backend & APIs');
  assert.deepEqual(list.attention.map((x) => x.id), ['c']);
  assert.deepEqual(list.working.map((x) => x.id), ['b', 'e']);
  assert.deepEqual(list.done.map((x) => x.id), ['d', 'a']);
});

test('statuses come from each coworker’s newest work record', () => {
  const s = t.statusesFromTasks([
    task({ id: '1', coworkerId: 'writer', status: 'done', updatedAt: 1 }),
    task({ id: '2', coworkerId: 'writer', status: 'working', updatedAt: 2 }),
    task({ id: '3', coworkerId: 'designer', status: 'attention', note: 'Waiting for your approval', updatedAt: 1 }),
    task({ id: '4', coworkerId: 'analyst', status: 'attention', note: 'Rate limited', updatedAt: 1 }),
    task({ id: '5', kind: 'help', coworkerId: 'writer', status: 'done', updatedAt: 9 })
  ]);
  assert.deepEqual(s, { writer: 'working', designer: 'waiting', analyst: 'error' });
});

test('help walks last while the help runs or the asker’s run continues', () => {
  const work = task({ id: 'w', coworkerId: 'frontend-developer', conversationId: 'c', status: 'working', runStartedAt: 10 });
  const help = task({ id: 'h', kind: 'help', coworkerId: 'backend-developer', forCoworkerId: 'frontend-developer', conversationId: 'c', status: 'done', createdAt: 12 });
  assert.deepEqual(t.activeHelp([work, help]), [{ helper: 'backend-developer', host: 'frontend-developer' }]);
  assert.deepEqual(t.activeHelp([{ ...work, status: 'done' }, help]), []);
  assert.deepEqual(t.activeHelp([{ ...work, runStartedAt: 20 }, help]), [], 'help from an earlier run');
  assert.deepEqual(t.activeHelp([{ ...work, status: 'done' }, { ...help, status: 'working' }]).length, 1);
});

test('colleague calls parse for the card', () => {
  const pending = t.parseColleagueCall({ id: '1', name: 'ask_colleague', arguments: '{"colleague":"Backend Developer","question":"Which code?"}' });
  assert.equal(pending.pending, true);
  const done = t.parseColleagueCall({ ...pending, id: '1', name: 'ask_colleague', arguments: '{"colleague":"backend","question":"Q"}', result: '{"colleague":"backend-developer","name":"Backend Developer","answer":"409"}' });
  assert.deepEqual([done.colleague, done.name, done.answer, done.pending], ['backend-developer', 'Backend Developer', '409', false]);
  const failed = t.parseColleagueCall({ id: '1', name: 'ask_colleague', arguments: '{}', error: 'No single colleague' });
  assert.equal(failed.error, 'No single colleague');
});
```

  In `tests/office-sim.test.cjs`:

```js
test('a colleague walks over to help and stays until released', () => {
  const office = new OfficeSimulation({ agentIds: ['frontend-developer', 'backend-developer'], seed: 3 });
  office.setTaskStatus('frontend-developer', 'working');
  office.step(1 / 60);
  assert.ok(office.startHelp('backend-developer', 'frontend-developer'));
  const spot = `visit-${layout.HOME_DESKS['frontend-developer']}`;
  assert.ok(!runUntil(office, (o) => o.view('backend-developer').poiId === spot, 120, 0.05) || true);
  assert.equal(office.view('backend-developer').poiId, spot);
  run(office, 30, 0.1);
  assert.equal(office.view('backend-developer').poiId, spot, 'stays while helping');
  office.endHelp('backend-developer');
  runUntil(office, (o) => o.view('backend-developer').poiId === layout.HOME_DESKS['backend-developer'], 120, 0.05);
  assert.equal(office.view('backend-developer').poiId, layout.HOME_DESKS['backend-developer']);
  const calm = new OfficeSimulation({ agentIds: ['frontend-developer', 'backend-developer'], seed: 3, reducedMotion: true });
  assert.equal(calm.startHelp('backend-developer', 'frontend-developer'), false);
});
```

- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the pure module, the simulation, the scene and canvas wiring, the store sync, and the card.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(office): status from task records, colleague cards, and colleagues who walk over to help`

---

### Task 5: Task boards and the team list

**Files:**
- Create: `features/office/campus/boards.ts`, `scene/room/boards.ts`, `activity/TeamList.tsx`
- Modify:
  - `campus/neighbourhoods.ts` (boards 2.4 m; gong and trophies at `cx + 1.8`), `campus/commons.ts` (room boards), `simulation/layout.ts` (the Leadership board);
  - `scene/OfficeScene.ts` (`setTasks`, board picking, `onBoardClick`, debug `boards()` and `boardPoint(team)`), `OfficeCanvas.tsx`;
  - `store/officeStore.ts` (`teamBoard: Team | null`, `openTeamBoard`), `activity/ActivityPanel.tsx`, `office.css`.
- Test: `tests/office-boards.test.cjs`, `tests/office-campus.test.cjs`

**Interfaces:**

```ts
// campus/boards.ts
export interface TaskBoard { team: Team; itemId: string; color: string; title: string }
export const TASK_BOARDS: readonly TaskBoard[];      // 21 department boards + Leadership + Library, Planning, Lounge, Files room
```

**Board positions:**
- **Departments:** the existing `wb-<slug>` items, 2.4 × 0.1.
- **Leadership:** `wb-executive-leadership`, a whiteboard at (44.8, −18.5), 2.0 wide.
- **Library:** `board-library` at (10.0, −6.55), 1.6 wide.
- **Planning:** the existing `meeting-whiteboard`, widened to 1.6.
- **Lounge:** `board-lounge` at (−14.2, −6.4), 1.6 wide.
- **Files room:** `board-files` at (13.4, −6.55), 1.4 wide.

All face +z.

**`BoardLayer`** (`scene/room/boards.ts`):
- **Faces:** one quad per board, `(w − 0.1) × 1.02` m, centred at `y = 1.41`, 0.045 m in front of the board's surface. All quads share one `MeshBasicMaterial` over a single atlas texture (`toneMapped: false`), so every board costs one draw call.
- **Atlas slots:** 384 × 176 px each.
  - a header band in the team colour (the district colour, or the Commons colour for rooms) with the team name in white;
  - below it, a 2 × 2 grid of tiles for `boardCards(tasks, team)`;
  - each tile has a status colour stripe and background tint (blue `#3867f6`, amber `#d97706`, green `#1c9e72`), the title (one line, ellipsis), and the person's initials in a dot with their short name;
  - `help` tiles read "Helping <short name>";
  - empty tiles are faint dashed outlines.
- **`setTasks(tasks)`** redraws only the boards whose cards changed (compared by id, status and title) and then sets `needsUpdate`.
- **`pick(raycaster)`** returns the team (`faceIndex / 2` picks the board).
- **`screenPoint(team, …)`** is for the debug handle.

**Team list** (side panel):
- `teamBoard` in the office store switches `ActivityPanel` to `TeamList`:
  - the header has the team name, the district colour, and a back button (Esc also goes back);
  - three groups: **Needs attention**, **Working**, **Done** (the last 20, then "Show more");
  - each row shows the title, the person (portrait and short name), the status and a relative time.
- Clicking a row:
  - selects that coworker;
  - for a `work` row, opens its conversation (`setAgentConversation`);
  - for a `help` row, selects and opens the asker's conversation;
  - closes the list.
- Selecting any coworker elsewhere also closes the list.

- [ ] **Step 1: Write the failing tests.**

  In `tests/office-boards.test.cjs`:

```js
const boards = require('../src/renderer/src/features/office/campus/boards.ts');
const layout = require('../src/renderer/src/features/office/simulation/layout.ts');
const districts = require('../src/renderer/src/features/office/campus/districts.ts');

test('a board for every department and every core team room', () => {
  const teams = boards.TASK_BOARDS.map((b) => b.team).sort();
  const departments = districts.DISTRICTS.flatMap((d) => d.departments);
  assert.deepEqual(teams, [...departments, 'Files room', 'Library', 'Lounge', 'Planning'].sort());
  for (const b of boards.TASK_BOARDS) assert.ok(layout.FURNITURE.some((f) => f.id === b.itemId), b.itemId);
  const agents = require('../src/renderer/src/features/office/data/officeAgents.ts').OFFICE_AGENTS;
  const tasksModule = require('../src/renderer/src/features/office/tasks.ts');
  for (const a of agents) assert.ok(boards.TASK_BOARDS.some((b) => b.team === tasksModule.teamOf(a.id)), a.id);
});
```

  In `tests/office-campus.test.cjs`, the existing overlap and reachability tests must stay green with the new boards.

- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement** the layout boards, the `BoardLayer`, the scene and canvas wiring, and the team list.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Build, then look at a department board and a Commons room board with tasks on them. Use the scratch shot harness, sending a task through the desktop fixture, or insert records through `window.axon` in the harness.
- [ ] **Step 5: Commit.** `feat(office): live task boards and the team list`

---

### Task 6: Desktop check, screenshots, performance and spec revisions

**Files:** `tests/office-desktop.cjs`, the spec's revisions.

- [ ] **Step 1: Teach the fixture provider to ask a colleague.** When the last user message contains "ask a colleague", the fixture streams a single `ask_colleague` tool call (OpenAI `tool_calls` delta, arguments `{"colleague":"Backend Developer","question":"Which status code for a conflict?"}`). When the request's `system` contains "is asking you a question", it streams "409 Conflict, with a problem+json body." Otherwise it keeps today's text.
- [ ] **Step 2: Add the flow.** With the Frontend Developer selected, send "Please ask a colleague about status codes." Then check:
  - a `.colleague-card` shows "Backend Developer" and "409 Conflict";
  - `window.axon.snapshot()` has a `help` record `done` for `backend-developer` and a `work` record `done` for `frontend-developer`;
  - `window.__axonOffice.boards()` lists a card for "Backend & APIs" reading "Helping Frontend";
  - clicking the Backend & APIs board (via `boardPoint`) opens `.team-list` with the help row, and Esc returns to the coworker;
  - the status badge ends `completed`.

  Take screenshots `b-board-closeup.png` (focus on the Backend board, span 7) and `b-team-list.png`.
- [ ] **Step 3: Run everything.** `npm run typecheck`, `npm test`, `npm run build`, `npx electron tests/office-desktop.cjs`. The draw-call budget stays at ≤ 733.
- [ ] **Step 4: Record the revisions.** Add deviations 1–5 above, plus anything tuned while building, to the spec's §13 under "Part B".
- [ ] **Step 5: Commit.** `test(office): desktop check for colleagues, boards and the team list; record Part B revisions`
