# Office polish — Part C: The receptionist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A receptionist at the front desk keeps your to-dos, reminders and schedule with proper tools, and sees every coworker's tasks. A planner sits above her chat. Reminders arrive as Windows notifications even with the window closed, because Axon waits in the tray. A morning briefing greets you once a day, and a Today board behind her desk lists what's next.

**Architecture:**
- **Tasks and reminders live in the main process.**
  - `todo` records join the `work` and `help` records from Part B.
  - Pure date and grouping logic lives in `src/shared/planner.ts`, shared by the planner, the briefing, the Today board and the tools.
  - The receptionist's conversations get four planner tools (`src/main/tasks/tools.ts`), and her system prompt gets today's date and time on every message.
  - Reminders are checked on the scheduler's 30-second tick plus a precise timer for anything due sooner (`src/main/reminders.ts`), and fire through a small shell port that the Electron entry implements.
- **Window lifecycle:**
  - `src/main/index.ts` gains a tray and a window that can be destroyed and recreated;
  - login-item handling and notification clicks are supported;
  - the pure rules for these live in `src/main/shell/lifecycle.ts`.
- **In the renderer:**
  - the planner, the briefing and planner tool cards appear in her panel;
  - the Today board is one more board in the atlas;
  - a notification or tray click selects her through a `focus` stream event, or through `officeStart()` when the window has just opened.

**Tech Stack:** Electron main (`Tray`, `Menu`, `Notification`, `nativeImage`, `app.setLoginItemSettings`), React 18 + Zustand, three r186, `node:test`, the Electron desktop and smoke checks.

**Spec:** [docs/superpowers/specs/2026-09-24-office-polish-teamwork-reception-design.md](../specs/2026-09-24-office-polish-teamwork-reception-design.md) §6, §7, §8, §9, §10 (Part C items).

## Global Constraints

- **208 coworkers:** 198 roles, the Business Analyst, and 9 core. Ops Coordinator sits at `desk-ops`, department "Planning"; the receptionist sits at `desk-reception`.
- **Dates:**
  - dates are local wall-clock strings, `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`;
  - a reminder without a time is 09:00;
  - a reminder time in the past is refused with "That time has passed; ask the user."
- **Planner groups** (`groupPlanner`, one function shared everywhere):
  - Today: overdue, then due today by time, then coworkers' `work` records that are working or need attention;
  - This week: the next 7 days after today;
  - Later: further out or undated;
  - Done: completed in the last 14 days.
- **Reminders:**
  - fire once;
  - missed ones fire at start-up, with one summary notification ("4 reminders you missed") when there are more than 3;
  - clicking a reminder opens the reception with the planner.
- **Closing the window** with "Keep running in the tray" on (the default) destroys the window, and Axon keeps running. The first time, one notification explains it.
- **Start with Windows** (default off) registers `--background` on packaged Windows builds only.
- **The morning briefing** is built locally with no model call, shown once per day on the first window open, and never saved into her conversation.
- **Planner tools** are only in the receptionist's conversations. `PermissionManager` allows them. The receptionist never gets `work` records of her own.
- **Budgets:** draw calls at the whole-campus view ≤ 733; every task ends with typecheck and tests green; commit with the trailer; only format files that were Prettier-clean.

## Deviations from the spec (recorded in its revisions at the end)

1. **`officeStart()` replaces `receptionBriefing()`.** The renderer calls it once when a window opens, and it returns `{ briefing, focus }`: the day's briefing, if not yet shown, and where a notification or tray click wanted the window to open. A just-created window would otherwise miss a pushed `focus` event.
2. **Notifications use the app id `com.axon.studio` only in packaged builds.** Development builds use `process.execPath`, as Electron advises, so notifications show without a Start-menu shortcut. `AXON_QUIET_NOTIFICATIONS=1` logs notifications instead of showing them, for tests.
3. **Reminders also get a precise timer** for the next one due within 30 s, on top of the 30-second tick, so they fire on the minute.
4. **The tray icon is embedded as a PNG data URL** (`src/main/shell/icon.ts`, drawn from the Axon mark), since packaging ships only `out/**`.
5. **`Snapshot` also gains `startWithWindowsAvailable`**, so Settings can disable the switch in development.
6. **Delete in the planner asks inline** ("Delete? Yes · No") rather than in a dialog.

