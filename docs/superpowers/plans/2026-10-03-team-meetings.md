# Team Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Chief of Staff (or Ops Coordinator) picks the right coworkers for a task, gathers them in a new boardroom, the team plans and splits the work, you approve the plan, and owners work in parallel where safe, handing results on, until the lead reports back.

**Architecture:** A `TeamRunner` in the main process (`src/main/team/`) owns each team's state machine (meeting → planned → working → reporting → done). The meeting and report are model calls (the meeting reuses `consult`); every task is an ordinary `chatSend` run in its owner's own conversation, so approvals, audit, undo and Stop are unchanged. The window shows a plan card under the lead's `call_team_meeting` call; the office reads `teams` from the snapshot to seat people in the boardroom.

**Tech Stack:** Electron + TypeScript main process, React renderer, `node:test` tests (`.test.cjs` transpiling TS with `typescript`), Three.js office scene driven by a pure `OfficeSimulation`.

**Spec:** `docs/superpowers/specs/2026-10-03-team-meetings-design.md`

## Global Constraints

- Leads: `chief-of-staff` and `ops-coordinator` only.
- Attendees: 2–12 coworkers, never the lead; everyone uses the lead conversation's provider and model.
- Contributions: at most 4 model calls in flight; tasks: at most 3 running at once (`MAX_PARALLEL = 3`).
- Plans: 1–20 tasks; a hand-off (`result`) is kept up to 4,000 characters.
- Nothing about a task bypasses approvals: owners' writes and commands ask the user as today.
- Shared checkout: do not commit (the user commits); do not switch branches; leave `colleagues.ts` alone except the one `ConsultDeps.system` extension.
- Comments and UI copy follow the repo's voice: plain sentences, no jargon, say what a thing is for.

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (modify) | `Team`, `TeamAssignment`, `TeamMinute`, statuses; `Message.from`; `teams` stream event |
| `src/shared/platform.ts` (modify) | `PlatformState.teams`; `teamStart/teamStop/teamDiscard/teamRetry` |
| `src/main/repository.ts` (modify) | default and migrate `teams` |
| `src/main/team/plan.ts` (create) | pure: `validatePlan`, `readyAssignments`, `blockDependants`, `progress`, `resetForRetry`, `interruptTeams` |
| `src/main/team/tools.ts` (create) | tool definitions, `TEAM_LEADS`, `findPeople`, `resolveAttendees` |
| `src/main/team/meeting.ts` (create) | prompts (`meetingSystemPrompt`, `taskBrief`, `teamsBlock`, `teammateContext`), `draftPlan`, `writeReport` |
| `src/main/team/runner.ts` (create) | `TeamRunner`: create, meet, start, stop, discard, retry, schedule, finish |
| `src/main/colleagues.ts` (modify) | `ConsultDeps.system` optional override |
| `src/main/officeTools.ts` (modify) | leads get `find_people` and `call_team_meeting` |
| `src/main/security/permissions.ts` (modify) | team tools allowed |
| `src/main/service.ts` (modify) | wire the runner; answer team tools; `chatSend` `from`; lead's teams in the prompt; teammate context in `ask_colleague`; IPC methods |
| `src/main/index.ts`, `src/preload/index.ts` (modify) | IPC names |
| `src/renderer/src/features/office/activity/TeamCard.tsx` (create) | the plan card |
| `src/renderer/src/features/office/activity/Conversation.tsx` (modify) | render `TeamCard` for `call_team_meeting` |
| `src/renderer/src/chat/MessageView.tsx` (modify) | `from` label |
| `src/renderer/src/App.tsx` (modify) | `teams` event |
| `src/renderer/src/features/office/team.ts` (create) | pure view helpers: `teamOfCall`, `openMeetings`, status words |
| `src/renderer/src/features/office/campus/commons.ts` (modify) | boardroom replaces the collaboration corner |
| `src/renderer/src/features/office/simulation/*.ts` (modify) | `startTeamMeeting` / `endTeamMeeting`; `boardroom` group |
| `src/renderer/src/features/office/OfficeCanvas.tsx`, `scene/OfficeScene.ts` (modify) | sync meetings from teams |

---

### Task 1: Team data and storage

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/platform.ts`, `src/main/repository.ts`
- Create: `src/main/team/plan.ts` (only `interruptTeams` in this task)
- Test: `tests/team-plan.test.cjs`

**Interfaces:**
- Produces: types `Team`, `TeamAssignment`, `TeamMinute`, `TeamPlan`, `TeamStatus`, `AssignmentStatus`, `OPEN_TEAM` (set of open statuses, in `plan.ts`); `interruptTeams(teams: Team[], now: number): boolean`; `PlatformState.teams: Team[]`; `Message.from?: string`; stream event `{ channel: 'teams'; teams: Team[] }`.

- [ ] **Step 1: Types.** Add to `src/shared/types.ts` (after `TaskItem`):

```ts
/* ---------------------------------- Teams ----------------------------------- */
export type TeamStatus = 'meeting' | 'planned' | 'working' | 'reporting' | 'done' | 'stopped' | 'failed' | 'discarded';
export type AssignmentStatus = 'waiting' | 'working' | 'done' | 'failed' | 'stopped' | 'blocked';
/** One task in a team's plan: who does it, what it waits for, the files it owns, and how it went. */
export interface TeamAssignment {
  id: string;
  ownerId: string;
  title: string;
  brief: string;
  dependsOn: string[];
  files: string[];
  status: AssignmentStatus;
  conversationId?: ID;
  /** The owner's final answer: what they hand on. */
  result?: string;
  /** Why it failed, stopped or is blocked. */
  note?: string;
}
/** What one attendee said in the meeting. */
export interface TeamMinute { coworkerId: string; text: string; at: number; error?: string }
export interface TeamPlan { summary: string; assignments: TeamAssignment[] }
/** A team a lead gathered: the meeting, the plan you approve, the work, and the report. */
export interface Team {
  id: ID;
  leadId: string;
  /** The lead's conversation the meeting was called from. */
  conversationId: ID;
  goal: string;
  attendees: string[];
  providerId: ID;
  modelId: string;
  status: TeamStatus;
  minutes: TeamMinute[];
  plan?: TeamPlan;
  report?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
```

Add to `Message`: `/** Who sent a message on your side when it wasn't you, e.g. a team brief from the Chief of Staff. */ from?: string;`. Add to `StreamEvent`: `| { /** Every team, after any change. */ channel: 'teams'; teams: Team[] }`.

- [ ] **Step 2: State.** In `src/shared/platform.ts` add `/** Teams the leads gathered. */ teams: Team[];` to `PlatformState` and to `PlatformAPI`:

```ts
  teamStart(id: string): Promise<void>;
  teamStop(id: string): Promise<void>;
  teamDiscard(id: string): Promise<void>;
  teamRetry(id: string): Promise<void>;
```

In `src/main/repository.ts`: default state gets `teams: []`; `migrate` gets `state.teams = Array.isArray(state.teams) ? state.teams : [];`.

- [ ] **Step 3: Failing test** `tests/team-plan.test.cjs` (header as in `tests/office-edit-file.test.cjs`, requiring `../src/main/team/plan.ts`):

```js
test('a team open when Axon closed loads stopped, with its running tasks stopped', () => {
  const teams = [
    { id: 'a', status: 'working', minutes: [], plan: { summary: '', assignments: [
      { id: 't1', status: 'working' }, { id: 't2', status: 'waiting' }, { id: 't3', status: 'done' }] } },
    { id: 'b', status: 'meeting', minutes: [] },
    { id: 'c', status: 'planned', minutes: [] },
    { id: 'd', status: 'done', minutes: [] }
  ];
  assert.equal(plan.interruptTeams(teams, 5), true);
  assert.deepEqual(teams.map((t) => t.status), ['stopped', 'stopped', 'planned', 'done']);
  assert.deepEqual(teams[0].plan.assignments.map((a) => a.status), ['stopped', 'waiting', 'done']);
  assert.match(teams[0].note, /closed/);
  assert.equal(plan.interruptTeams(teams, 6), false, 'nothing left to stop');
});
```

- [ ] **Step 4:** Run `node --test tests/team-plan.test.cjs` → FAIL (module missing).
- [ ] **Step 5: Implement** in `src/main/team/plan.ts`:

```ts
import type { Team, TeamStatus } from '../../shared/types';

/** A team that is still going: it has a meeting, a plan waiting for you, or work under way. */
export const OPEN_TEAM: ReadonlySet<TeamStatus> = new Set(['meeting', 'planned', 'working', 'reporting']);
/** Statuses that need something running: after a restart nothing is. */
const RUNNING: ReadonlySet<TeamStatus> = new Set(['meeting', 'working', 'reporting']);

/** After a restart: teams that were running are stopped, so Retry can carry them on. */
export function interruptTeams(teams: Team[], now: number): boolean {
  let changed = false;
  for (const team of teams) {
    if (!RUNNING.has(team.status)) continue;
    team.status = 'stopped';
    team.note = 'Axon closed while the team was working. Retry to carry on.';
    team.updatedAt = now;
    for (const a of team.plan?.assignments ?? [])
      if (a.status === 'working') Object.assign(a, { status: 'stopped', note: 'Axon closed while this was running' });
    changed = true;
  }
  return changed;
}
```

- [ ] **Step 6:** Run the test → PASS; `npx tsc --noEmit` → fix every place that builds a `PlatformState` literal (tests' seeded JSON is fine: migrate defaults it).

### Task 2: Plan checks and scheduling (pure)

**Files:** Modify `src/main/team/plan.ts`; Test `tests/team-plan.test.cjs`

**Interfaces:**
- Produces:
  - `validatePlan(input: { summary?: unknown; assignments?: unknown }, attendees: { id: string; name: string }[]): { ok: true; plan: TeamPlan } | { ok: false; errors: string[] }`
  - `readyAssignments(assignments: TeamAssignment[]): TeamAssignment[]`
  - `blockDependants(assignments: TeamAssignment[]): boolean`
  - `progress(assignments: TeamAssignment[]): 'done' | 'working' | 'stuck'`
  - `resetForRetry(assignments: TeamAssignment[]): number`
  - `MAX_ASSIGNMENTS = 20`, `MAX_PARALLEL = 3`, `RESULT_LIMIT = 4000`

- [ ] **Step 1: Failing tests** (append to `tests/team-plan.test.cjs`):

```js
const people = [{ id: 'backend-developer', name: 'Backend Developer' }, { id: 'frontend-developer', name: 'Frontend Developer' }, { id: 'qa-engineer', name: 'QA Engineer' }];
const task = (id, owner, extra = {}) => ({ id, owner, title: `Task ${id}`, brief: `Do ${id}`, depends_on: [], files: [], ...extra });

test('a sound plan comes back with owners as ids, paths normalised, every task waiting', () => {
  const result = plan.validatePlan({ summary: 'Build it', assignments: [
    task('t1', 'Backend Developer', { files: ['.\\src\\api.ts'] }),
    task('t2', 'frontend-developer', { depends_on: ['t1'], files: ['src/ui.tsx'] })
  ] }, people);
  assert.equal(result.ok, true);
  assert.equal(result.plan.summary, 'Build it');
  assert.deepEqual(result.plan.assignments.map((a) => [a.id, a.ownerId, a.dependsOn, a.files, a.status]), [
    ['t1', 'backend-developer', [], ['src/api.ts'], 'waiting'],
    ['t2', 'frontend-developer', ['t1'], ['src/ui.tsx'], 'waiting']
  ]);
});

test('owners must be in the meeting; ids unique; dependencies real and acyclic', () => {
  const errors = (assignments) => plan.validatePlan({ summary: '', assignments }, people).errors.join('\n');
  assert.match(errors([task('t1', 'Designer')]), /not in this meeting/);
  assert.match(errors([task('t1', 'QA Engineer'), task('t1', 'QA Engineer')]), /twice/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t9'] })]), /t9/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t1'] })]), /itself/);
  assert.match(errors([task('t1', 'QA Engineer', { depends_on: ['t2'] }), task('t2', 'QA Engineer', { depends_on: ['t1'] })]), /loop/);
  assert.match(errors([]), /at least one/);
  assert.match(errors(Array.from({ length: 21 }, (_, i) => task(`t${i}`, 'QA Engineer'))), /20/);
  assert.match(errors([{ id: 't1', owner: 'QA Engineer', title: '', brief: '' }]), /title/);
});

