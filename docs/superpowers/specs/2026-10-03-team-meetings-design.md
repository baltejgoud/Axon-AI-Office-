# Team meetings — the Chief of Staff gathers a team, they plan, split and do the work — design

- **Date:** 2026-10-03
- **Branch:** `feat/transparency` (shared checkout; uncommitted, alongside other sessions' work).
- **Status:** decisions asked and answered 2026-10-03 (below); design approved in chat 2026-10-03; built 2026-10-03 (uncommitted).

## Goal

When you give the Chief of Staff (or the Ops Coordinator) a task that needs more than one
specialty, they work out who is good for it, gather those people in a meeting room, the team
discusses it and splits the work, you approve the plan, and then each person does their part,
handing results to whoever needs them, until the coordinator reports back. Today none of this
exists: the only collaboration is `ask_colleague` (one question, at most three per task, read-only,
sequential; see `docs/multi-agent.md`).

## Decisions (asked 2026-10-03)

| Question | Answer |
|---|---|
| How much happens without you | **Plan, then you OK it.** The meeting ends with a plan card (tasks, owners, order). You press Start; owners then work in their own chats, file writes and commands still ask you, and the coordinator reports when it is done. |
| Parallel work | **Parallel where safe.** Tasks run in dependency order; independent tasks run at once, up to 3. The plan gives each task its own files, and two tasks that may run at once never own the same file. |
| Team size and room | **Up to 12, new boardroom.** A large glass boardroom in the Commons for team meetings: one long table, the coordinator at its head, the plan on its wall screen. |

## Approaches considered

1. *A team runner in the main process that drives real coworker conversations* — **chosen**. The
   meeting, plan and schedule live in Axon; every task is an ordinary run in its owner's own
   conversation, so approvals, the activity log, undo, Stop, the context meter and the office's
   statuses all work unchanged. Parallelism is decided by the plan, not by the model.
2. The coordinator does everything in one long run with a blocking "assign" tool — sequential by
   nature, the coordinator's context fills with everyone's work, and nobody is visibly working.
3. Agents message each other freely — unpredictable, expensive, hard to stop, nobody owns the
   outcome.

## Today

- `Service.chatSend` runs one conversation's tool loop; several conversations can run at once
  (`runs` is keyed by conversation). Messages sent mid-run now wait for the next step.
- Coworkers are defined in `src/shared/coworkers.ts` (core team plus a specialist per bundled
  role); `scoreCoworkers` (`src/shared/coworkerSearch.ts`) ranks them for a phrase, and
  `resolveColleague` (`src/main/colleagues.ts`) turns a name into one coworker or a list of the
  closest.
- `consult` runs a colleague's short read-only loop and forces a final answer when its steps run
  out.
- `toolsFor` (`src/main/officeTools.ts`) decides each conversation's tools; the receptionist's
  planner tools show how a role gets tools of its own that the service answers itself.
- `TaskTracker` keeps work and help records in `state.tasks`; the window derives statuses from them
  (`statusesFromTasks`) and moves helpers to desks (`activeHelp` → `OfficeScene.startHelp`).
- The Commons has two Planning rooms (7 and 6 seats) and a small collaboration corner on its left.

## Design

### Data

```ts
type TeamStatus = 'meeting' | 'planned' | 'working' | 'reporting' | 'done' | 'stopped' | 'failed' | 'discarded';
type AssignmentStatus = 'waiting' | 'working' | 'done' | 'failed' | 'stopped' | 'blocked';

interface TeamAssignment {
  id: string;              // 't1', 't2', … as the plan names them
  ownerId: string;         // a coworker id, always one of the attendees
  title: string;
  brief: string;           // what to do, in enough detail to start
  dependsOn: string[];     // assignment ids that must be done first
  files: string[];         // project paths this task owns (slash paths)
  status: AssignmentStatus;
  conversationId?: string; // the owner's conversation for this task
  result?: string;         // the owner's final answer: the hand-off
  note?: string;           // why it failed, stopped or is blocked
}
interface TeamMinute { coworkerId: string; text: string; at: number; error?: string }
interface Team {
  id: string;
  leadId: string;          // 'chief-of-staff' | 'ops-coordinator'
  conversationId: string;  // the lead's conversation the meeting was called from
  goal: string;
  attendees: string[];     // coworker ids, 2–12, never the lead
  providerId: string; modelId: string;  // everyone uses the lead's model
  status: TeamStatus;
  minutes: TeamMinute[];
  plan?: { summary: string; assignments: TeamAssignment[] };
  report?: string;
  note?: string;           // why it failed or stopped
  createdAt: number; updatedAt: number;
}
```

`PlatformState.teams: Team[]`, defaulted to `[]` by `Repository.migrate`. A team saved while
`meeting`, `working` or `reporting` loads as `stopped` ("Axon closed while the team was working"),
with its working assignments `stopped`, so Retry can pick it up. Teams reach the window in the
snapshot and in a `{ channel: 'teams', teams }` event after every change.

### Tools (the Chief of Staff and the Ops Coordinator only)

- `find_people({ need })` — the eight coworkers who best fit a need, by `scoreCoworkers`, one per
  line: name, department, what they are good at. Allowed without asking.
- `call_team_meeting({ goal, attendees })` — 2–12 names (or ids). Each is resolved like
  `ask_colleague`; vague names come back with the closest matches and nothing starts. The lead is
  left out, duplicates collapse. One open team (meeting, planned, working, reporting) per lead
  conversation. Starts the meeting in the background and answers at once with the team id and who
  is coming, so the lead can tell you who it gathered and why. Allowed without asking: it only
  reads, and nothing is done until you approve the plan.

`toolsFor` adds both for the two leads. Their tool descriptions say when to use them: anything that
needs more than one specialty gets a meeting; a question the lead can answer alone does not.

### The meeting (`src/main/team/meeting.ts`)

1. **Input.** Every attendee contributes at once (at most four model calls in flight). Each gets
   their own system prompt and role profiles plus the meeting brief: the goal, who else is there and
   their specialties, and the ask — in under 200 words: how they would approach their part, what
   they would own (files or areas), what they need from whom, and the main risk; do not do the work
   yet. They may read the project (the read-only tools) when the lead's conversation has a folder.
   This is `consult` with the meeting's system prompt (`ConsultDeps.system`, an optional override).
   Each minute is saved and sent to the window as it arrives. One failed attendee leaves an error
   minute; if every attendee fails, the team fails.
2. **Plan.** The lead turns the minutes into a plan by calling `propose_plan` (the only tool
   offered): `{ summary, assignments: [{ id, owner, title, brief, depends_on, files }] }`.
3. **Check** (`validatePlan`, pure): 1–20 assignments; unique ids; each owner resolves to an
   attendee; title and brief present; dependencies name real assignments, never themselves, with no
   cycles; files normalised to slash paths. Two assignments that could run at the same time
   (neither depends on the other, directly or through others) may not own the same file. An invalid
   plan goes back to the lead once with the errors as the tool's answer; invalid again, the team
   fails with the errors as its note.
4. The team becomes `planned` and the plan card waits for you.

### Your OK, and the work (`src/main/team/runner.ts`)

- **Start** (`teamStart`) — `working`; the scheduler starts every assignment whose dependencies are
  done, up to 3 running at once, and starts more as each ends.
- **Each assignment** — a new conversation for its owner (the owner's system prompt and roles, the
  lead's model, the lead conversation's folder), sent a brief from the lead (shown as "From Chief of
  Staff", not "You"): the goal and the plan's summary; their task; the files they own and that
  others own (do not edit those — ask their owner); the hand-off from each task it depends on; who
  is on the team doing what. It is an ordinary run: writes and commands ask you, the office shows
  them working or waiting for you.
- **Asking a teammate** — `ask_colleague` from a team run, to someone who has an assignment in the
  same team, tells the colleague the team's goal and their own task and hand-off so far.
- **When a run ends** — its last answer is the hand-off (`result`, up to 4,000 characters). An error
  marks it `failed`, Stop marks it `stopped`; either way the tasks that depend on it become
  `blocked` (the rest carry on) and the card offers **Retry**.
- **The report** — when every assignment is done, the lead writes a short report from the goal,
  plan and hand-offs (one call, no tools): `reporting` then `done`. It shows on the plan card,
  Windows notifies you if the window is hidden, and the lead's later conversations know their
  teams (below).
- **Stop team** (`teamStop`) — stops the meeting's calls or every running owner; waiting
  assignments become `stopped`. **Discard** (`teamDiscard`) — a planned team you don't want.
  **Retry** (`teamRetry`) — failed, stopped and blocked assignments go back to waiting and the team
  carries on (also after a restart).
- **The lead remembers** — the lead's system prompt lists their recent teams (goal, status, each
  task's owner and status, the report), so "how is it going?" or "have the designer redo the
  layout" can be answered and acted on (a new meeting).

### The window

- **Plan card** — in the lead's thread, under the `call_team_meeting` call (like the colleague
  card): the goal; the attendees with their avatars; each person's input (folded); the plan as a
  list of tasks with owner, what it waits for, its files and a live status; Start and Discard while
  planned; Stop team while meeting or working; Retry when something failed or stopped; the report
  when done. Each task links to its owner's conversation.
- **Owners' threads** — the brief shows as from the lead.

### The office (Phase 2)

- **Boardroom** — replaces the collaboration corner on the left of the Commons: glass walls with a
  door, one long table seating 12 with the coordinator's chair at its head, a wall screen on the
  back wall (facing the camera), plants. Its seats also host the office's ambient meetings.
- **Choreography** — the teams in the snapshot drive the scene the way help records do (no new task
  kind, so the planner and team lists are untouched): while a team is `meeting` (and again while it
  is `reporting`, for the wrap-up) its lead and attendees walk to the boardroom and take seats, the
  lead at the head; speakers take turns; when it ends they go back to their desks, where their tasks
  then show them working. The boardroom's board (its whiteboard, drawn like the department task
  boards) shows the team's goal and then its tasks while the team is open; clicking it opens the
  lead's conversation.

## Testing

- `validatePlan` and the scheduler's pure parts: owners, ids, cycles, file conflicts between tasks
  that may run together, ready and blocked tasks.
- Service tests with a mock model: a lead calls a meeting; minutes arrive; an invalid plan is sent
  back once; the plan waits for Start; tasks run in dependency order, at most 3 at once; a hand-off
  reaches the dependent task's brief; a failed task blocks only its dependants; Retry resumes; Stop
  team stops everyone; the report; a restart loads an open team as stopped; vague attendees are
  refused with the closest matches.
- Desktop check: the plan card through Start and done; the boardroom with the team seated.
- The campus layout tests cover the boardroom (seats reachable, nothing overlapping).

## Not in scope

- Agents talking to each other outside `ask_colleague` and hand-offs.
- Editing the plan in the card (reply to the lead; it can call the meeting again).
- Different models per attendee.