## File map

| File | Responsibility |
|---|---|
| `src/shared/coworkers.ts` | the receptionist (core); Ops Coordinator → "Planning" |
| `features/office/data/officeAgents.ts`, `scene/agents/appearance.ts`, `simulation/agentProfiles.ts`, `campus/commons.ts` | her colours, look, habits and desk; Ops to `desk-ops`; `board-today` |
| `features/office/campus/boards.ts`, `scene/room/boards.ts` | the Today board (`kind: 'today'`) |
| `src/shared/planner.ts` (new) | `parseLocal`, `dayKey`, `groupPlanner`, `dueLabel`, `briefing`, `nextUp`, `plannerNow` |
| `src/main/tasks/tools.ts` (new) | `PLANNER_TOOLS`, `runPlannerTool`, `validateTaskInput` |
| `src/main/officeTools.ts`, `src/main/service.ts`, `src/main/security/permissions.ts` | the receptionist's toolset and date context; task IPC; `officeStart`; the shell port; the unsupported-tools message |
| `src/main/reminders.ts` (new) | `dueReminders`, `Reminders` (tick, start-up, precise timer) |
| `src/main/shell/lifecycle.ts`, `notify.ts`, `tray.ts`, `icon.ts` (new), `src/main/index.ts` | tray, notifications, close to tray, login item, focus |
| `src/shared/types.ts`, `src/shared/platform.ts`, `src/preload/index.ts`, `src/main/repository.ts` | `Settings` flags, `reception` state, `focus` event, `pendingApprovals`, new IPC, migration |
| `activity/Planner.tsx`, `Briefing.tsx`, `PlannerToolCard.tsx` (new), `ActivityPanel.tsx`, `Conversation.tsx`, `AgentComposer.tsx`, `OfficeCanvas.tsx`, `store/officeStore.ts`, `App.tsx`, `state.ts`, `Settings.tsx`, `office.css` | the renderer |
| `tests/planner.test.cjs`, `tests/reception.test.cjs` (new), `tests/service.test.cjs`, `tests/office-*.cjs` | tests |

---

### Task 1: The receptionist joins the office

**Files:**
- Modify:
  - `src/shared/coworkers.ts`, `data/officeAgents.ts`, `scene/agents/appearance.ts`, `simulation/agentProfiles.ts`;
  - `campus/commons.ts` (`CORE_HOME_DESKS`; `board-today`, a 2.0 m whiteboard at (0, 11.0); the desk accent), `campus/boards.ts`.
- Tests: `office-campus`, `colleagues`, `office-sim`, `office-boards`, and the desktop check's counts (207 → 208, 8 → 9).

**Details:**
- **The receptionist (core):**
  - id `receptionist`, name "Receptionist", role "Front desk & planning", department "Reception";
  - capabilities: Reminders, To-do lists, Daily planning, Team overview;
  - description: "Keeps your to-dos, reminders and schedule, and knows what everyone is working on."
- **Her system prompt:** "You are Axon’s Receptionist. You keep the user’s to-dos, reminders and schedule, and you know what every coworker is working on. Always use your tools: add_task to record something, list_tasks before answering anything about the plan, update_task to change it and complete_task when it is done. Never say you recorded or changed something unless the tool succeeded. Dates are local: 'YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm' with a time; a reminder with no time is at 09:00. After recording, confirm in one short line, like "Added: Prep the investor deck — Fri 25 Sep, reminder 10:00". Be warm and brief."
- **Look:** rose accent `#e11d48` (soft `rgba(225, 29, 72, 0.15)`); a hand-tuned look with a bun, a rose cardigan over a white blouse, and a headset.
- **Habits:** weights `desk 70, coffee 8, idle 8, lounge 6, visit 8`; meeting affinity 0.3; carries a tablet; pace 1; starts at her desk.
- **Ops Coordinator** moves to `desk-ops` with department "Planning".
- **Today board:** `TaskBoard` gains `kind: 'team' | 'today'`. The Today board is `{ team: 'Today', itemId: 'board-today', kind: 'today', color: '#e11d48', title: 'Today' }`.