test('two tasks that may run together never own the same file; in order they may', () => {
  const clash = plan.validatePlan({ summary: '', assignments: [
    task('t1', 'Backend Developer', { files: ['src/a.ts'] }),
    task('t2', 'Frontend Developer', { files: ['src/a.ts'] })
  ] }, people);
  assert.equal(clash.ok, false);
  assert.match(clash.errors.join(), /src\/a\.ts/);
  const ordered = plan.validatePlan({ summary: '', assignments: [
    task('t1', 'Backend Developer', { files: ['src/a.ts'] }),
    task('t2', 'Frontend Developer', { files: ['src/a.ts'] }),
    task('t3', 'QA Engineer', { depends_on: ['t2'], files: ['src/a.ts'] })
  ].map((a) => (a.id === 't2' ? { ...a, depends_on: ['t1'] } : a)) }, people);
  assert.equal(ordered.ok, true, ordered.errors?.join());
});

const states = (...pairs) => pairs.map(([id, status, dependsOn = []]) => ({ id, status, dependsOn }));

test('ready tasks are waiting with every dependency done', () => {
  const list = states(['t1', 'done'], ['t2', 'waiting', ['t1']], ['t3', 'waiting', ['t2']], ['t4', 'waiting']);
  assert.deepEqual(plan.readyAssignments(list).map((a) => a.id), ['t2', 't4']);
});

test('a failed task blocks only what depends on it, directly or not', () => {
  const list = states(['t1', 'failed'], ['t2', 'waiting', ['t1']], ['t3', 'waiting', ['t2']], ['t4', 'waiting']);
  assert.equal(plan.blockDependants(list), true);
  assert.deepEqual(list.map((a) => a.status), ['failed', 'blocked', 'blocked', 'waiting']);
  assert.equal(plan.blockDependants(list), false);
});

test('progress: done when all done, working while anything runs or can start, otherwise stuck', () => {
  assert.equal(plan.progress(states(['t1', 'done'], ['t2', 'done'])), 'done');
  assert.equal(plan.progress(states(['t1', 'working'], ['t2', 'failed'])), 'working');
  assert.equal(plan.progress(states(['t1', 'done'], ['t2', 'waiting', ['t1']])), 'working');
  assert.equal(plan.progress(states(['t1', 'failed'], ['t2', 'blocked', ['t1']])), 'stuck');
});

test('retry puts failed, stopped and blocked tasks back to waiting', () => {
  const list = states(['t1', 'failed'], ['t2', 'blocked'], ['t3', 'stopped'], ['t4', 'done']);
  list[0].note = 'boom';
  assert.equal(plan.resetForRetry(list), 3);
  assert.deepEqual(list.map((a) => a.status), ['waiting', 'waiting', 'waiting', 'done']);
  assert.equal(list[0].note, undefined);
});
```

- [ ] **Step 2:** Run → FAIL (`validatePlan` is not a function).
- [ ] **Step 3: Implement** (append to `plan.ts`; import `TeamAssignment`, `TeamPlan`):

```ts
export const MAX_ASSIGNMENTS = 20;
/** Tasks running at once. */
export const MAX_PARALLEL = 3;
/** How much of an owner's final answer is handed on. */
export const RESULT_LIMIT = 4000;

/** A project path as listings show it: slashes, no leading ./ or /. */
export function normalPath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []);

/** Every task each task waits for, directly or through others. */
function prerequisites(assignments: { id: string; dependsOn: string[] }[]): Map<string, Set<string>> {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const memo = new Map<string, Set<string>>();
  const visit = (id: string, path: Set<string>): Set<string> => {
    const known = memo.get(id);
    if (known) return known;
    const all = new Set<string>();
    if (path.has(id)) return all; // a loop: reported separately
    path.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      all.add(dep);
      for (const deeper of visit(dep, path)) all.add(deeper);
    }
    path.delete(id);
    memo.set(id, all);
    return all;
  };
  for (const a of assignments) visit(a.id, new Set());
  return memo;
}

/** Checks the lead's proposed plan against who is in the meeting, and makes it the team's plan. */
export function validatePlan(
  input: { summary?: unknown; assignments?: unknown },
  attendees: { id: string; name: string }[]
): { ok: true; plan: TeamPlan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const raw = Array.isArray(input.assignments) ? (input.assignments as Record<string, unknown>[]) : [];
  if (!raw.length) return { ok: false, errors: ['The plan needs at least one task.'] };
  if (raw.length > MAX_ASSIGNMENTS) return { ok: false, errors: [`A plan has at most ${MAX_ASSIGNMENTS} tasks; merge some.`] };
  const ownerOf = (name: string) =>
    attendees.find((p) => p.id === name.toLowerCase() || p.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const ids = new Set<string>();
  const assignments: TeamAssignment[] = raw.map((item, index) => {
    const id = text(item?.id) || `t${index + 1}`;
    if (ids.has(id)) errors.push(`The id ${id} is used twice; give every task its own.`);
    ids.add(id);
    const owner = text(item?.owner);
    const ownerId = ownerOf(owner);
    if (!ownerId)
      errors.push(`${id}: "${owner}" is not in this meeting. Owners must be attendees: ${attendees.map((p) => p.name).join(', ')}.`);
    const title = text(item?.title), brief = text(item?.brief);
    if (!title || !brief) errors.push(`${id}: every task needs a title and a brief.`);
    return { id, ownerId: ownerId ?? owner, title, brief, dependsOn: strings(item?.depends_on), files: [...new Set(strings(item?.files).map(normalPath))], status: 'waiting' as const };
  });
  for (const a of assignments)
    for (const dep of a.dependsOn) {
      if (dep === a.id) errors.push(`${a.id} depends on itself.`);
      else if (!ids.has(dep)) errors.push(`${a.id} depends on ${dep}, which is not in the plan.`);
    }
  const before = prerequisites(assignments);
  for (const a of assignments)
    if (before.get(a.id)?.has(a.id)) errors.push(`${a.id} is in a dependency loop; tasks cannot wait for each other.`);
  // Two tasks that may run at the same time may not own the same file.
  for (let i = 0; i < assignments.length; i++)
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i], b = assignments[j];
      if (before.get(a.id)?.has(b.id) || before.get(b.id)?.has(a.id)) continue;
      for (const file of a.files.filter((f) => b.files.includes(f)))
        errors.push(`${a.id} and ${b.id} both own ${file} but could run at the same time; make one wait for the other, or give the file to one of them.`);
    }
  return errors.length ? { ok: false, errors } : { ok: true, plan: { summary: text(input.summary), assignments } };
}

/** Tasks that may start now: waiting, with every task they wait for done. */
export function readyAssignments(assignments: TeamAssignment[]): TeamAssignment[] {
  const done = new Set(assignments.filter((a) => a.status === 'done').map((a) => a.id));
  return assignments.filter((a) => a.status === 'waiting' && a.dependsOn.every((d) => done.has(d)));
}

/** Waiting tasks that can never start, because something they wait for failed, stopped or is blocked. */
export function blockDependants(assignments: TeamAssignment[]): boolean {
  let changed = false, again = true;
  while (again) {
    again = false;
    const dead = new Set(assignments.filter((a) => ['failed', 'stopped', 'blocked'].includes(a.status)).map((a) => a.id));
    for (const a of assignments)
      if (a.status === 'waiting' && a.dependsOn.some((d) => dead.has(d))) {
        a.status = 'blocked';
        a.note = `Waiting for ${a.dependsOn.filter((d) => dead.has(d)).join(', ')}, which did not finish`;
        changed = again = true;
      }
  }
  return changed;
}

/** Where the work stands: all done, still going (running or able to start), or stuck on failures. */
export function progress(assignments: TeamAssignment[]): 'done' | 'working' | 'stuck' {
  if (assignments.every((a) => a.status === 'done')) return 'done';
  if (assignments.some((a) => a.status === 'working') || readyAssignments(assignments).length) return 'working';
  return 'stuck';
}

