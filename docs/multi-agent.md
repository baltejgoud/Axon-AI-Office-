# Multi-agent collaboration in Axon (as built)

This describes what the code actually does today, not the marketing story. File:line cites
refer to the current sources on this branch.

## What is real

Axon has one collaboration primitive: `ask_colleague` (src/main/colleagues.ts:16-31). A
coworker can ask a named colleague a question while working; the colleague runs a short model
loop and returns an answer as a tool result. There is no agent graph, no nesting, and no
mechanism for one coworker to assign work to another — collaboration is question-and-answer.

- `MAX_ASKS = 3` per task run (src/main/colleagues.ts:9); the 4th call returns `LIMIT_REACHED`
  (src/main/colleagues.ts:10, src/main/service.ts:1212).
- The colleague answers with the asker's model and key, not their own
  (src/main/service.ts:1223-1226).
- Each ask opens a tracked help record (src/main/service.ts:1221, :1252).
- Depth is exactly one level: a colleague cannot ask another colleague
  (src/main/colleagues.ts:72; see below).

## Resolution: who gets asked

`resolveColleague` (src/main/colleagues.ts:44-65) matches an exact id or name first, refuses
self-asks ("Ask someone other than yourself.", :50), then scores candidates. A single strong
match (score >= 55) is used; a vague name like "engineer" comes back as an error listing up to
five closest people (:59-64) so the asker can re-ask.

## The consultation loop

`consult` (src/main/colleagues.ts:92-142) gives the colleague up to `CONSULT_STEPS = 5`
tool-using turns (:12, :105) at temperature 0.3 (:114). Each turn streams text, then executes
the tool calls the model made (:125-139). The colleague's system prompt is their own profile
plus role profiles plus "You cannot ask other colleagues." (:68-76).

The one-level limit is enforced by tool availability, not just the prompt: `consult` never
receives `ask_colleague` as a tool — only the read-only tools and allow-listed connector tools
the asker passes in (src/main/service.ts:1234-1237).

## Tools: who gets what

`toolsFor` (src/main/officeTools.ts:34-49):

- With a folder: the full registry minus `dispatch_subagent` for coworkers (:42-44).
- Without a folder: no file tools at all (:43-44).
- Every coworker gets `ask_colleague` (:45).
- The Receptionist also gets `PLANNER_TOOLS` (:46).
- Connector tools are appended per coworker (:47).

Colleagues (the people being consulted) are narrower: only `read_file`, `list_files`,
`search_code` (`READ_ONLY_TOOLS`, src/main/officeTools.ts:7) plus connector tools whose action
is `allow` (src/main/service.ts:1235-1237). A tool the colleague asks for but wasn't given
returns "Not available to you here." (src/main/colleagues.ts:135-137); a tool the permission
check denies returns "Not allowed." and is audit-logged as denied
(src/main/service.ts:1241-1243). Writes, shell, git, and memory updates are never available to
a colleague — the execute path passes `allowShell: false` (src/main/service.ts:1245).

## dispatch_subagent and why coworkers don't get it

`dispatch_subagent` exists in the registry (src/main/tools/registry.ts:511-542) and runs an
autonomous subagent when `ctx.subagentRunner` is set (:531-537). `toolsFor` filters it out for
coworkers (src/main/officeTools.ts:43); the design comment says coworkers "do that instead"
via ask_colleague (:31-32). In practice, plain user chats with a folder keep
dispatch_subagent; coworker conversations do not.

## Planner tools: the user's to-dos, not agent work