- [ ] **Step 1: Update the counting tests first.**
  - `office-campus`: 208 coworkers and 9 in the Commons.
  - `colleagues`: 208, and the first 9 are core.
  - `office-boards`: the team list includes 'Today'.
  - New assertion: `layout.HOME_DESKS['receptionist'] === 'desk-reception'` and `layout.HOME_DESKS['ops-coordinator'] === 'desk-ops'`.

  Run them and see them fail.
- [ ] **Step 2: Implement.** Run `npm test`; the simulation's many-seeds and Commons route tests must stay green.
- [ ] **Step 3: Commit.** `feat(office): a receptionist at the front desk; Ops Coordinator back to the pods`

---

### Task 2: Planner logic and the receptionist's tools

**Files:**
- Create: `src/shared/planner.ts`, `src/main/tasks/tools.ts`
- Modify: `src/main/officeTools.ts`, `src/main/service.ts`, `src/main/security/permissions.ts`
- Test: `tests/planner.test.cjs` (new), `tests/service.test.cjs`

**Interfaces** (`src/shared/planner.ts`, pure; `now` is a `Date`):

```ts
export interface LocalTime { date: string; time?: string; at: number }   // at = epoch ms of that local moment (09:00 when untimed)
export function parseLocal(value: string): LocalTime | null;             // strict: real calendar date, 00:00–23:59
export function dayKey(date: Date): string;                              // 'YYYY-MM-DD' in local time
export function addDays(key: string, days: number): string;
export interface PlannerGroups { today: TaskItem[]; week: TaskItem[]; later: TaskItem[]; done: TaskItem[] }
export function groupPlanner(tasks: readonly TaskItem[], now: Date): PlannerGroups;
export function isOverdue(task: TaskItem, now: Date): boolean;
export function dueLabel(task: TaskItem, now: Date): string;             // 'Today 10:00', 'Tomorrow', 'Fri 25 Sep 10:00', 'Overdue · Mon 21 Sep'
export interface Briefing { greeting: string; today: string[]; overdue: string[]; coworkers: string | null; empty: boolean }
export function briefing(tasks: readonly TaskItem[], now: Date): Briefing;
export function nextUp(tasks: readonly TaskItem[], now: Date, limit?: number): TaskItem[];   // the Today board
export function plannerNow(now: Date): string;                            // "Now: Thursday 24 September 2026, 14:05 (UTC+05:30). Today is 2026-09-24."
```

**Rules:**
- **Grouping:**
  - Open to-dos: overdue or due today → Today; due within the next 7 days → This week; otherwise → Later.
  - Today's order: overdue by due, then today's timed items by time, then untimed, then the `work` records that are working or need attention (newest first).
  - Done: `todo` and `work` records done in the last 14 days (by `doneAt`), newest first.
  - `help` records never appear in the planner.
- **`briefing`:**
  - the greeting is "Good morning" before 12, "Good afternoon" before 18, otherwise "Good evening";
  - `today` holds lines "10:00 — title" (untimed: "title");
  - `overdue` holds "title (due Mon 21 Sep)";
  - `coworkers` is "2 coworkers working, 1 needs attention" (or null);
  - `empty` is true when all three are empty.
- **`nextUp`:** open to-dos with a due date, overdue first, then by date and time, at most 5.

**Tools** (`src/main/tasks/tools.ts`):