/** Retry: what failed, stopped or was blocked goes back to waiting. */
export function resetForRetry(assignments: TeamAssignment[]): number {
  let count = 0;
  for (const a of assignments)
    if (a.status === 'failed' || a.status === 'stopped' || a.status === 'blocked') {
      a.status = 'waiting';
      a.note = undefined;
      count++;
    }
  return count;
}
```

- [ ] **Step 4:** Run `node --test tests/team-plan.test.cjs` → all PASS.

### Task 3: Team tools, prompts, plan drafting and report

**Files:**
- Create: `src/main/team/tools.ts`, `src/main/team/meeting.ts`
- Modify: `src/main/colleagues.ts` (`ConsultDeps.system`)
- Test: `tests/team-meeting.test.cjs`

**Interfaces:**
- Consumes: `validatePlan`, `RESULT_LIMIT` (Task 2); `resolveColleague`, `consult` (colleagues.ts); `scoreCoworkers`; `COWORKERS`, `coworkerById`.
- Produces:
  - `TEAM_LEADS: ReadonlySet<string>`, `FIND_PEOPLE`, `CALL_TEAM_MEETING`, `PROPOSE_PLAN: ToolDefinition`, `TEAM_TOOLS: ToolDefinition[]`, `TEAM_TOOL_NAMES: ReadonlySet<string>`, `MIN_ATTENDEES = 2`, `MAX_ATTENDEES = 12`
  - `findPeople(need: string, leadId: string, limit?: number): string`
  - `resolveAttendees(names: unknown, leadId: string): { ids: string[] } | { error: string }`
  - `meetingSystemPrompt(attendee: Coworker, team: Team): string`, `MEETING_ASK: string`
  - `draftPlan(team: Team, model: ModelCall): Promise<{ plan: TeamPlan } | { errors: string[] }>`
  - `writeReport(team: Team, model: ModelCall): Promise<string>`
  - `taskBrief(team: Team, assignment: TeamAssignment): string`
  - `teamsBlock(teams: Team[]): string`, `teammateContext(team: Team, colleagueId: string): string`
  - `interface ModelCall { stream: typeof streamChat; provider: ProviderConfig; key: string | null; modelId: string; maxTokens?: number; signal?: AbortSignal }`

- [ ] **Step 1: Failing tests** `tests/team-meeting.test.cjs` (electron stub header as in `tests/agent-tools.test.cjs`):

```js
const tools = require('../src/main/team/tools.ts');
const meeting = require('../src/main/team/meeting.ts');
const team = (extra = {}) => ({
  id: 'team1', leadId: 'chief-of-staff', conversationId: 'c1', goal: 'Add a password reset flow',
  attendees: ['backend-developer', 'frontend-developer'], providerId: 'p', modelId: 'm', status: 'meeting',
  minutes: [{ coworkerId: 'backend-developer', text: 'I own the API.', at: 1 }, { coworkerId: 'frontend-developer', text: 'I own the form.', at: 2 }],
  createdAt: 0, updatedAt: 0, ...extra
});

test('find_people ranks who fits a need, never the lead', () => {
  const found = tools.findPeople('security', 'chief-of-staff');
  assert.match(found, /Security/);
  assert.doesNotMatch(found, /Chief of Staff/);
  assert.ok(found.split('\n').length <= 9);
  assert.match(tools.findPeople('zzqqxx', 'chief-of-staff'), /Nobody/);
});

test('attendees resolve by name or id, the lead and repeats are left out, vague names are refused', () => {
  assert.deepEqual(tools.resolveAttendees(['Backend Developer', 'frontend-developer', 'Backend Developer', 'Chief of Staff'], 'chief-of-staff'), { ids: ['backend-developer', 'frontend-developer'] });
  assert.match(tools.resolveAttendees(['engineer', 'Backend Developer'], 'chief-of-staff').error, /engineer/);
  assert.match(tools.resolveAttendees(['Backend Developer'], 'chief-of-staff').error, /at least 2/);
  assert.match(tools.resolveAttendees('Backend Developer', 'chief-of-staff').error, /list/);
  const thirteen = ['Backend Developer', 'Frontend Developer', 'QA Engineer', 'Security Engineer', 'Designer', 'Research Analyst', 'Product Coach', 'Marketing Strategist', 'Knowledge Librarian', 'Files Agent', 'Ops Coordinator', 'DevOps Engineer', 'Data Engineer'];
  assert.match(tools.resolveAttendees(thirteen, 'chief-of-staff').error, /12/);
});

test('leads get the team tools in their descriptions of when to use them', () => {
  assert.ok(tools.TEAM_LEADS.has('chief-of-staff') && tools.TEAM_LEADS.has('ops-coordinator'));
  assert.match(tools.CALL_TEAM_MEETING.description, /more than one specialty/);
  assert.deepEqual(tools.CALL_TEAM_MEETING.parameters.required, ['goal', 'attendees']);
});

test('the meeting prompt tells an attendee the goal, who else is there, and not to do the work yet', () => {
  const prompt = meeting.meetingSystemPrompt(require('../src/shared/coworkers.ts').coworkerById('backend-developer'), team());
  assert.match(prompt, /password reset/);
  assert.match(prompt, /Frontend Developer/);
  assert.match(prompt, /Do not do the work/);
});

/** A model that answers each call with the next reply. */
const scripted = (...replies) => {
  const seen = [];
  return { seen, model: { provider: {}, key: null, modelId: 'm', stream: async (_p, _k, req) => { seen.push(req); return replies.shift(); } } };
};
const proposal = (args) => ({ toolCalls: [{ id: `p${Math.random()}`, name: 'propose_plan', arguments: JSON.stringify(args) }] });

test('the lead drafts the plan with propose_plan; a broken plan goes back once with the reasons', async () => {
  const bad = { summary: 'x', assignments: [{ id: 't1', owner: 'Designer', title: 'a', brief: 'b' }] };
  const good = { summary: 'API then form', assignments: [
    { id: 't1', owner: 'Backend Developer', title: 'API', brief: 'Build the reset API', files: ['src/api.ts'] },
    { id: 't2', owner: 'Frontend Developer', title: 'Form', brief: 'Build the form', depends_on: ['t1'], files: ['src/form.tsx'] }] };
  const { seen, model } = scripted(proposal(bad), proposal(good));
  const result = await meeting.draftPlan(team(), model);
  assert.equal(result.plan.assignments.length, 2);
  assert.deepEqual(seen[0].tools.map((t) => t.name), ['propose_plan']);
  assert.match(seen[0].messages[0].content, /I own the API/);
  assert.match(seen[1].messages.at(-1).content, /not in this meeting/);
});

test('a plan broken twice, or never proposed, fails with the reasons', async () => {
  const bad = proposal({ summary: '', assignments: [] });
  assert.match((await meeting.draftPlan(team(), scripted(bad, bad).model)).errors.join(), /at least one/);
  assert.match((await meeting.draftPlan(team(), scripted({ toolCalls: [] }, { toolCalls: [] }).model)).errors.join(), /propose_plan/);
});

test('a task brief has the goal, the task, its files, others\' files, and the hand-offs it waits for', () => {
  const t = team({ status: 'working', plan: { summary: 'API then form', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'Build the API', dependsOn: [], files: ['src/api.ts'], status: 'done', result: 'POST /reset is live.' },
    { id: 't2', ownerId: 'frontend-developer', title: 'Form', brief: 'Build the form', dependsOn: ['t1'], files: ['src/form.tsx'], status: 'waiting' }] } });
  const brief = meeting.taskBrief(t, t.plan.assignments[1]);
  for (const part of [/password reset/, /Build the form/, /src\/form\.tsx/, /src\/api\.ts/, /POST \/reset is live/, /Backend Developer/]) assert.match(brief, part);
});

test('the report is written from the goal, plan and hand-offs, with no tools', async () => {
  const { seen, model } = scripted({ toolCalls: [] });
  model.stream = async (_p, _k, req, onChunk) => { seen.push(req); onChunk('All done.'); return { toolCalls: [] }; };
  const t = team({ status: 'reporting', plan: { summary: 's', assignments: [{ id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'b', dependsOn: [], files: [], status: 'done', result: 'Shipped.' }] } });
  assert.equal(await meeting.writeReport(t, model), 'All done.');
  assert.equal(seen[0].tools, undefined);
  assert.match(seen[0].messages[0].content, /Shipped\./);
});

test('a lead remembers their teams; a teammate knows the asker shares their team', () => {
  const t = team({ status: 'working', plan: { summary: 's', assignments: [{ id: 't1', ownerId: 'backend-developer', title: 'API', brief: 'b', dependsOn: [], files: [], status: 'working' }] } });
  assert.match(meeting.teamsBlock([t]), /password reset[\s\S]*Backend Developer[\s\S]*working/);
  assert.match(meeting.teammateContext(t, 'backend-developer'), /Your task: API/);
  assert.equal(meeting.teammateContext(t, 'qa-engineer'), '');
});
```

- [ ] **Step 2:** Run → FAIL (modules missing).
- [ ] **Step 3: `colleagues.ts`** — add to `ConsultDeps`: `/** The colleague's system prompt, when they answer in a setting other than a question (a team meeting). */ system?: string;` and in `consult`: `const system = deps.system ?? consultSystemPrompt(colleague, askerName);`.
- [ ] **Step 4: `tools.ts`:**

```ts
import { COWORKERS, RECEPTIONIST_ID, coworkerById } from '../../shared/coworkers';
import { scoreCoworkers } from '../../shared/coworkerSearch';
import type { ToolDefinition } from '../../shared/types';
import { resolveColleague } from '../colleagues';

/** Who may gather a team. */
export const TEAM_LEADS: ReadonlySet<string> = new Set(['chief-of-staff', 'ops-coordinator']);
export const MIN_ATTENDEES = 2;
export const MAX_ATTENDEES = 12;

export const FIND_PEOPLE: ToolDefinition = {
  name: 'find_people',
  description: 'Find the coworkers best suited to a need, ranked, with what each is good at. Use it before calling a team meeting to pick the right people.',
  parameters: { type: 'object', properties: { need: { type: 'string', description: 'The skill or work, e.g. "payment webhooks" or "accessibility review"' } }, required: ['need'] }
};
export const CALL_TEAM_MEETING: ToolDefinition = {
  name: 'call_team_meeting',
  description:
    'Gather a team for work that needs more than one specialty. They meet, each says how they would approach their part, and you then turn that into a plan the user approves before anyone starts. Pick 2-12 people by name (use find_people). A question you can answer alone needs no meeting.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'What the team is to achieve, with the context they need' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Their names, e.g. ["Backend Developer", "QA Engineer"]' }
    },
    required: ['goal', 'attendees']
  }
};
export const PROPOSE_PLAN: ToolDefinition = {
  name: 'propose_plan',
  description: "Propose the team's plan: who does what, in what order, and which files each task owns.",
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'The approach in two or three sentences' },
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 't1, t2, …' },
            owner: { type: 'string', description: 'An attendee, by name' },
            title: { type: 'string' },
            brief: { type: 'string', description: 'What to do, in enough detail to start without the meeting' },
            depends_on: { type: 'array', items: { type: 'string' }, description: 'Ids of tasks that must finish first' },
            files: { type: 'array', items: { type: 'string' }, description: 'Project paths this task creates or changes' }
          },
          required: ['id', 'owner', 'title', 'brief']
        }
      }
    },
    required: ['summary', 'assignments']
  }
};
export const TEAM_TOOLS: ToolDefinition[] = [FIND_PEOPLE, CALL_TEAM_MEETING];
export const TEAM_TOOL_NAMES: ReadonlySet<string> = new Set(TEAM_TOOLS.map((t) => t.name));