The Receptionist's planner tools are `add_task`, `list_tasks`, `update_task`, `complete_task`
(src/main/tasks/tools.ts:29-83). They record to-dos for the user ("Add a to-do to the user's
planner", :31-34). `list_tasks` reports both the user's to-dos and what coworkers are working
on (:48-50, :179), but `update_task`/`complete_task` refuse a coworker's work record:
"That is a coworker's task; only the user's to-dos can be changed."
(src/main/tasks/tools.ts:210). So the planner is not a work-assignment system between agents.

## Synchronous vs parallel

Everything here is synchronous. The only call site awaits `consult` inline inside the asker's
tool loop (src/main/service.ts:1223), so the asker blocks until the answer returns. Within a
consultation, the colleague's tool calls run one at a time in a `for..of` loop
(src/main/colleagues.ts:128). Asking three colleagues is three sequential calls; there is no
concurrent-consultation path in these sources. The asker's abort signal is forwarded to the
colleague (src/main/colleagues.ts:81, src/main/service.ts:1232).

## Failure modes

- `(no answer)`: the colleague's loop produced empty text — returned as-is
  (src/main/colleagues.ts:141). Silent; the asker must interpret it.
- `LIMIT_REACHED` on the 4th ask (src/main/colleagues.ts:10).
- `No single colleague matches "..."` with the five closest names (src/main/colleagues.ts:62-64).
- `Ask someone other than yourself.` (src/main/colleagues.ts:50).
- `Not available to you here.` for tools the colleague wasn't given (src/main/colleagues.ts:135);
  `Not allowed.` for tools the permission check denied (src/main/service.ts:1243).
- `Couldn't reach <name>: ...` when consult throws or the run is stopped
  (src/main/service.ts:1254-1257).
- Malformed tool-call JSON is treated as empty arguments rather than rejected
  (src/main/colleagues.ts:129-134).
- The answer is wrapped as JSON `{colleague, name, answer}` (src/main/service.ts:1253), so
  distinguishing a real answer from a failure is left to the caller.

## Gaps

1. No parallelism — each ask blocks the asker; no concurrent consultations.
2. One level deep only; a colleague cannot consult a specialist of their own.
3. Consultations are stateless: each starts from just the question (src/main/colleagues.ts:103).
4. No shared work assignment: planner tools manage the user's to-dos, not tasks between agents.
   (Answered by team meetings, below.)
5. `(no answer)` and refused tools are weakly surfaced to the asker.
6. Colleagues get read-only file tools at most — no writes, even when the asker could write.

## Team meetings (2026-10-03)

Spec: `docs/superpowers/specs/2026-10-03-team-meetings-design.md`. Code: `src/main/team/`.

- **Who leads.** The Chief of Staff and the Ops Coordinator get `find_people` (ranks coworkers for
  a need, by the office search's scoring) and `call_team_meeting` (2–12 attendees, resolved like
  `ask_colleague`; vague names refuse the lot) (`team/tools.ts`, `officeTools.ts`).
- **The meeting.** Every attendee gives their input at once, at most four calls in flight, through
  `consult` with a meeting prompt (`ConsultDeps.system`), reading the project when the lead's chat
  may. The lead then calls `propose_plan`; `validatePlan` (`team/plan.ts`) checks owners are
  attendees, ids are unique, dependencies exist with no loops, and that no two tasks that could run
  at once own the same file. A broken plan goes back once with the reasons.
- **Your OK.** The plan waits (`planned`) on a card under the lead's call (`TeamCard.tsx`): Start or
  Discard; Stop team while it runs; Retry when something failed or stopped.
- **The work.** `TeamRunner` (`team/runner.ts`) starts tasks whose dependencies are done, at most
  three at once. Each task is an ordinary run in a new conversation for its owner, opened by a brief
  "from" the lead with the goal, their task, who owns which files, and the hand-offs it builds on.
  Writes and commands still ask you. A failed or stopped task blocks only what depends on it.
- **Coordination.** `ask_colleague` between teammates tells the colleague they share the team, with
  their own task and hand-off so far. The lead's system prompt lists their recent teams, so they can
  say how it is going.
- **The report.** When every task is done, the lead writes a short report (no tools) onto the card.
- **The office.** A glass boardroom (12 seats and the lead's at the head) replaced the collaboration
  corner. While a team is meeting, and again for the wrap-up, its people walk there; anyone busy
  joins once their task ends (`OfficeSimulation.startTeamMeeting`). The boardroom's board shows the
  open team's goal, then its tasks.
- **Restart.** A team that was running when Axon closed loads as stopped; Retry carries it on.

Still true: everything is one level deep (owners can't call meetings), and everyone uses the lead's
model.