```ts
export const PLANNER_TOOLS: ToolDefinition[];   // add_task, list_tasks, update_task, complete_task
export function runPlannerTool(name: string, args: Record<string, unknown>, store: TaskStore, now: Date): { content: string; isError?: boolean };
export function validateTaskInput(input: { title?: unknown; due?: unknown; remindAt?: unknown; notes?: unknown }, now: Date, partial: boolean):
  { ok: true; value: Partial<Pick<TaskItem, 'title' | 'due' | 'remindAt' | 'notes'>> } | { ok: false; error: string };
```

- **`add_task { title, due?, remind_at?, notes? }`:** creates a `todo`, `open`. It returns `Added "title" (id …) — due <label>[, reminder <time>].`
- **`list_tasks { range? }`:** ranges are `today | week | later | overdue | done | all` (default: every open group). One line per item: `- [id] title · <due label> · <status> · <who>`, or "Nothing on the list."
- **`update_task { id, title?, due?, remind_at?, notes? }`:** `null` clears a field. It returns `Updated "title" (…)`.
- **`complete_task { id }`:** sets `done` and `doneAt`. It returns `Done: "title".`
- **Validation:**
  - the title is 1–120 characters;
  - notes are at most 2,000;
  - dates must parse;
  - a reminder must be in the future;
  - an unknown id gets "No task with id …; call list_tasks.".
- **Service:**
  - `toolsFor` adds `PLANNER_TOOLS` when `agentId === RECEPTIONIST_ID`;
  - `chatSend` runs planner tools through `runPlannerTool` (after `PermissionManager.check`, which allows them) and settles them like other calls;
  - for the receptionist, `plannerNow(new Date())` is appended to the system prompt on every send;
  - when a receptionist run fails with an error mentioning tools (`/\btools?\b/i`) and the model doesn't support them, the message is replaced with "This model can't use tools, so I can't keep your planner. Pick another model."

- [ ] **Step 1: Write the failing tests** (`tests/planner.test.cjs`).