/** The coworkers who best fit a need, one per line; never the lead or the receptionist. */
export function findPeople(need: string, leadId: string, limit = 8): string {
  const pool = COWORKERS.filter((c) => c.id !== leadId && c.id !== RECEPTIONIST_ID);
  const ranked = scoreCoworkers(need, pool, (c) => ({
    name: c.name, area: `${c.department} ${c.role}`, about: `${c.capabilities.join(' ')} ${c.description}`, prompt: c.systemPrompt
  })).filter((entry) => entry.score > 0).slice(0, limit);
  if (!ranked.length) return `Nobody matches "${need}". Try a broader phrase, such as "frontend" or "security".`;
  return ranked.map(({ item: c }) => `- ${c.name} (${c.department}): ${c.capabilities.slice(0, 4).join(', ')}. ${c.description}`).join('\n');
}

/** The attendees a lead named, as coworker ids: the lead and repeats left out; any vague name refuses the lot. */
export function resolveAttendees(names: unknown, leadId: string): { ids: string[] } | { error: string } {
  if (!Array.isArray(names)) return { error: 'attendees must be a list of names, e.g. ["Backend Developer", "QA Engineer"].' };
  const ids: string[] = [], problems: string[] = [];
  const lead = coworkerById(leadId);
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name || name === leadId || name.toLowerCase() === lead?.name.toLowerCase()) continue;
    const found = resolveColleague(name, leadId);
    if ('error' in found) problems.push(found.error);
    else if (!ids.includes(found.coworker.id)) ids.push(found.coworker.id);
  }
  if (problems.length) return { error: `${problems.join(' ')} Use find_people, then name them exactly.` };
  if (ids.length < MIN_ATTENDEES) return { error: `A team meeting needs at least ${MIN_ATTENDEES} people besides you.` };
  if (ids.length > MAX_ATTENDEES) return { error: `At most ${MAX_ATTENDEES} people fit the boardroom; pick the ones the goal needs most.` };
  return { ids };
}
```

- [ ] **Step 5: `meeting.ts`:**

```ts
import { coworkerById, type Coworker } from '../../shared/coworkers';
import type { ChatRequestMessage, ProviderConfig, Team, TeamAssignment, TeamPlan } from '../../shared/types';
import { rolesBlock } from '../prompt';
import type { streamChat } from '../providers';
import { roleProfiles } from '../roles';
import { RESULT_LIMIT, validatePlan } from './plan';
import { PROPOSE_PLAN } from './tools';

/** One model, as a team uses it: the lead's provider, key and model for everyone. */
export interface ModelCall {
  stream: typeof streamChat;
  provider: ProviderConfig;
  key: string | null;
  modelId: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

const nameOf = (id: string) => coworkerById(id)?.name ?? id;
const who = (team: Team) => team.attendees.map((id) => { const c = coworkerById(id); return c ? `${c.name} (${c.department})` : id; }).join(', ');

/** What an attendee is asked to bring to the meeting. */
export const MEETING_ASK = 'The meeting is starting. Give your input now.';

/** An attendee in the meeting: who they are, the goal, who else is there, and what to bring. */
export function meetingSystemPrompt(attendee: Coworker, team: Team): string {
  return [
    attendee.systemPrompt,
    rolesBlock(roleProfiles(attendee.roleIds)),
    `${nameOf(team.leadId)} has called a team meeting about this goal:\n${team.goal}\n\nIn the room: ${who(team)}.`,
    'From your specialty, in under 200 words: how you would approach your part, what you would own (files or areas), what you need from whom, and the main risk. Do not do the work yet; you may read the project to ground your answer.'
  ].filter(Boolean).join('\n\n');
}

const minutesText = (team: Team) =>
  team.minutes.map((m) => `## ${nameOf(m.coworkerId)}\n${m.error ? `(could not answer: ${m.error})` : m.text}`).join('\n\n');

/** The lead turns the minutes into a plan with propose_plan; a broken plan goes back once with the reasons. */
export async function draftPlan(team: Team, model: ModelCall): Promise<{ plan: TeamPlan } | { errors: string[] }> {
  const lead = coworkerById(team.leadId);
  const system = [
    lead?.systemPrompt ?? '',
    `You ran a team meeting about this goal:\n${team.goal}`,
    'Turn what the team said into a plan by calling propose_plan exactly once. Give each task to the attendee best placed for it, in enough detail to start without the meeting. Make a task depend on another only when it needs its result. Give every file to one task; two tasks that could run at the same time must never share a file.'
  ].filter(Boolean).join('\n\n');
  const attendees = team.attendees.map((id) => ({ id, name: nameOf(id) }));
  const messages: ChatRequestMessage[] = [{ role: 'user', content: `What the team said:\n\n${minutesText(team)}` }];
  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.stream(model.provider, model.key, {
      model: model.modelId, messages, system, temperature: 0.2, maxTokens: model.maxTokens, tools: [PROPOSE_PLAN], signal: model.signal
    }, () => {});
    const call = (result.toolCalls ?? []).find((tc) => tc.name === PROPOSE_PLAN.name);
    if (!call) {
      errors = ['The lead did not call propose_plan.'];
      messages.push({ role: 'assistant', content: '' }, { role: 'user', content: 'Call propose_plan now with the plan.' });
      continue;
    }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.arguments); } catch { errors = ['The plan was not valid JSON.']; }
    const checked = validatePlan(args, attendees);
    if (checked.ok) return { plan: checked.plan };
    errors = checked.errors;
    messages.push(
      { role: 'assistant', content: '', toolCalls: [call], replay: result.replay },
      { role: 'tool', toolCallId: call.id, name: call.name, content: `The plan was not accepted:\n- ${errors.join('\n- ')}\nCall propose_plan again with these fixed.` }
    );
  }
  return { errors };
}

/** The lead's report when every task is done: no tools, from the goal, plan and hand-offs. */
export async function writeReport(team: Team, model: ModelCall): Promise<string> {
  const lead = coworkerById(team.leadId);
  const work = (team.plan?.assignments ?? []).map((a) => `## ${a.title} — ${nameOf(a.ownerId)}\n${a.result || '(no hand-off)'}`).join('\n\n');
  let text = '';
  await model.stream(model.provider, model.key, {
    model: model.modelId,
    system: [lead?.systemPrompt ?? '', 'Your team has finished. Report to the user in under 250 words: what was done, by whom, anything left open, and what they should check.'].filter(Boolean).join('\n\n'),
    messages: [{ role: 'user', content: `Goal:\n${team.goal}\n\nPlan:\n${team.plan?.summary ?? ''}\n\nWhat each person handed in:\n\n${work}` }],
    temperature: 0.3, maxTokens: model.maxTokens, signal: model.signal
  }, (chunk, delta) => { if (delta?.type !== 'thought' && chunk) text += chunk; });
  return text.trim();
}

/** What an owner is sent to start their task. */
export function taskBrief(team: Team, assignment: TeamAssignment): string {
  const all = team.plan?.assignments ?? [];
  const others = all.filter((a) => a.id !== assignment.id);
  const handOffs = assignment.dependsOn
    .map((id) => all.find((a) => a.id === id))
    .filter((a): a is TeamAssignment => !!a)
    .map((a) => `### ${a.title} — ${nameOf(a.ownerId)}\n${a.result || '(no hand-off)'}`);
  return [
    `Team goal: ${team.goal}`,
    team.plan?.summary ? `The plan: ${team.plan.summary}` : '',
    `Your task (${assignment.id}): ${assignment.title}\n${assignment.brief}`,
    assignment.files.length ? `Files that are yours to create or change: ${assignment.files.join(', ')}` : '',
    others.length
      ? `The rest of the team (do not edit files someone else owns; ask them with ask_colleague):\n${others.map((a) => `- ${nameOf(a.ownerId)}: ${a.title}${a.files.length ? ` (owns ${a.files.join(', ')})` : ''} — ${a.status}`).join('\n')}`
      : '',
    handOffs.length ? `What you are building on:\n\n${handOffs.join('\n\n')}` : '',
    'When you are done, end with a short hand-off: what you did, where it is, and anything the next person must know.'
  ].filter(Boolean).join('\n\n');
}

/** A lead's recent teams, for their system prompt: so they can answer how it is going and act on it. */
export function teamsBlock(teams: Team[]): string {
  if (!teams.length) return '';
  return ['## Your teams', ...teams.map((t) => [
    `### ${t.goal} — ${t.status}${t.note ? ` (${t.note})` : ''}`,
    ...(t.plan?.assignments ?? []).map((a) => `- ${a.id} ${a.title}: ${nameOf(a.ownerId)}, ${a.status}${a.note ? ` (${a.note})` : ''}`),
    t.report ? `Report: ${t.report}` : ''
  ].filter(Boolean).join('\n'))].join('\n\n');
}