```js
const p = require('../src/shared/planner.ts');
const tools = require('../src/main/tasks/tools.ts');
const { TaskStore } = require('../src/main/tasks/store.ts');
const at = (s) => new Date(s);                       // local time
const now = at('2026-09-24T14:05:00');               // a Thursday
const todo = (over) => ({ id: over.id, kind: 'todo', title: over.id, status: 'open', createdAt: 0, updatedAt: 0, ...over });

test('local dates parse strictly', () => {
  assert.equal(p.parseLocal('2026-09-25T10:00').at, at('2026-09-25T10:00:00').getTime());
  assert.equal(p.parseLocal('2026-09-25').at, at('2026-09-25T09:00:00').getTime());
  assert.equal(p.parseLocal('2026-02-30'), null);
  assert.equal(p.parseLocal('2026-09-25T24:00'), null);
  assert.equal(p.parseLocal('next friday'), null);
  assert.equal(p.addDays('2026-12-31', 1), '2027-01-01');
});

test('the planner groups by day', () => {
  const g = p.groupPlanner([
    todo({ id: 'late', due: '2026-09-22' }),
    todo({ id: 'today-10', due: '2026-09-24T10:00' }),
    todo({ id: 'today', due: '2026-09-24' }),
    todo({ id: 'fri', due: '2026-09-25T10:00' }),
    todo({ id: 'next-week', due: '2026-10-01' }),
    todo({ id: 'later', due: '2026-10-02' }),
    todo({ id: 'someday' }),
    { id: 'w', kind: 'work', title: 'API', status: 'working', coworkerId: 'backend-developer', createdAt: 0, updatedAt: 5 },
    { id: 'h', kind: 'help', title: 'Helping', status: 'working', createdAt: 0, updatedAt: 5 },
    todo({ id: 'done', status: 'done', doneAt: at('2026-09-23T09:00:00').getTime() }),
    todo({ id: 'old', status: 'done', doneAt: at('2026-09-01T09:00:00').getTime() })
  ], now);
  assert.deepEqual(g.today.map((t) => t.id), ['late', 'today-10', 'today', 'w']);
  assert.deepEqual(g.week.map((t) => t.id), ['fri', 'next-week']);
  assert.deepEqual(g.later.map((t) => t.id), ['later', 'someday']);
  assert.deepEqual(g.done.map((t) => t.id), ['done']);
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-24T10:00' }), now), 'Today 10:00');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-25' }), now), 'Tomorrow');
  assert.equal(p.dueLabel(todo({ id: 'x', due: '2026-09-22' }), now), 'Overdue · Tue 22 Sep');
});

test('the briefing and the Today board read the same list', () => {
  const tasks = [todo({ id: 'Prep the investor deck', due: '2026-09-24T10:00' }), todo({ id: 'Call the bank', due: '2026-09-21' })];
  const b = p.briefing(tasks, at('2026-09-24T08:30:00'));
  assert.equal(b.greeting, 'Good morning');
  assert.deepEqual(b.today, ['10:00 — Prep the investor deck']);
  assert.deepEqual(b.overdue, ['Call the bank (due Mon 21 Sep)']);
  assert.equal(p.briefing([], now).empty, true);
  assert.deepEqual(p.nextUp(tasks, now).map((t) => t.id), ['Call the bank', 'Prep the investor deck']);
  assert.match(p.plannerNow(now), /^Now: Thursday 24 September 2026, 14:05 \(UTC[+-]\d\d:\d\d\)\. Today is 2026-09-24\.$/);
});

test('planner tools add, list, update and complete; bad input is explained', () => {
  const state = { tasks: [] };
  let n = 0;
  const store = new TaskStore(state, () => `t${++n}`, () => {}, () => now.getTime());
  let r = tools.runPlannerTool('add_task', { title: 'Prep the investor deck', due: '2026-09-25T10:00', remind_at: '2026-09-25T10:00' }, store, now);
  assert.ok(!r.isError, r.content);
  assert.match(r.content, /Added "Prep the investor deck"/);
  assert.equal(state.tasks[0].remindAt, at('2026-09-25T10:00:00').getTime());
  assert.equal(state.tasks[0].kind, 'todo');
  assert.match(tools.runPlannerTool('list_tasks', {}, store, now).content, /\[t1\] Prep the investor deck · Tomorrow 10:00/);
  r = tools.runPlannerTool('update_task', { id: 't1', due: '2026-09-26', remind_at: null }, store, now);
  assert.ok(!r.isError);
  assert.equal(state.tasks[0].due, '2026-09-26');
  assert.equal(state.tasks[0].remindAt, undefined);
  r = tools.runPlannerTool('complete_task', { id: 't1' }, store, now);
  assert.equal(state.tasks[0].status, 'done');
  assert.match(tools.runPlannerTool('add_task', { title: 'x', remind_at: '2026-09-24T09:00' }, store, now).content, /That time has passed/);
  assert.match(tools.runPlannerTool('add_task', { title: '' }, store, now).content, /title/i);
  assert.match(tools.runPlannerTool('update_task', { id: 'nope' }, store, now).content, /No task with id nope/);
  assert.match(tools.runPlannerTool('add_task', { title: 'x', due: 'friday' }, store, now).content, /YYYY-MM-DD/);
});
```

  In `tests/service.test.cjs`:
  - the receptionist's `chatSend` offers exactly the four planner tools (plus `ask_colleague`) with no folder;
  - her system prompt contains "Now: ";
  - an `add_task` call creates a `todo` record, and the stored tool call carries the result;
  - she gets no `work` record.

- [ ] **Step 2: Run them and see them fail. Step 3: Implement. Step 4: Run** `npm test` and typecheck. **Step 5: Commit.** `feat(reception): planner logic and the receptionist's task tools`

---

### Task 3: Tasks over IPC, settings, pending approvals and `officeStart`

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/platform.ts`, `src/preload/index.ts`, `src/main/index.ts` (the methods list), `src/main/repository.ts`, `src/main/service.ts`, `src/main/security/permissions.ts`, `src/renderer/src/state.ts`
- Test: `tests/service.test.cjs`, `tests/reception.test.cjs` (new)

**Interfaces:**

```ts
// types.ts
Settings: + keepInTray: boolean; startWithWindows: boolean;
export interface FocusTarget { agentId: string; conversationId?: string; planner?: boolean }
StreamEvent: + | ({ channel: 'focus' } & FocusTarget)
// platform.ts
PlatformState: + reception: { briefedOn?: string; trayHintShown?: boolean };
Snapshot: + pendingApprovals: ToolApprovalRequest[]; startWithWindowsAvailable: boolean;
PlatformAPI: + taskAdd(input: { title: string; due?: string; remindAt?: number | null; notes?: string }): Promise<TaskItem>;
               taskUpdate(id: string, patch: { title?: string; due?: string | null; remindAt?: number | null; notes?: string | null; status?: 'open' | 'done' }): Promise<TaskItem>;
               taskDelete(id: string): Promise<void>;
               officeStart(): Promise<{ briefing: Briefing | null; focus: FocusTarget | null }>;
```

**Rules:**
- `taskAdd`, `taskUpdate` and `taskDelete` validate with `validateTaskInput`. The renderer sends `remindAt` as epoch ms, and the service rejects past times with the same message. `status: 'done'` sets `doneAt`, and `'open'` clears it. Each change is saved.
- `taskDelete` removes `todo` records only; for `work` and `help` records it throws "Only your own to-dos can be deleted."
- **`officeStart()`:**
  - when `reception.briefedOn !== dayKey(now)`, it sets that date, saves, and returns `briefing(tasks, now)`; otherwise `null`;
  - it returns and clears the pending focus set by the shell (`service.setPendingFocus(target)`).
- **`settingsSave`** keeps the two booleans, and calls `shell?.applySettings(settings)`.
- **Migration:** `reception ??= {}`, `keepInTray ??= true`, `startWithWindows ??= false`.
- **Pending approvals:** `PermissionManager.pending()` returns the requests. `Snapshot.pendingApprovals` comes from it, and `useApp.refresh()` replaces `pendingApprovals` with the snapshot's.

- [ ] **Step 1: Write failing tests** (`tests/reception.test.cjs`, with the electron stub):
  - `taskAdd`, `taskUpdate` and `taskDelete` round-trip, and the checks refuse bad input;
  - `officeStart` returns a briefing once per day (the test sets `repo.state.reception.briefedOn` to yesterday, then calls it twice);
  - a pending focus set by the shell is returned once;
  - old settings gain the defaults.
- [ ] **Step 2: Implement. Step 3: Run** `npm test` and typecheck. **Step 4: Commit.** `feat(reception): tasks over IPC, tray settings, pending approvals and the morning briefing`

---

### Task 4: Reminders, notifications, the tray and closing to the tray

**Files:**
- Create: `src/main/reminders.ts`, `src/main/shell/lifecycle.ts`, `src/main/shell/notify.ts`, `src/main/shell/tray.ts`, `src/main/shell/icon.ts`
- Modify: `src/main/service.ts` (the shell port; reminders on the scheduler tick; the approval notification), `src/main/index.ts`
- Test: `tests/reception.test.cjs`

**Interfaces:**

```ts
// src/main/service.ts
export interface ShellPort {
  notify(notice: { title: string; body: string; target: FocusTarget }): void;
  windowVisible(): boolean;
  applySettings(settings: Settings): void;
}
Service.attachShell(shell: ShellPort): void;    // also runs reminders' start-up pass
Service.setPendingFocus(target: FocusTarget | null): void;