/** Said to a colleague asked by a teammate: they share a team, and here is their own part. Empty when they don't. */
export function teammateContext(team: Team, colleagueId: string): string {
  const mine = team.plan?.assignments.find((a) => a.ownerId === colleagueId);
  if (!mine) return '';
  return `You are both on the team for: ${team.goal}\nYour task: ${mine.title} (${mine.status}).${mine.result ? `\nYour hand-off so far: ${mine.result.slice(0, RESULT_LIMIT / 2)}` : ''}`;
}
```

- [ ] **Step 6:** Run `node --test tests/team-meeting.test.cjs tests/colleagues.test.cjs tests/consult-final-answer.test.cjs` → PASS.

### Task 4: The team runner

**Files:** Create `src/main/team/runner.ts`; Test `tests/team-runner.test.cjs`

**Interfaces:**
- Consumes: Task 2 helpers; `Team` types.
- Produces:

```ts
export interface WorkOutcome { outcome: 'done' | 'failed' | 'stopped'; answer: string; error?: string }
export interface TeamRunnerDeps {
  teams: () => Team[];
  id: () => string;
  now?: () => number;
  /** After any change: save, and tell the window. */
  changed: () => void;
  contribute: (team: Team, attendeeId: string, signal: AbortSignal) => Promise<string>;
  plan: (team: Team, signal: AbortSignal) => Promise<{ plan: TeamPlan } | { errors: string[] }>;
  work: (team: Team, assignment: TeamAssignment, started: (conversationId: string) => void) => Promise<WorkOutcome>;
  stopWork: (conversationId: string) => void;
  report: (team: Team, signal: AbortSignal) => Promise<string>;
  finished?: (team: Team) => void;
}
export class TeamRunner {
  constructor(deps: TeamRunnerDeps);
  create(input: { leadId: string; conversationId: string; goal: string; attendees: string[]; providerId: string; modelId: string }): Team;
  meet(teamId: string): Promise<void>;     // resolves when planned, failed or stopped
  start(teamId: string): void;             // planned → working
  stop(teamId: string): void;
  discard(teamId: string): void;
  retry(teamId: string): void;
  /** Resolves once nothing of this team is running (tests and shutdown). */
  idle(teamId: string): Promise<void>;
}
```

- [ ] **Step 1: Failing tests** `tests/team-runner.test.cjs` — fakes for every dep:

```js
const { TeamRunner } = require('../src/main/team/runner.ts');
const tick = () => new Promise((r) => setImmediate(r));
/** A runner whose model and runs are scripted; `runs` resolves each started task by id. */
function rig(overrides = {}) {
  const teams = [], log = [], runs = new Map(), stopped = [];
  let n = 0;
  const runner = new TeamRunner({
    teams: () => teams, id: () => `id${++n}`, now: () => 1, changed: () => {},
    contribute: async (_team, who) => `${who} says hi`,
    plan: async () => ({ plan: { summary: 's', assignments: [
      { id: 't1', ownerId: 'a', title: 'one', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
      { id: 't2', ownerId: 'b', title: 'two', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
      { id: 't3', ownerId: 'c', title: 'three', brief: 'b', dependsOn: ['t1', 't2'], files: [], status: 'waiting' },
      { id: 't4', ownerId: 'd', title: 'four', brief: 'b', dependsOn: [], files: [], status: 'waiting' },
      { id: 't5', ownerId: 'a', title: 'five', brief: 'b', dependsOn: [], files: [], status: 'waiting' }] } }),
    work: (team, a, started) => new Promise((resolve) => { log.push(a.id); started(`conv-${a.id}`); runs.set(a.id, resolve); }),
    stopWork: (conversationId) => { stopped.push(conversationId); const id = conversationId.slice(5); runs.get(id)?.({ outcome: 'stopped', answer: '', error: 'Stopped' }); },
    report: async () => 'All done.',
    ...overrides
  });
  const team = runner.create({ leadId: 'chief-of-staff', conversationId: 'lead', goal: 'g', attendees: ['a', 'b', 'c', 'd'], providerId: 'p', modelId: 'm' });
  return { runner, team, teams, log, runs, stopped };
}

test('a meeting collects everyone\'s input, then the plan waits for you', async () => {
  const { runner, team } = rig();
  assert.equal(team.status, 'meeting');
  await runner.meet(team.id);
  assert.deepEqual(team.minutes.map((m) => m.text), ['a says hi', 'b says hi', 'c says hi', 'd says hi']);
  assert.equal(team.status, 'planned');
  assert.equal(team.plan.assignments.length, 5);
});

test('one attendee failing leaves an error minute; everyone failing fails the team', async () => {
  const some = rig({ contribute: async (_t, who) => { if (who === 'b') throw new Error('timeout'); return 'ok'; } });
  await some.runner.meet(some.team.id);
  assert.equal(some.team.minutes.find((m) => m.coworkerId === 'b').error, 'timeout');
  assert.equal(some.team.status, 'planned');
  const none = rig({ contribute: async () => { throw new Error('no key'); } });
  await none.runner.meet(none.team.id);
  assert.equal(none.team.status, 'failed');
  assert.match(none.team.note, /no key/);
});

test('a plan that never holds together fails the team with the reasons', async () => {
  const { runner, team } = rig({ plan: async () => ({ errors: ['t1: "X" is not in this meeting.'] }) });
  await runner.meet(team.id);
  assert.equal(team.status, 'failed');
  assert.match(team.note, /not in this meeting/);
});

test('Start runs at most three at once, in dependency order, and reports when all are done', async () => {
  const { runner, team, log, runs } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  assert.deepEqual(log, ['t1', 't2', 't4'], 'three independent tasks first');
  assert.equal(team.status, 'working');
  runs.get('t1')({ outcome: 'done', answer: 'one done' });
  await tick();
  assert.deepEqual(log, ['t1', 't2', 't4', 't5'], 't3 still waits for t2; t5 takes the free slot');
  runs.get('t2')({ outcome: 'done', answer: 'two done' });
  await tick();
  assert.deepEqual(log.slice(-1), ['t3']);
  for (const id of ['t3', 't4', 't5']) runs.get(id)({ outcome: 'done', answer: `${id} done` });
  await runner.idle(team.id);
  assert.equal(team.status, 'done');
  assert.equal(team.report, 'All done.');
  assert.equal(team.plan.assignments[0].result, 'one done');
  assert.equal(team.plan.assignments[0].conversationId, 'conv-t1');
});

test('a failed task blocks only its dependants; the team then needs a Retry', async () => {
  const { runner, team, log, runs } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  runs.get('t1')({ outcome: 'failed', answer: '', error: 'boom' });
  for (const id of ['t2', 't4']) runs.get(id)({ outcome: 'done', answer: 'ok' });
  await tick();
  runs.get('t5')({ outcome: 'done', answer: 'ok' });
  await runner.idle(team.id);
  const status = Object.fromEntries(team.plan.assignments.map((a) => [a.id, a.status]));
  assert.deepEqual(status, { t1: 'failed', t2: 'done', t3: 'blocked', t4: 'done', t5: 'done' });
  assert.equal(team.status, 'failed');
  runner.retry(team.id);
  await tick();
  assert.equal(team.status, 'working');
  assert.deepEqual(log.slice(-1), ['t1'], 'the failed task runs again; t3 waits for it');
  runs.get('t1')({ outcome: 'done', answer: 'fixed' });
  await tick();
  runs.get('t3')({ outcome: 'done', answer: 'ok' });
  await runner.idle(team.id);
  assert.equal(team.status, 'done');
});

test('Stop team stops everyone running and everyone waiting; Discard drops a plan', async () => {
  const { runner, team, stopped } = rig();
  await runner.meet(team.id);
  runner.start(team.id);
  await tick();
  runner.stop(team.id);
  await runner.idle(team.id);
  assert.equal(team.status, 'stopped');
  assert.deepEqual(stopped.sort(), ['conv-t1', 'conv-t2', 'conv-t4']);
  assert.ok(team.plan.assignments.every((a) => a.status === 'stopped' || a.status === 'blocked'));
  const other = rig();
  await other.runner.meet(other.team.id);
  other.runner.discard(other.team.id);
  assert.equal(other.team.status, 'discarded');
  assert.throws(() => other.runner.start(other.team.id), /not waiting/);
});

test('Stop during the meeting ends it without a plan; Retry meets again', async () => {
  let release;
  const { runner, team } = rig({ contribute: (_t, who, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('stopped')));
    if (who === 'a') release = resolve;
  }) });
  const meeting = runner.meet(team.id);
  await tick();
  runner.stop(team.id);
  await meeting;
  assert.equal(team.status, 'stopped');
  assert.equal(team.plan, undefined);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `src/main/team/runner.ts`:

```ts
import type { Team, TeamAssignment, TeamPlan } from '../../shared/types';
import { MAX_PARALLEL, OPEN_TEAM, RESULT_LIMIT, blockDependants, progress, readyAssignments, resetForRetry } from './plan';

/** Attendees answering at once. */
const MEETING_PARALLEL = 4;

export interface WorkOutcome { outcome: 'done' | 'failed' | 'stopped'; answer: string; error?: string }
export interface TeamRunnerDeps { /* as in Interfaces */ }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs teams: the meeting, the plan waiting for you, the work in dependency order, and the report. */
export class TeamRunner {
  private readonly meetings = new Map<string, AbortController>();
  private readonly running = new Map<string, Set<string>>();
  private readonly busy = new Map<string, Set<Promise<unknown>>>();
  constructor(private readonly deps: TeamRunnerDeps) {}

  private now(): number { return (this.deps.now ?? Date.now)(); }
  private get(id: string): Team {
    const team = this.deps.teams().find((t) => t.id === id);
    if (!team) throw new Error('Team not found.');
    return team;
  }
  private touch(team: Team): void { team.updatedAt = this.now(); this.deps.changed(); }
  private track<T>(teamId: string, promise: Promise<T>): Promise<T> {
    const set = this.busy.get(teamId) ?? new Set();
    this.busy.set(teamId, set);
    set.add(promise);
    void promise.finally(() => set.delete(promise));
    return promise;
  }
  async idle(teamId: string): Promise<void> {
    while (this.busy.get(teamId)?.size) await Promise.allSettled([...this.busy.get(teamId)!]);
  }

  create(input: { leadId: string; conversationId: string; goal: string; attendees: string[]; providerId: string; modelId: string }): Team {
    const now = this.now();
    const team: Team = { id: this.deps.id(), ...input, status: 'meeting', minutes: [], createdAt: now, updatedAt: now };
    this.deps.teams().push(team);
    this.touch(team);
    return team;
  }

  meet(teamId: string): Promise<void> { return this.track(teamId, this.runMeeting(teamId)); }

  private async runMeeting(teamId: string): Promise<void> {
    const team = this.get(teamId);
    const controller = new AbortController();
    this.meetings.set(teamId, controller);
    const signal = controller.signal;
    try {
      const queue = [...team.attendees];
      const worker = async () => {
        for (let who = queue.shift(); who !== undefined && !signal.aborted; who = queue.shift()) {
          try {
            team.minutes.push({ coworkerId: who, text: (await this.deps.contribute(team, who, signal)).trim(), at: this.now() });
          } catch (error) {
            if (signal.aborted) return;
            team.minutes.push({ coworkerId: who, text: '', at: this.now(), error: message(error) });
          }
          this.touch(team);
        }
      };
      await Promise.all(Array.from({ length: Math.min(MEETING_PARALLEL, queue.length) }, worker));
      if (signal.aborted) return;
      // Minutes in the order people sit, whoever finished first.
      team.minutes.sort((a, b) => team.attendees.indexOf(a.coworkerId) - team.attendees.indexOf(b.coworkerId));
      if (!team.minutes.some((m) => !m.error)) return this.fail(team, `Nobody in the meeting could answer: ${team.minutes[0]?.error ?? 'no answer'}`);
      const drafted = await this.deps.plan(team, signal);
      if (signal.aborted) return;
      if ('errors' in drafted) return this.fail(team, `The plan did not hold together: ${drafted.errors.join(' ')}`);
      team.plan = drafted.plan;
      team.status = 'planned';
      this.touch(team);
    } catch (error) {
      if (!signal.aborted) this.fail(team, message(error));
    } finally {
      this.meetings.delete(teamId);
    }
  }

  private fail(team: Team, note: string): void {
    team.status = 'failed';
    team.note = note;
    this.touch(team);
  }

  start(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'planned' || !team.plan) throw new Error('That team is not waiting for a start.');
    team.status = 'working';
    team.note = undefined;
    this.touch(team);
    this.schedule(team);
  }

  private schedule(team: Team): void {
    if (team.status !== 'working' || !team.plan) return;
    const assignments = team.plan.assignments;
    blockDependants(assignments);
    const running = this.running.get(team.id) ?? new Set<string>();
    this.running.set(team.id, running);
    for (const a of readyAssignments(assignments)) {
      if (running.size >= MAX_PARALLEL) break;
      running.add(a.id);
      a.status = 'working';
      a.note = undefined;
      void this.track(team.id, this.runAssignment(team, a, running));
    }
    this.touch(team);
    if (running.size) return;
    const where = progress(assignments);
    if (where === 'done') void this.track(team.id, this.finish(team));
    else if (where === 'stuck') this.fail(team, 'Some tasks failed or were stopped. Retry to carry on.');
  }

  private async runAssignment(team: Team, a: TeamAssignment, running: Set<string>): Promise<void> {
    try {
      const ended = await this.deps.work(team, a, (conversationId) => {
        a.conversationId = conversationId;
        this.touch(team);
        // Stopped while their conversation was being set up.
        if (team.status !== 'working') this.deps.stopWork(conversationId);
      });
      a.status = ended.outcome;
      a.result = ended.answer.trim().slice(0, RESULT_LIMIT) || undefined;
      a.note = ended.error;
    } catch (error) {
      a.status = 'failed';
      a.note = message(error);
    } finally {
      running.delete(a.id);
      this.touch(team);
      this.schedule(team);
    }
  }

  private async finish(team: Team): Promise<void> {
    team.status = 'reporting';
    this.touch(team);
    const controller = new AbortController();
    this.meetings.set(team.id, controller);
    try {
      team.report = await this.deps.report(team, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      team.note = `The report could not be written: ${message(error)}`;
    } finally {
      this.meetings.delete(team.id);
    }
    if (team.status !== 'reporting') return;
    team.status = 'done';
    this.touch(team);
    this.deps.finished?.(team);
  }

  stop(teamId: string): void {
    const team = this.get(teamId);
    if (!OPEN_TEAM.has(team.status)) return;
    this.meetings.get(teamId)?.abort();
    team.status = 'stopped';
    team.note = 'Stopped by you.';
    for (const a of team.plan?.assignments ?? []) {
      if (a.status === 'working' && a.conversationId) this.deps.stopWork(a.conversationId);
      else if (a.status === 'waiting') Object.assign(a, { status: 'stopped', note: 'The team was stopped' });
    }
    this.touch(team);
  }

  discard(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'planned') throw new Error('Only a plan waiting for you can be discarded.');
    team.status = 'discarded';
    this.touch(team);
  }

  retry(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'failed' && team.status !== 'stopped') throw new Error('Only a failed or stopped team can be retried.');
    team.note = undefined;
    if (!team.plan) {
      team.status = 'meeting';
      team.minutes = [];
      this.touch(team);
      void this.meet(teamId);
      return;
    }
    resetForRetry(team.plan.assignments);
    team.status = 'working';
    this.touch(team);
    this.schedule(team);
  }
}
```

- [ ] **Step 4:** Run `node --test tests/team-runner.test.cjs` → PASS (adjust only the code, never the expected behaviour).

### Task 5: Wire teams into the service

**Files:**
- Modify: `src/main/officeTools.ts`, `src/main/security/permissions.ts`, `src/main/service.ts`, `src/main/index.ts`, `src/preload/index.ts`
- Test: `tests/team-service.test.cjs`

**Interfaces:**
- Consumes: everything above.
- Produces: `Service.teams: TeamRunner`; IPC `teamStart/teamStop/teamDiscard/teamRetry`; `chatSend(id, input, attachmentIds, options?: { from?: string })`.

- [ ] **Step 1: Failing test** `tests/team-service.test.cjs` (setup like `tests/agent-run.test.cjs`; a mock `streamChat` that routes by the request):

```js
/** The model, by what it is asked: the lead, an attendee, the plan, an owner, or the report. */
function teamModel(t, { plan }) {
  const asked = [];
  mockModel(t, async (n, req, onChunk) => {
    const system = req.system ?? '';
    const last = req.messages.at(-1);
    asked.push({ system, last: last?.content, tools: req.tools?.map((x) => x.name) ?? [] });
    if (req.tools?.some((x) => x.name === 'propose_plan')) return { toolCalls: [{ id: `plan${n}`, name: 'propose_plan', arguments: JSON.stringify(plan) }] };
    if (system.includes('has called a team meeting')) { onChunk('My input.'); return { toolCalls: [] }; }
    if (system.includes('Your team has finished')) { onChunk('Report: done.'); return { toolCalls: [] }; }
    if (req.tools?.some((x) => x.name === 'call_team_meeting') && last?.role === 'user')
      return { toolCalls: [{ id: 'call1', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'Add password reset', attendees: ['Backend Developer', 'Frontend Developer'] }) }] };
    if (typeof last?.content === 'string' && last.content.startsWith('Team goal:')) { onChunk(`Done: ${last.content.match(/Your task \((t\d)\)/)[1]}`); return { toolCalls: [] }; }
    onChunk('I gathered the team.');
    return { toolCalls: [] };
  });
  return asked;
}
const PLAN = { summary: 'API then form', assignments: [
  { id: 't1', owner: 'Backend Developer', title: 'API', brief: 'Build the API', files: ['src/api.ts'] },
  { id: 't2', owner: 'Frontend Developer', title: 'Form', brief: 'Build the form', depends_on: ['t1'], files: ['src/form.tsx'] }] };

test('the Chief of Staff calls a meeting; the plan waits; Start runs the tasks in order; the report comes back', async (t) => {
  const { service, repo, events } = await setup(t);
  const lead = await service.chatCreate('p1', 'm1', null, 'chief-of-staff', { skillIds: [], roleIds: [] }, null, "You are Axon's Chief of Staff.");
  const asked = teamModel(t, { plan: PLAN });
  await service.chatSend(lead.id, 'Add a password reset flow', []);
  const team = await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  assert.deepEqual(team.attendees, ['backend-developer', 'frontend-developer']);
  assert.equal(team.minutes.length, 2);
  assert.ok(events.some((e) => e.channel === 'teams'));
  assert.ok(asked.some((a) => a.tools.includes('find_people') && a.tools.includes('call_team_meeting')), 'the lead has the team tools');
  await service.teamStart(team.id);
  await waitFor(() => team.status === 'done', 'the team to finish');
  const [api, form] = team.plan.assignments;
  assert.equal(api.result, 'Done: t1');
  assert.equal(form.result, 'Done: t2');
  const formBrief = repo.state.messages.find((m) => m.conversationId === form.conversationId && m.role === 'user');
  assert.match(formBrief.content, /Done: t1/, 'the form task got the API hand-off');
  assert.equal(formBrief.from, 'Chief of Staff');
  assert.equal(repo.state.conversations.find((c) => c.id === form.conversationId).agentId, 'frontend-developer');
  assert.equal(team.report, 'Report: done.');
});

test('a coworker who is not a lead has no team tools; a vague attendee is refused', async (t) => {
  const { service, repo } = await setup(t);
  const asked = teamModel(t, { plan: PLAN });
  const dev = await service.chatCreate('p1', 'm1', null, 'backend-developer', { skillIds: [], roleIds: [] }, null, 'You are a dev.');
  await service.chatSend(dev.id, 'Hi', []);
  assert.ok(!asked.at(-1).tools.includes('call_team_meeting'));
  // Vague names: no team starts.
  const lead = await service.chatCreate('p1', 'm1', null, 'chief-of-staff', { skillIds: [], roleIds: [] }, null, 'CoS');
  mockModel(t, async (n) => (n === 1 ? { toolCalls: [{ id: 'c', name: 'call_team_meeting', arguments: JSON.stringify({ goal: 'g', attendees: ['engineer', 'designer'] }) }] } : { toolCalls: [] }));
  await service.chatSend(lead.id, 'Do it', []);
  assert.equal(repo.state.teams.length, 0);
  assert.match(repo.state.messages.find((m) => m.role === 'tool' && m.conversationId === lead.id).content, /engineer/);
});

test('Stop team stops the owners mid-run; a restart loads an open team as stopped', async (t) => {
  const { service, repo } = await setup(t);
  const lead = await service.chatCreate('p1', 'm1', null, 'chief-of-staff', { skillIds: [], roleIds: [] }, null, 'CoS');
  teamModel(t, { plan: { summary: 's', assignments: [PLAN.assignments[0]] } });
  await service.chatSend(lead.id, 'Go', []);
  const team = await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  // The owner's run hangs until stopped.
  mockModel(t, async (_n, req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('Generation stopped.')))));
  await service.teamStart(team.id);
  await waitFor(() => team.plan.assignments[0].conversationId && service.runs.has(team.plan.assignments[0].conversationId), 'the owner to start');
  await service.teamStop(team.id);
  await waitFor(() => team.plan.assignments[0].status === 'stopped', 'the owner to stop');
  assert.equal(team.status, 'stopped');
  const { interruptTeams } = require('../src/main/team/plan.ts');
  const reloaded = [{ ...team, status: 'working', plan: { ...team.plan, assignments: [{ ...team.plan.assignments[0], status: 'working' }] } }];
  assert.equal(interruptTeams(reloaded, 1), true);
});

test('a lead remembers their teams in their next conversation turn', async (t) => {
  const { service, repo } = await setup(t);
  const lead = await service.chatCreate('p1', 'm1', null, 'chief-of-staff', { skillIds: [], roleIds: [] }, null, 'CoS');
  const asked = teamModel(t, { plan: PLAN });
  await service.chatSend(lead.id, 'Add a password reset flow', []);
  await waitFor(() => repo.state.teams.find((x) => x.status === 'planned'), 'the plan');
  await service.chatSend(lead.id, 'How is it going?', []);
  assert.match(asked.at(-1).system, /## Your teams[\s\S]*Add password reset — planned/);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Tools for leads** — `officeTools.ts`: `import { TEAM_LEADS, TEAM_TOOLS } from './team/tools';` and in `toolsFor` after the receptionist line: `if (input.agentId && TEAM_LEADS.has(input.agentId)) tools.push(...TEAM_TOOLS);`. `permissions.ts`: `import { TEAM_TOOL_NAMES } from '../team/tools';` and after the planner line: `// Finding people and calling a meeting only read; the plan waits for you before anything is done. if (TEAM_TOOL_NAMES.has(toolName)) return { action: 'allow' };`.
- [ ] **Step 4: Service wiring** (`service.ts`):
  - Fields: `readonly teams: TeamRunner;` built in the constructor after `this.tasks`/`tracker`:

```ts
    this.teams = new TeamRunner({
      teams: () => this.state.teams,
      id: () => this.repo.id(),
      changed: () => { this.emit({ channel: 'teams', teams: this.state.teams }); void this.repo.save(); },
      contribute: (team, attendeeId, signal) => this.teamContribution(team, attendeeId, signal),
      plan: (team, signal) => draftPlan(team, this.teamModel(team, signal)),
      work: (team, assignment, started) => this.teamWork(team, assignment, started),
      stopWork: (conversationId) => this.chatStop(conversationId),
      report: (team, signal) => writeReport(team, this.teamModel(team, signal)),
      finished: (team) => {
        const lead = coworkerById(team.leadId);
        if (lead && this.shell && !this.shell.windowVisible())
          this.shell.notify({ title: `${lead.name}: the team is done`, body: team.goal.slice(0, 120), target: { agentId: lead.id, conversationId: team.conversationId } });
      }
    });
    if (interruptTeams(this.state.teams, Date.now())) void this.repo.save();
```

  - Helpers:

```ts
  /** The lead's model, as the whole team uses it. */
  private teamModel(team: Team, signal?: AbortSignal): ModelCall {
    const provider = this.state.providers.find((p) => p.id === team.providerId && p.enabled);
    if (!provider) throw new Error("The lead's model is not available any more.");
    return { stream: streamChat, provider, key: this.providerKey(provider.id), modelId: team.modelId, maxTokens: outputLimit(team.modelId, this.state.settings.defaultMaxTokens), signal };
  }
  /** Read-only lookups for a colleague or attendee, checked and recorded on behalf of whoever they help. */
  private lookups(helper: AuditActor, conversationId: string, scope: PermissionScope, coworker: Coworker) { /* the tools/execute/refused that askColleague builds today, moved here and reused by askColleague */ }
  private async teamContribution(team: Team, attendeeId: string, signal: AbortSignal): Promise<string> {
    const attendee = coworkerById(attendeeId), lead = coworkerById(team.leadId);
    if (!attendee) throw new Error('Unknown attendee.');
    const leadChat = this.state.conversations.find((c) => c.id === team.conversationId);
    const roots = runRoots({ agentId: attendeeId, conversationRoot: leadChat?.projectRoot, projectRoot: this.project.root });
    const model = this.teamModel(team, signal);
    const helper: AuditActor = { kind: 'colleague', id: attendee.id, name: attendee.name, onBehalfOf: lead?.name };
    return consult(model.provider, model.key, model.modelId, attendee, lead?.name ?? 'The lead', MEETING_ASK, {
      ...this.lookups(helper, team.conversationId, { roots, allowShell: false }, attendee),
      stream: streamChat, signal, maxTokens: model.maxTokens, system: meetingSystemPrompt(attendee, team)
    });
  }
  private async teamWork(team: Team, assignment: TeamAssignment, started: (conversationId: string) => void): Promise<WorkOutcome> {
    const owner = coworkerById(assignment.ownerId), lead = coworkerById(team.leadId);
    if (!owner) throw new Error('Unknown owner.');
    const leadChat = this.state.conversations.find((c) => c.id === team.conversationId);
    const chat = await this.chatCreate(team.providerId, team.modelId, null, owner.id, { skillIds: [], roleIds: owner.roleIds }, leadChat?.projectRoot ?? null, owner.systemPrompt);
    chat.title = assignment.title.slice(0, 65);
    const run = this.chatSend(chat.id, taskBrief(team, assignment), [], { from: lead?.name });
    started(chat.id);
    await run;
    const last = [...this.state.messages].reverse().find((m) => m.conversationId === chat.id && m.role === 'assistant');
    if (last?.error === 'Generation stopped.') return { outcome: 'stopped', answer: last.content, error: 'Stopped' };
    if (last?.error) return { outcome: 'failed', answer: last.content, error: last.error };
    return { outcome: 'done', answer: last?.content ?? '' };
  }
  /** A lead's team tools: finding people, and calling the meeting (which carries on in the background). */
  private teamTool(chat: Conversation, name: string, args: Record<string, unknown>): { content: string; isError?: boolean } {
    if (name === FIND_PEOPLE.name) return { content: findPeople(String(args.need ?? ''), chat.agentId ?? '') };
    const goal = String(args.goal ?? '').trim();
    if (!goal) return { content: 'Say what the team is to achieve.', isError: true };
    const open = this.state.teams.find((t) => t.conversationId === chat.id && OPEN_TEAM.has(t.status));
    if (open) return { content: `A team is already ${open.status} on "${open.goal}". Wait for it, or ask the user to stop it.`, isError: true };
    const people = resolveAttendees(args.attendees, chat.agentId ?? '');
    if ('error' in people) return { content: people.error, isError: true };
    const team = this.teams.create({ leadId: chat.agentId!, conversationId: chat.id, goal, attendees: people.ids, providerId: chat.providerId, modelId: chat.modelId });
    void this.teams.meet(team.id);
    return { content: JSON.stringify({ team: team.id, attendees: people.ids.map((id) => coworkerById(id)?.name ?? id),
      note: 'The meeting has started. The plan will appear in this conversation for the user to approve. Tell the user in one or two sentences who you gathered and why; do not plan the work yourself.' }) };
  }
  async teamStart(id: string): Promise<void> { this.teams.start(text(id, 100)); }
  async teamStop(id: string): Promise<void> { this.teams.stop(text(id, 100)); }
  async teamDiscard(id: string): Promise<void> { this.teams.discard(text(id, 100)); }
  async teamRetry(id: string): Promise<void> { this.teams.retry(text(id, 100)); }
```

  - In the `chatSend` tool loop, after the receptionist's planner block:

```ts
          // A lead's team tools: answered here, never by the tool registry.
          if (TEAM_TOOL_NAMES.has(tc.name) && TEAM_LEADS.has(chat.agentId ?? '')) {
            if (this.permissions.check({ toolName: tc.name, args: parsedArgs }, scope).action === 'allow')
              answer(tc, this.teamTool(chat, tc.name, parsedArgs), 'allowed');
            else answer(tc, { content: 'Tool execution denied by security policy.', isError: true }, 'denied');
            continue;
          }
```

  - `chatSend(id, input, attachmentIds, options: { from?: string } = {})`; the user message gets `...(options.from ? { from: text(options.from, 80) } : {})`.
  - `runContext`: add `TEAM_LEADS.has(chat.agentId ?? '') ? teamsBlock(this.state.teams.filter((t) => t.leadId === chat.agentId && t.status !== 'discarded').slice(-3).reverse()) : ''` to `system` before the connector notes.
  - `askColleague`: after resolving the colleague, `const shared = this.state.teams.find((t) => t.plan?.assignments.some((a) => a.conversationId === chat.id));` and `const context = shared ? teammateContext(shared, colleague.id) : '';` then pass `context ? \`${context}\n\n${question}\` : question` to `consult`.
  - `stopAll`/`shutdown`: `for (const t of this.state.teams) if (OPEN_TEAM.has(t.status) && t.status !== 'planned') this.teams.stop(t.id);` before aborting runs.
- [ ] **Step 5: IPC** — `index.ts` methods list and `preload/index.ts`: add `'teamStart', 'teamStop', 'teamDiscard', 'teamRetry'` / `teamStart: invoke('teamStart'), …`.
- [ ] **Step 6:** Run `node --test tests/team-service.test.cjs` → PASS; then `npx tsc --noEmit` and `npm test` → all PASS.

### Task 6: The plan card in the window

**Files:**
- Create: `src/renderer/src/features/office/team.ts`, `src/renderer/src/features/office/activity/TeamCard.tsx`, `src/renderer/src/features/office/activity/team.css`
- Modify: `Conversation.tsx`, `src/renderer/src/chat/MessageView.tsx`, `src/renderer/src/App.tsx`
- Test: `tests/office-team.test.cjs`; desktop check `tests/team-desktop.cjs`

**Interfaces:**
- Produces (pure, `team.ts`): `teamOfCall(call: ToolCall, teams: Team[]): Team | undefined`; `TEAM_WORDS: Record<TeamStatus, string>`; `TASK_WORDS: Record<AssignmentStatus, string>`; `openMeetings(teams: Team[]): { id: string; leadId: string; attendees: string[] }[]` (teams `meeting` or `reporting`).

- [ ] **Step 1: Failing test** `tests/office-team.test.cjs`:

```js
const team = require('../src/renderer/src/features/office/team.ts');
const teams = [
  { id: 'a', status: 'meeting', leadId: 'chief-of-staff', attendees: ['x', 'y'] },
  { id: 'b', status: 'working', leadId: 'chief-of-staff', attendees: ['z'] },
  { id: 'c', status: 'reporting', leadId: 'ops-coordinator', attendees: ['w'] }
];
test('a call_team_meeting call finds its team by the id in its result', () => {
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', result: JSON.stringify({ team: 'b' }) }, teams).id, 'b');
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', error: 'nope' }, teams), undefined);
  assert.equal(team.teamOfCall({ name: 'call_team_meeting', result: 'not json' }, teams), undefined);
});
test('people sit in the boardroom while their team meets and for the wrap-up', () => {
  assert.deepEqual(team.openMeetings(teams).map((m) => m.id), ['a', 'c']);
});
test('every status has words', () => {
  for (const s of ['meeting', 'planned', 'working', 'reporting', 'done', 'stopped', 'failed', 'discarded']) assert.ok(team.TEAM_WORDS[s]);
  for (const s of ['waiting', 'working', 'done', 'failed', 'stopped', 'blocked']) assert.ok(team.TASK_WORDS[s]);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement `team.ts`:

```ts
import type { AssignmentStatus, Team, TeamStatus, ToolCall } from '../../../../shared/types';

export const TEAM_WORDS: Record<TeamStatus, string> = {
  meeting: 'In the meeting', planned: 'Plan ready for you', working: 'Working', reporting: 'Writing the report',
  done: 'Done', stopped: 'Stopped', failed: 'Needs a look', discarded: 'Discarded'
};
export const TASK_WORDS: Record<AssignmentStatus, string> = {
  waiting: 'Waiting', working: 'Working', done: 'Done', failed: 'Failed', stopped: 'Stopped', blocked: 'Blocked'
};
/** The team a call_team_meeting call started: its id is in the call's result. */
export function teamOfCall(call: Pick<ToolCall, 'result'>, teams: readonly Team[]): Team | undefined {
  try {
    const id = JSON.parse(call.result ?? '')?.team;
    return teams.find((t) => t.id === id);
  } catch {
    return undefined;
  }
}
/** Teams whose people should be in the boardroom: meeting, or gathered for the wrap-up. */
export function openMeetings(teams: readonly Team[]): { id: string; leadId: string; attendees: string[] }[] {
  return teams.filter((t) => t.status === 'meeting' || t.status === 'reporting').map(({ id, leadId, attendees }) => ({ id, leadId, attendees }));
}
```

- [ ] **Step 4: `TeamCard.tsx`** — reads `useApp((s) => s.data?.teams)`, finds `teamOfCall(call, teams)`; renders: header (people icon, "Team meeting", status chip from `TEAM_WORDS`); goal; attendee row of `AgentPortrait`s with names; `<details>` "What each person said (n)" with each minute (name + Markdown text, or its error); when a plan exists: summary and an ordered list of tasks — owner portrait and name, title, "after t1, t2", files as `<code>`, status chip from `TASK_WORDS` with tone classes, the note, and an "Open chat" button when it has a conversation (`useOfficeStore.getState().selectAgent(ownerId)`, `setAgentConversation(ownerId, conversationId)`, `setPanelTab('chat')`); actions: planned → **Start** (primary) and **Discard**; meeting/working/reporting → **Stop team**; failed/stopped → **Retry**; done → the report (Markdown); the team note when present. Buttons call `window.axon.teamStart(id)` etc. and put errors in `patch({ error })`. While the call is pending (no result yet) show "Gathering the team…".
- [ ] **Step 5:** `Conversation.tsx`: `call.name === 'call_team_meeting' ? <TeamCard call={call} /> : …` beside `ColleagueCard`. `MessageView.tsx`: `{m.role === 'user' ? (m.from ?? 'You') : authorName}`. `App.tsx`: before the chat branch, `if (event.channel === 'teams') { const current = useApp.getState().data; if (current) useApp.getState().patch({ data: { ...current, teams: event.teams } }); return; }`.
- [ ] **Step 6: Styles** in `team.css` (imported by `TeamCard.tsx`): card like `.colleague-card`; status chips use `--office-blue` (working), green (done), amber (waiting for you), red (failed); light and dark via existing tokens.
- [ ] **Step 7:** Run `node --test tests/office-team.test.cjs` → PASS; `npx tsc --noEmit`.
- [ ] **Step 8: Desktop check** `tests/team-desktop.cjs` (pattern of `tests/composer-stop.cjs`): a mock model that answers like `teamModel` above; select Chief of Staff; send "Add a password reset flow"; wait for `.team-card` with "Plan ready for you"; screenshot `1-plan.png`; click Start; wait for "Done"; screenshot `2-done.png`; assert both owners' conversations exist and the brief shows "Chief of Staff" as its sender. Build with `npx electron-vite build`, run `npx electron tests/team-desktop.cjs` → `TEAM_CHECK_PASS`.

### Task 7: The boardroom

**Files:** Modify `src/renderer/src/features/office/campus/commons.ts`, `src/renderer/src/features/office/simulation/types.ts` (group), `simulation/agentProfiles.ts` (initial spots), `OfficeSimulation.ts` (ambient venue weights); Test `tests/office-campus.test.cjs` (new test).

**Interfaces:** Produces POIs `boardroom-head` and `boardroom-n1..n6`, `boardroom-s1..s6` (group `'boardroom'`, type `'meeting'`, zone `'workspaces'`), spot `boardroom-wb`; constant `BOARDROOM_SEATS` (head first) exported from `commons.ts`.

- [ ] **Step 1: Failing test** (append to `tests/office-campus.test.cjs`, using its existing layout helpers):

```js
test('the boardroom seats twelve and the lead at the head, every seat reachable', () => {
  const seats = layout.pois.filter((p) => p.group === 'boardroom');
  assert.equal(seats.length, 13);
  assert.ok(layout.poiById('boardroom-head'));
  for (const seat of seats) assert.ok(layout.findPath(layout.poiById('desk-chief').approach, seat.approach ?? seat.position), `${seat.id} reachable`);
});
```

(use the file's actual helper names for the layout and path finder; read the top of `tests/office-campus.test.cjs` first).

- [ ] **Step 2:** Run → FAIL. **Step 3:** replace `buildCollaboration` with `buildBoardroom`: glass walls `boardroom-n` (z −4.0, x −19.4…−7.2), `boardroom-s` (z 4.2) and `boardroom-e` (x −7.2) with a 1.6 m door at z 0.1 on the east wall; rug (−13.3, 0.1, 11.6 × 7.6); `meeting-table` (−13.3, 0.1, 7.2 × 1.6); six seats per side at x = −16.25 + 1.2·i, north side z −0.95 facing `FACE_FRONT` (approach z −1.55), south side z 1.15 facing `FACE_BACK` (approach z 1.75), all `meeting-chair`, group `'boardroom'`; `boardroom-head` at (−17.6, 0.1) facing `FACE_RIGHT`, approach (−18.25, 0.1); `wall-screen` (−13.3, −3.95, 3.0 × 0.05, `blocks: false`); `whiteboard` item id `boardroom-whiteboard` (−9.0, −3.85, 1.6 × 0.1) with spot `boardroom-wb` (−9.0, −3.25, `FACE_BACK`); two plants. Export `BOARDROOM_SEATS = ['boardroom-head', ...north, ...south]`. Update `types.ts` group union (`'boardroom'` replaces `'collab-table'`), the ambient venue weights (`boardroom: 30`), and `agentProfiles.ts` initial spots (`collab-wb-1` → `boardroom-wb`, `collab-e` → `boardroom-s1`).
- [ ] **Step 4:** Run `node --test tests/office-campus.test.cjs tests/office-sim.test.cjs` → PASS (the thirty-minute and many-seeds tests prove nobody walks through the new walls).

### Task 8: Meetings in the office

**Files:** Modify `OfficeSimulation.ts`, `scene/OfficeScene.ts`, `OfficeCanvas.tsx`; Test `tests/office-sim.test.cjs` (new test)

**Interfaces:**
- Produces: `OfficeSimulation.startTeamMeeting(key: string, leadId: string, attendeeIds: string[]): number` (how many were seated), `endTeamMeeting(key: string): void`; the same on `OfficeScene`; `OfficeCanvas` syncs `openMeetings(teams)`.

- [ ] **Step 1: Failing test:**

```js
test('a team meeting seats the lead at the head of the boardroom and the team round the table, then sends them back', () => {
  const ids = ['chief-of-staff', 'research-analyst', 'designer', 'product-coach'];
  const office = new OfficeSimulation({ agentIds: ids, seed: 5 });
  office.step(1 / 60);
  assert.equal(office.startTeamMeeting('team1', 'chief-of-staff', ids.slice(1)), 4);
  runUntil(office, (o) => ids.every((id) => o.view(id).sit === 1 && layout.poiById(o.view(id).poiId)?.group === 'boardroom'), 180, 0.05);
  assert.equal(office.view('chief-of-staff').poiId, 'boardroom-head');
  for (const id of ids) assert.equal(layout.poiById(office.view(id).poiId).group, 'boardroom', id);
  run(office, 20, 0.1);
  assert.ok(ids.some((id) => office.view(id).behavior === 'talking'), 'someone speaks');
  office.endTeamMeeting('team1');
  runUntil(office, (o) => ids.every((id) => o.view(id).poiId === layout.HOME_DESKS[id] && o.view(id).sit === 1), 180, 0.05);
  for (const id of ids) assert.equal(office.view(id).poiId, layout.HOME_DESKS[id]);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement in `OfficeSimulation`: a `teamMeetings: Map<string, Meeting>`; `startTeamMeeting` — refuse with reduced motion (return 0); end any ambient meeting those people are in; for each person present (lead first, then attendees, in `BOARDROOM_SEATS` order, skipping seats without room) cancel their plan, set `meetingId` to the meeting's id, reserve the seat, and give them the `meeting` plan (leave, carry prop, goto seat, `doing('meeting', null)`); `endTeamMeeting` — everyone with that `meetingId` gets `meetingId = null` and `deskPlan`. Speakers rotate with the ambient meeting's logic, run for each team meeting in `updateMeeting` (extract the speaker rotation into `rotateSpeaker(meeting)` and call it for both). `availableForMeeting` and ambient `startMeeting` ignore people in a team meeting. `OfficeScene.startTeamMeeting/endTeamMeeting` pass through. `OfficeCanvas`: a `meetings` ref like `helping`, synced from `openMeetings(useApp.getState().data?.teams ?? [])` wherever `syncHelp` runs and when `data.teams` changes.
- [ ] **Step 4:** Run `node --test tests/office-sim.test.cjs` → PASS.

### Task 8b: The boardroom board shows the team

**Files:** Modify `src/renderer/src/features/office/campus/boards.ts`, `src/renderer/src/features/office/scene/room/boards.ts`, `src/renderer/src/features/office/team.ts`, `OfficeCanvas.tsx`/`OfficeScene.ts`; Test `tests/office-team.test.cjs`, `tests/office-boards.test.cjs`.

**Interfaces:** Produces `teamBoardCards(teams: Team[]): TaskItem[]` (in `team.ts`): the newest open team's tasks as cards — `title` "Owner: task title", `status` from the task (`working` → `working`, `done` → `done`, `failed`/`blocked`/`stopped` → `attention`, `waiting` → `open`), first the goal as a card when there is no plan yet; `TaskBoard.kind` gains `'meeting'`; `BoardLayer.setMeeting(cards: TaskItem[])`; `OfficeScene.setMeeting(cards)`.

- [ ] **Step 1: Failing test** (in `tests/office-team.test.cjs`):

```js
test('the boardroom board shows the open team: its goal while they meet, then each task by owner and status', () => {
  const meeting = { id: 'a', status: 'meeting', goal: 'Add password reset', updatedAt: 1, attendees: [] };
  assert.deepEqual(team.teamBoardCards([meeting]).map((c) => c.title), ['Add password reset']);
  const working = { id: 'b', status: 'working', goal: 'g', updatedAt: 2, attendees: [], plan: { summary: '', assignments: [
    { id: 't1', ownerId: 'backend-developer', title: 'API', status: 'done' },
    { id: 't2', ownerId: 'frontend-developer', title: 'Form', status: 'blocked' }] } };
  assert.deepEqual(team.teamBoardCards([meeting, working]).map((c) => [c.title, c.status]),
    [['Backend Developer: API', 'done'], ['Frontend Developer: Form', 'attention']]);
  assert.deepEqual(team.teamBoardCards([{ ...working, status: 'done' }]), []);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** implement `teamBoardCards` (names from `coworkerById` in `src/shared/coworkers.ts`; newest by `updatedAt` among `meeting`/`planned`/`working`/`reporting`); add `{ team: 'Boardroom', itemId: 'boardroom-whiteboard', kind: 'meeting', color: COMMONS, title: 'Team meeting' }` to `TASK_BOARDS` (the boardroom's whiteboard item id from Task 7); in `BoardLayer`, boards of kind `'meeting'` draw `this.meetingCards` with the team-board drawing (same signature check) instead of `boardCards(tasks, …)`, and `setMeeting(cards)` redraws them; `OfficeCanvas` calls `scene.setMeeting(teamBoardCards(teams))` whenever teams change.
- [ ] **Step 4:** Run `node --test tests/office-team.test.cjs tests/office-boards.test.cjs` → PASS.

### Task 9: Verify everything

- [ ] `npx tsc --noEmit` → no errors.
- [ ] `npm test` → all pass.
- [ ] `npx electron-vite build`; `npx electron tests/composer-stop.cjs` → `COMPOSER_CHECK_PASS`; `npx electron tests/team-desktop.cjs` → `TEAM_CHECK_PASS`, with a boardroom screenshot taken while the team meets (`3-boardroom.png`); look at every screenshot.
- [ ] Update `docs/multi-agent.md` with the team runner (what is real now).