// src/main/reminders.ts
export function dueReminders(tasks: readonly TaskItem[], now: number): TaskItem[];   // open todos with remindAt <= now and no remindedAt
export class Reminders {
  constructor(store: TaskStore, notify: (n: Notice) => void, now?: () => number, schedule?: (fn: () => void, ms: number) => unknown, cancel?: (t: unknown) => void);
  startup(): void;   // missed reminders: > 3 → one summary; otherwise one each
  tick(): void;      // fires what is due, then arms the precise timer for the next one within 30 s
}

// src/main/shell/lifecycle.ts
export function closeAction(input: { keepInTray: boolean; quitting: boolean }): 'destroy' | 'quit';
export const startedInBackground = (argv: readonly string[]) => argv.includes('--background');
export function loginItem(settings: Settings, packaged: boolean, platform: string): { openAtLogin: boolean; args: string[] } | null;
```

**Rules:**
- **Reminder notification:**
  - the title is "Reminder" and the body is `title — dueLabel`;
  - the target is `{ agentId: 'receptionist', planner: true }`;
  - `remindedAt` is set when it fires.
- **Approval while no window is visible:** "Backend Developer needs your approval", targeting `{ agentId, conversationId }`.
- **`index.ts`:**
  - sets `app.setAppUserModelId(app.isPackaged ? 'com.axon.studio' : process.execPath)`;
  - builds the tray from `icon.ts`: left click opens Axon; the menu has **Open Axon**, **Today's plan** (focus on the receptionist's planner) and **Quit**;
  - closing the window:
    - `closeAction` decides between destroying the window (state saved, tray stays, the one-time hint via `reception.trayHintShown`) and quitting;
    - `window-all-closed` quits only when `keepInTray` is off;
  - `second-instance` and tray clicks call `showWindow(target?)`:
    - if the window exists, it restores, shows and focuses it, then sends `{ channel: 'focus', … }` when a target is given;
    - otherwise it calls `setPendingFocus(target)` and creates the window;
  - `--background` at launch skips creating the window;
  - `applySettings` calls `app.setLoginItemSettings` through `loginItem`, packaged Windows builds only, and runs once at start-up;
  - a notification click runs `showWindow(notice.target)`.
- **`notify.ts`:** with `AXON_QUIET_NOTIFICATIONS=1` it logs `NOTICE <title> — <body>` instead of showing anything, and it does nothing when `Notification.isSupported()` is false.

- [ ] **Step 1: Write failing tests** (`tests/reception.test.cjs`):
  - `dueReminders` picks only open to-dos with past `remindAt` and no `remindedAt`;
  - `Reminders.startup` sends one summary for 4 missed reminders and one notice each for 2;
  - `tick` fires once, and a second tick doesn't repeat it;
  - `tick` arms a timer for a reminder 10 s away and none for one 5 minutes away (use a fake `schedule`);
  - `closeAction` returns `destroy` only when `keepInTray` is on and not quitting;
  - `startedInBackground` and `loginItem` handle packaged and development builds.
- [ ] **Step 2: Implement. Step 3: Run** `npm test` and typecheck.
- [ ] **Step 4: Check it by hand** with the scratch harness. Close the window with the setting on, and the process must stay alive. A second launch (`app.emit('second-instance')`) reopens the window. A reminder 5 s ahead gets `remindedAt` and logs `NOTICE` under `AXON_QUIET_NOTIFICATIONS=1`.
- [ ] **Step 5: Commit.** `feat(reception): reminders, notifications and Axon waiting in the tray`

---

### Task 5: The planner, the briefing, planner cards, the Today board and Settings

**Files:**
- Create: `activity/Planner.tsx`, `activity/Briefing.tsx`, `activity/PlannerToolCard.tsx`
- Modify:
  - `activity/ActivityPanel.tsx`, `activity/Conversation.tsx`, `activity/AgentComposer.tsx`;
  - `store/officeStore.ts` (`briefing`, `plannerOpen`), `OfficeCanvas.tsx` (Today board clicks; a one-minute timer re-sends tasks for date labels), `scene/room/boards.ts` (Today face);
  - `App.tsx` (`officeStart` on mount; `focus` events), `Settings.tsx`, `office.css`.
- Test: `tests/office-boards.test.cjs` (`todayLines`), `tests/office-desktop.cjs`

**Details:**
- **The planner:**
  - it shows above the receptionist's conversation, collapsible, and scrolls within `max-height: 45%` of the panel;
  - the header reads "Planner" with counts;
  - its groups come from `groupPlanner(data.tasks, new Date())`; Done is collapsed by default.
- **Planner rows:**
  - a checkbox (`taskUpdate(id, { status })`);
  - the title, which becomes an input on click (Enter saves, Esc cancels);
  - a due chip that opens an inline editor with a date, a time and a "Remind me" toggle, with Save and Clear;
  - `⋯` → "Delete?", confirmed inline with Yes · No;
  - on `work` rows, the person's short name as a link that opens the conversation.
- **The add row:** "Add a to-do…" with an optional date and an Add button.
- **The briefing:** set from `officeStart()`. It shows at the top of her thread in her voice (the greeting, then the Today, Overdue and Coworkers lines), with "Got it" to dismiss. When the briefing exists, the office selects the receptionist.
- **Planner tool cards:**
  - `add_task` → "Added: title — due label (reminder time)";
  - `update_task` → "Updated: …";
  - `complete_task` → "Done: …";
  - `list_tasks` → "Checked the plan";
  - an error shows in the error style.
- **The Today board:**
  - a header "Today · Thu 24 Sep" on the rose colour;
  - up to 5 lines from `todayLines(tasks, now)` (`time or day — title`), overdue in amber;
  - or "Nothing scheduled";
  - clicking it selects the receptionist with the planner open.
- **Focus:** `officeStart().focus`, or a `focus` event, runs `flyToAgent(agentId)`, opens that conversation if given, and opens the planner when `planner` is set.
- **Settings → General:**
  - "Keep running in the tray", with the note "Reminders only arrive while Axon is running.";
  - "Start with Windows", disabled with "Available in the installed app" when `!startWithWindowsAvailable`.
- **Composer:** for the receptionist with a model whose `supportsTools === false`, a notice reads "This model can't use tools, so I can't keep your planner. Pick another model."

- [ ] **Step 1: Write the failing test** for `todayLines` (pure, in `tasks.ts`: `{ label, title, overdue }[]`, at most 5). **Step 2: Implement** the pieces. **Step 3: Run** `npm test` and typecheck. Build, and look at the planner, the briefing and the Today board with the live harness. **Step 4: Commit.** `feat(reception): the planner, the morning briefing, planner cards and the Today board`

---

### Task 6: Desktop check, screenshots and spec revisions

- [ ] **Step 1: Extend `tests/office-desktop.cjs`.** Set `process.env.AXON_QUIET_NOTIFICATIONS = '1'` before loading the app. Seed `reception.briefedOn` as yesterday. Then:
  - after load, the receptionist is selected and `.briefing-card` shows;
  - "Got it" dismisses it;
  - the planner shows;
  - add "Prep the investor deck" through the add row with today's date, and it appears under Today;
  - tick it, and it moves to Done; untick it;
  - edit its date to tomorrow 10:00 with the reminder on, and it moves to This week (or Today, depending on the day's end);
  - `taskAdd` a to-do with a reminder 3 s ahead, wait 5 s, and `remindedAt` is set;
  - the Today board lists the dated to-dos (`__axonOffice.boards()`);
  - the office now counts 208 and the strip 9.

  Screenshots: `c-reception.png` (the planner and the briefing) and `c-today-board.png`.
- [ ] **Step 2: Run everything:** typecheck, tests, build, the desktop check and the Electron smoke test. Also do the manual tray check from Task 4.
- [ ] **Step 3: Record** deviations 1–6 and anything tuned as spec revisions under "Part C". **Commit.** `test(reception): desktop check for the planner, briefing, reminders and Today board; record Part C revisions`
