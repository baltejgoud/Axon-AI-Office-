# Office polish, task boards and the receptionist — design

- **Date:** 2026-09-24
- **Status:** Approved in conversation, awaiting written-spec review
- **Builds on:** [`2026-09-23-campus-office-design.md`](2026-09-23-campus-office-design.md) as built (stages 1–5, up to `ff2d470`)
- **Supersedes in that spec:** R4 (the Commons kept at its original size), R6 (Ops Coordinator at reception), R11 (hanging signs deferred), and the far/middle label tiers of §4.7 (district cards, department and room labels). R7 changes as described in §4.2.

## 1. Goal

Three increments, built in order, each leaving the app working:

- **A. Campus polish.** A bigger Commons, a coffee station in every district, signs in the world instead of floating cards, furnished executive offices, and a tidier message box.
- **B. Task boards and teamwork.** Every task you give appears as a live card on the team's board, and coworkers can ask each other questions while they work.
- **C. The receptionist.** A new core coworker keeps your to-dos and reminders. The main process owns the list, so reminders arrive as Windows notifications even while the window is closed, with Axon waiting in the tray.

## 2. Scope

### In scope
Everything in §4–§6, the data and API changes in §7, and tests (§10).

### Out of scope
- Recurring tasks ("every Monday"), snoozing reminders, calendar or email sync.
- Tray and notifications on macOS and Linux. The code does not block them, but they are not verified.
- Colleagues asking colleagues (only one level of asking; see §5.4).
- Changing the layout of districts other than moving them outward (§4.1).

## 3. Art direction

Every new object follows the office's existing look: **polished, stylized low-poly, seen from the fixed isometric camera.**

- **Geometry:** procedural low-poly shapes built like today's furniture (`scene/room/`), with the same bevelled edges and proportions. No imported models.
- **Shading and colour:** the palette and materials in `scene/room/materials.ts`, flat colours, no photographic or noisy textures. The district colour is the accent, and neutrals come from the existing materials.
- **Text:** signs, nameplates and boards draw their text into canvas textures in the UI font, dark on light or white on the district colour, never tinted text on a tint.
- **Light:** the existing time-of-day rig. New lamps (the executives' lamps, the library's reading lamps) switch on at dusk like the desk lamps.
- **Readable from the camera:** signs and boards tilt to face the camera's fixed angle, so their text isn't foreshortened.
- **Cost:** new repeated objects use the instanced furniture path. Draw calls at the whole-campus view stay within 10% of today's (~480), and 60 fps at 1920 × 1080 holds on the target laptop.

## 4. Part A — Campus polish

### 4.1 Bigger Commons, bigger campus

- The Commons grows from 28 × 22 m (`x −14…14`, `z −10…12`) to **40 × 32 m** (`x −20…20`, `z −15…17`).
- The campus grows by 12 m in x and 10 m in z (6 m and 5 m on each side). Its bounds become `x ∈ [−61, 61]`, `z ∈ [−37, 37]`.
- Every other district **keeps its size** and moves outward on its side: 6 m in x (Engineering left, the right-hand districts right) and 5 m in z (Product back, Business front; Design, Leadership and People & Ops also move in z with their row). The wider corridors this opens get the coffee stations (§4.2), trees and benches.
- The nav grid stays at 0.2 m cells (610 × 370). The minimap, camera clamp and "whole campus" framing follow the new bounds.

Approximate Commons plan (exact coordinates are set in the plan and fixed by tests):

```
 z=-15 ┌──────────┬──────────────┬─────────────┬──────────┐  back wall
       │ Lounge   │ Planning ×2  │  Library    │  Files   │
       │  9 × 8   │  2 × (6 × 8) │  11 × 8     │  8 × 8   │
 z=-7  ├──────┬───┴──────────────┴─────┬───────┴──────────┤
       │Collab│    Core team pods      │      Café        │
       │corner│    (two pods of four)  │     12 × 9       │
 z=3   ├──────┘                        └──────────────────┤
       │  Lobby: benches, plants, bikes, coat rack         │
       │  Reception desk (Today board behind it, Part C)   │
 z=17  └───────────────── front (low wall, doors) ────────┘
     x=-20                                              x=20
```

Rooms, each roughly double today's floor area:

- **Lounge:** three sofas in a U around a coffee table and rug, a bean-bag corner, floor lamps and plants. The Marketing Strategist's desk stays here.
- **Café:** the counter with the espresso machine (steam) and pastry case, **six** small tables and a long communal table (about 16 seats in all), pendant lights. It serves the Commons and anyone within reach (§4.2).
- **Library:** taller shelves (3 m) along the back wall with a rolling ladder, **three reading nooks** (armchair, reading lamp, side table), and a quiet table. The Knowledge Librarian's desk stays here. Clicking the shelves still opens the Knowledge overlay.
- **Files room:** a full **wall of cabinets**: today's folder cabinets (up to 12 plus "Open a folder") set into a floor-to-ceiling cabinet wall, with a sorting table and the printer. The Files Agent's desk and the Hand-to flow are unchanged.
- **Planning:** two glass meeting rooms, each with a table, screen and whiteboard.
- **Core team pods:** two pods of four, as today. Ops Coordinator stays at reception until Part C, which puts the receptionist there and moves Ops Coordinator back to `desk-ops`.

The simulation's Commons spots (café pickup and seats, lounge, bookshelf, printer, cabinets, meeting seats, reception) are re-authored for the new rooms. The existing behaviour tests are rewritten against them, and the layout invariants (unique desks, reachability, no overlaps, nothing in a wall) keep holding.

### 4.2 A coffee station in every district

- Every district except the Commons gets a **coffee station**: a short low-poly counter (≈1.6 × 0.6 m) with an espresso machine that steams while in use, a stack of cups and a small plant. It stands in the district's open area or the corridor at its entrance. Engineering, which is 62 m deep, gets **two** (north and south).
- Each station exposes two pickup spots and two standing spots (POIs of a new type, `coffee-station`).
- **Behaviour (replaces R7's coffee rule):** a coffee break goes to the nearest coffee station or the café, whichever is closer by path. In practice only the Commons and its near neighbours use the café. The limit of 12 people away from their desks at once is unchanged.

### 4.3 Signs instead of floating cards

The HTML district cards (far tier) and department and room labels (middle tier) are removed. Three kinds of world sign replace them, all clickable with the same actions as the cards they replace (glide to the district, open the department, open the room):

| Sign | Where | Look | Legibility |
|---|---|---|---|
| **District sign** | Freestanding pylon at each district's entrance, on the corridor side, placed so it covers corridor rather than desks | Tall slim post and a panel in the district colour, white short name (`district.short`), head-count beneath | Keeps its on-screen text at least 16 px tall from the middle zoom out to the whole-campus view by growing as you zoom out (up to 3.5× its true size). At close zoom it is its true size and fades to 25% opacity so it doesn't hide desks. |
| **Department sign** | Hanging over each department's back edge, on two thin cables from an implied ceiling | Panel in the district colour, white department name | Grows as you zoom out to keep its text at least 13 px, capped so neighbouring signs never overlap (at most the department's width). Hidden at the far tier, where district signs take over. |
| **Room sign** | On the wall above each Commons room's entrance (Lounge, Café, Library, Files room, Planning, Reception) | A wall plaque with the room colour stripe and name | Same rule as department signs |

- **Why this works where R11 didn't:** the whole sign face is the district colour with large white text, so neighbouring departments are told apart by their names, not by tints.
- **Rendering:** signs are instanced. All sign text goes into one shared canvas atlas, so all signs together cost a few draw calls. Each sign's growth with zoom is a per-instance scale updated when the zoom changes, not every frame.
- **Picking:** sign meshes join the raycast in `OfficeScene` (hover shows a pointer cursor and a soft highlight). People take priority when a person and a sign overlap.
- **Kept floating:** name tags for people up close (the existing cap of 30 with overlap hiding), and the selected person's tag at every zoom.
- **Keyboard and screen readers:** the district chips, "Go to department…" menu and search remain the non-pointer path to everything a sign does.

### 4.4 Executive offices

The ten Leadership offices keep their size (≈ 3.8 × 7 m) and glass walls, and gain:

- a **walnut desk** with a **leather executive chair** (high back, darker leather material);
- a **credenza** behind the desk with a row of books and a **desk lamp**;
- **two armchairs and a coffee table** in the front half of the room;
- **framed art** above the credenza. The back-row offices get a solid walnut-panelled back wall to hang it on. The front row keeps glass above a low panel with a picture ledge, so it hides nothing behind it;
- a **patterned rug** (a simple low-poly border and inlay pattern, varied per office);
- a **nameplate on the glass** beside the door with the title abbreviation from the role name, e.g. "CEO", "CFO", "CTO" (the text in parentheses in `roles.json`; the full name if there is none).

### 4.5 Message box and district chips

- **Model chip:** a compact chip showing a **short model name** (e.g. "Sonnet 4.5", "GPT-4o mini", "Gemini 2.5 Pro"). The full provider and model name shows on hover (`title`) and to screen readers. Underneath it is still the native `<select>` from `ModelSelect`, styled as a chip, so keyboard use and the option list (full names) are unchanged. `shortModelName()`:
  - uses `displayName` when it is at most 14 characters;
  - otherwise shortens the id: drops vendor prefixes and date or `-latest`/`-preview` suffixes, title-cases words and joins version digits;
  - adds an ellipsis past 14 characters.
- **Hint:** "Shift+Enter for a new line" stays visible at every panel width. When the actions row is too narrow, it moves to its own line under the text box instead of disappearing.
- **Spacing:** one actions row, [attach] [model chip] … [hint] [send], using the design tokens: 12 px padding, 8 px gaps, 32 px buttons aligned to one baseline, and file chips wrapping above the text box.
- **District chips stay on one line** (`white-space: nowrap`). When they don't fit, they switch to short names, and the chips that still don't fit move into a "More" menu at the end of the row. They never wrap to a second line.

## 5. Part B — Task boards and teamwork

### 5.1 Task records (main process)

The main process keeps **task records** in the saved state (`PlatformState.tasks`). Part B writes two kinds, and Part C adds the third:

| Kind | Created when | Status values |
|---|---|---|
| `work` | You send the **first message** of a conversation with a coworker (any coworker except the receptionist) | `working` → `attention` ↔ `working` → `done` |
| `help` | A coworker asks a colleague (§5.4) | `working` → `done` |
| `todo` | Part C: the receptionist or the planner adds it | `open` → `done` |

- **One card per conversation.** Follow-up messages in that conversation set its `work` record back to `working`. "New conversation" makes a new record.
- **Title:** the first line of your first message (visible text only, without file context or attachments), up to 80 characters.
- **Status comes from the run** (hooks in `chatSend`):
  - `working` while it generates;
  - `attention` with the note "Waiting for your approval" while an approval is pending, or with the error text if the run fails;
  - `done` when it finishes. If you stopped it, the status is `done` with the note "Stopped".
- On start-up, records still marked `working` (the app was closed mid-run) become `attention` with the note "Interrupted", matching how interrupted messages are marked today.
- Every change is saved and sent to the renderer as a `tasks` stream event carrying the full list.

### 5.2 Task boards

- Each department's existing board (`wb-<department>`: a whiteboard, kanban board, mood board or pinboard) becomes its **task board**. The core team uses a board in their room: **Library** (Research Analyst, Writer, Knowledge Librarian), **Planning** (Product Coach, Designer, Ops Coordinator), **Lounge** (Marketing Strategist), **Files room** (Files Agent). The receptionist has the Today board instead (§6.7).
- The board face (canvas texture, redrawn only when that team's tasks change) shows the header it has today plus up to **four cards**: the most recently updated, with `attention` cards pinned first. Each card shows:
  - a short title (one line, with an ellipsis);
  - who's on it (initials dot in their colour and their name);
  - a status chip: **Working** (blue, with a slow pulse), **Needs attention** (amber), **Done** (green).
  - `help` cards read "Helping Frontend Developer" with the question beneath.
- Boards share one atlas texture like the signs, so all boards cost about one draw call.

### 5.3 Team list

Clicking a board opens the **team list** in the side panel (a panel mode like the Files panel), for example "Backend & APIs — tasks":

- The rows are grouped as **Needs attention**, **Working** and **Done** (the last 20, then "Show more").
- Each row shows the title, who, status and a relative time. Clicking a row selects that coworker and opens that conversation. A `help` row opens the asker's conversation.
- Esc or the back arrow returns to the selected coworker.

### 5.4 Ask a colleague

- Every coworker gets the tool `ask_colleague({ colleague, question })`.
- **Finding the colleague:** `colleague` is a role name ("Backend Developer") or an id. It is resolved against the shared coworker directory (§8):
  - an exact name or id wins;
  - otherwise the specialty search picks a result (the office search, moved to `src/shared`), taking the top hit if it is clearly ahead;
  - otherwise the tool returns an error listing the five closest names, so the model can ask again.
  - The tool description lists the 22 departments so the model knows what exists without receiving all 208 names.
- **How the colleague answers:** `runSubagent` is generalised into a **consult** run on the asker's provider and model:
  - The system prompt is the colleague's own prompt and role profiles, plus a short framing: "<Asker> is asking you a question while working on a task for the user. Answer from your expertise, concisely."
  - The colleague gets read-only file tools when the asker's conversation has a folder, and never `ask_colleague` or planner tools, so there is only ever one level of asking.
  - At most 5 steps.
- **Limit:** at most **3 questions to colleagues per task** (one `chatSend` run). The service counts; a fourth call returns "You have asked three colleagues already; finish with what you have."
- **In the conversation:** the `ask_colleague` tool call renders as a **colleague card**: portrait, "Asked Backend Developer", the question (two lines, expandable), then "Thinking…" until the reply arrives as markdown (six lines, then "Show all").
- **On the boards:** a `help` record is `working` on the colleague's board while they answer, then `done`.
- **In the office:** while a `help` record is working, and until the asker's task stops working, the colleague walks to the visit spot at the asker's desk and stands there, then walks back. The walk is only for show; the answer never waits for it. Help walks count as required walkers and take priority over coffee breaks. With reduced motion there is no walk, just the board card.
- **Fix while here:** the guard in `runSubagent` that should stop a helper from asking another helper checks the name `dispatch_agent`, but the tool is called `dispatch_subagent`. The consult run removes the problem by never offering either tool.

### 5.5 Toolsets and permissions

Today every tool is offered only when the conversation has a folder (`service.ts:223`). Each conversation instead gets its toolset from the coworker it belongs to (`toolsFor(chat)`):

| Tools | Offered when |
|---|---|
| File tools, MCP tools, `run_command`, `git_commit`, memory tools | the conversation has a folder (unchanged) |
| `dispatch_subagent` | the conversation has a folder **and** belongs to no coworker (unchanged there). Coworkers use `ask_colleague`. |
| `ask_colleague` | always, for any coworker |
| `add_task`, `list_tasks`, `update_task`, `complete_task` | only in the receptionist's conversations (Part C) |

The office tools live in their own registry, not the shared `ToolRegistry`, so they never leak into other conversations. `PermissionManager.check` returns `allow` for `ask_colleague` and the four planner tools, because they only touch Axon's own records and the colleague's tools are read-only. Everything else keeps its current rules.

### 5.6 People's status in the office

A person's status in the office (the working dot, typing at the desk, the attention colour) is **derived from task records** instead of the renderer-only updates in `AgentComposer`. That way it is correct after the window reopens and for runs the renderer didn't start. The activity feed keeps its local entries.

## 6. Part C — The receptionist

### 6.1 A new core coworker

- `receptionist`, "Receptionist", role "Front desk & planning", department "Reception", Commons, home desk `desk-reception`, with a hand-tuned appearance like the rest of the core team and a rose accent.
- That makes **208 coworkers**: 198 bundled roles, the Business Analyst and 9 core agents.
- Ops Coordinator moves to `desk-ops` in pod B, and their department becomes "Planning".
- **Her system prompt** covers:
  - she keeps the user's to-dos, reminders and schedule;
  - she always uses the tools, never claims to have recorded something she didn't, and calls `list_tasks` before answering questions about the plan;
  - reminders with no time default to 09:00;
  - she confirms what she recorded in one short line ("Added: Prep the investor deck — Fri 25 Sep, reminder 10:00").
- On every message, the service adds the **current local date, weekday, time and UTC offset** to her system prompt, so she can work out "Friday" or "tomorrow at 10".

### 6.2 Planner tools

Dates are local wall-clock strings: `YYYY-MM-DD` for a date, `YYYY-MM-DDTHH:mm` for a date and time. The service validates every argument and returns a clear error the model can act on. A reminder time in the past is rejected ("That time has passed; ask the user").

| Tool | Arguments | Returns |
|---|---|---|
| `add_task` | `title` (required, ≤ 120 chars), `due?`, `remind_at?`, `notes?` (≤ 2,000 chars) | the new record |
| `list_tasks` | `range?`: `today` · `week` · `later` · `overdue` · `done` · `all` (default `all` open) | matching records, including coworkers' `work` records, as compact lines with ids |
| `update_task` | `id`, and any of `title`, `due`, `remind_at`, `notes` (`null` clears a field) | the updated record |
| `complete_task` | `id` | the updated record |

The tool calls render in her thread as compact cards ("Added: …", "Updated: …"), not raw JSON.

**If the model can't use tools:** when the model's `supportsTools` is `false`, her composer says "This model can't use tools, so I can't keep your planner. Pick another model." When a provider rejects a request with tools, the reply error says the same. The planner itself keeps working by hand.

### 6.3 The planner

Selecting the receptionist shows the **planner above her conversation** in the side panel. It is collapsible and scrolls within up to 45% of the panel's height, so the chat stays visible.

- **Groups** (the same pure function `groupPlanner(tasks, now)` in `src/shared/planner.ts` drives the planner, the briefing and `list_tasks`):
  - **Today:** overdue items first (marked "Overdue"), then items due today by time, then coworkers' `work` records that are working or need attention.
  - **This week:** due in the next 7 days after today.
  - **Later:** due after that, or no date (your to-dos without dates).
  - **Done:** completed in the last 14 days, newest first, collapsed by default.
- **Each row:** a checkbox (tick for done, untick to reopen), the title, a due chip (date, plus time and a bell when a reminder is set), and for `work` rows who is on it.
- Clicking the title edits it in place. Clicking the due chip opens a small editor with a date, a time and a "Remind me" toggle. The overflow menu has **Delete** (it asks you to confirm). Clicking a `work` row's person opens that conversation.
- An **Add** row ("Add a to-do…") with an optional date, so the planner works without a model.

### 6.4 Reminders

- Checked on the scheduler's existing 30-second tick (`startScheduler`), not with long timers, so reminders survive sleep and clock changes. A reminder fires when `remindAt ≤ now` and it hasn't fired yet; the tick then sets `remindedAt`.
- **Missed reminders:** reminders that came due while Axon wasn't running fire once at the next start. With more than three, one summary notification ("4 reminders you missed") replaces them.
- **Notification:** a Windows notification titled "Reminder" with the task title and its due time. Clicking it shows the window (creating it if needed) and selects the receptionist with the planner open.
- **Needs attention while closed:** when a coworker's task starts waiting for approval and no window is visible, a notification reads "Backend Developer needs your approval". Clicking it opens that conversation.
- `app.setAppUserModelId('com.axon.studio')` is set at start-up so Windows shows the notifications. It matches `build.appId`.

### 6.5 Tray and window lifecycle

- **Closing the window with "Keep running in the tray" on:** the window state is saved and the window is **destroyed**, freeing the renderer and the 3D office. The main process, the scheduler, running tasks and the tray icon keep going. Reopening creates a fresh window (the office rebuilds in a second or two).
  - The first time this happens, one notification explains: "Axon is still running in the tray, so reminders will arrive. Right-click the tray icon to quit."
- **With the setting off:** closing quits as today.
- **Tray icon** (the Axon mark, 16/32 px assets added under `resources/`):
  - Left-click opens Axon.
  - The menu has **Open Axon**, **Today's plan** (opens it at reception with the planner) and **Quit**.
  - Quit goes through the existing `before-quit` flush.
- **Start with Windows** (off by default) registers a login item with `--background`, which starts Axon in the tray with no window. It applies only to packaged builds; in development the switch is disabled with a note.
- **A reopened window picks up where things are:**
  - The snapshot gains the **pending approvals**, so an approval that started while the window was closed shows up.
  - A new `focus` stream event lets main tell the renderer whom to select (after a notification or tray click).
- The single-instance handler, `activate` and the IPC sender check keep working with a window that can be recreated (they already reference the current `window`).

### 6.6 Morning briefing

- The first time a window opens on a given day (not when Axon starts in the tray), the renderer asks main for the briefing (`receptionBriefing()`). If it hasn't been shown today, main returns it and records the date. The office then selects the receptionist.
- **Built locally from the list, with no model call:**
  - a greeting by time of day;
  - today's items with times;
  - overdue items;
  - a coworker line ("2 coworkers working, 1 needs attention");
  - or "Nothing planned today — tell me if you want to add something."
- It shows at the top of her thread as a message from her, but it is **not saved into the conversation** and not sent to the model; she reads the list through her tools.

### 6.7 The Today board

A board behind the reception desk, in the art direction of §3, lists the **next five open items**: overdue first, then today's by time, then the next days, each with its time or day. It is redrawn when tasks change and at midnight. Clicking it selects the receptionist and opens the planner.

### 6.8 Settings

In Settings → General, two switches:

- **Keep running in the tray** (default **on**), with the note "Reminders only arrive while Axon is running."
- **Start with Windows** (default **off**).

## 7. Data and API changes

- **`src/shared/types.ts`:**
  - `TaskItem`:

    ```ts
    export type TaskKind = 'work' | 'help' | 'todo';
    export type TaskStatus = 'open' | 'working' | 'attention' | 'done';
    export interface TaskItem {
      id: ID;
      kind: TaskKind;
      title: string;          // ≤ 120 chars
      notes?: string;         // ≤ 2,000 chars
      status: TaskStatus;
      note?: string;          // status detail: 'Waiting for your approval', 'Stopped', an error
      coworkerId?: string;    // work/help: who is on it
      forCoworkerId?: string; // help: who they are helping
      conversationId?: ID;    // work: their thread; help: the asker's thread
      due?: string;           // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm', local
      remindAt?: number;      // epoch ms, computed from the local time when set
      remindedAt?: number;
      createdAt: number; updatedAt: number; doneAt?: number;
    }
    ```
  - `Settings` gains `keepInTray: boolean` and `startWithWindows: boolean`.
  - `StreamEvent` gains `{ channel: 'tasks'; tasks: TaskItem[] }` and `{ channel: 'focus'; agentId: string; conversationId?: ID; planner?: boolean }`.
- **`src/shared/platform.ts`:**
  - `PlatformState` gains `tasks: TaskItem[]` and `reception: { briefedOn?: string; trayHintShown?: boolean }`.
  - `Snapshot` gains `pendingApprovals: ToolApprovalRequest[]`.
  - New IPC methods: `taskAdd(input)`, `taskUpdate(id, patch)`, `taskDelete(id)`, `receptionBriefing()`.
- **Migration** (`Repository.migrate`): `tasks ??= []`, `reception ??= {}`, `keepInTray ??= true`, `startWithWindows ??= false`. Validation checks that `tasks` is an array of records with string `id`, `title` and a known `kind`/`status`. Nothing existing is changed or deleted.
- **Coworker directory:** the core team's definitions and the specialist list move to `src/shared/coworkers.ts` (id, name, role, department, prompt, role ids), so main can resolve colleagues and build prompts. The renderer's `officeAgents.ts` adds the district, colours and capabilities on top.

## 8. Code structure

`service.ts` (731 lines) only gains thin hooks; new behaviour lives in focused modules of no more than ~400 lines each.

```
src/shared/
  coworkers.ts        the 208-person directory (moved from renderer data)
  coworkerSearch.ts   specialty search (moved from office/shell/search.ts)
  planner.ts          groupPlanner(), briefing text, due/remind parsing and formatting
  models.ts           shortModelName()
src/main/
  tasks/store.ts      TaskStore over state.tasks: add, update, complete, delete, emit
  tasks/tracker.ts    run hooks → work records (start, approval, end, interrupted)
  tasks/tools.ts      add_task, list_tasks, update_task, complete_task
  colleagues.ts       ask_colleague tool and the consult run (replaces runSubagent's body)
  officeTools.ts      toolsFor(chat): assembles the toolset per conversation
  reminders.ts        dueReminders(tasks, now), missed-reminder summary
  shell/tray.ts       tray icon and menu
  shell/notify.ts     notifications and their click targets
  shell/lifecycle.ts  close/quit rules (pure, tested), login item
src/renderer/src/features/office/
  campus/commons.ts            rebuilt Commons
  campus/coffee.ts             coffee stations
  campus/signs.ts              sign placement (districts, departments, rooms)
  scene/room/signs.ts          instanced signs, text atlas, zoom scaling
  scene/room/boards.ts         task-board faces (atlas), Today board
  scene/room/executive.ts      executive office furniture
  activity/TeamList.tsx        board click → team list
  activity/ColleagueCard.tsx   ask_colleague rendering
  activity/Planner.tsx         the receptionist's planner
  activity/Briefing.tsx        morning briefing message
  shell/SceneLabels.tsx        reduced to person tags
```

## 9. Error handling

| Situation | Behaviour |
|---|---|
| Colleague name not found or ambiguous | Tool error with the five closest names; the model asks again |
| Consult run fails (provider error, abort) | The colleague card shows "Couldn't reach Backend Developer: <reason>"; the `help` record ends `done` with that note; the asker's run continues |
| Fourth colleague question in one task | Tool result says the limit is reached |
| Invalid date, past reminder, unknown task id | Tool error in plain words; nothing is written |
| Model without tool support | Receptionist composer notice (§6.2); planner stays usable by hand |
| Notifications blocked (Focus Assist, OS setting) | Reminders still mark as fired and show as overdue in the planner and the next briefing |
| Machine asleep or Axon closed at reminder time | Fires at the next tick after waking, or once at the next start (summary above three) |
| Window closed while a task waits for approval | Notification; approval shown on reopen. The 5-minute approval timeout is unchanged |
| Tasks saved in a corrupt shape | Handled by the existing validation and quarantine path |
| Sign or board texture fails to draw | The sign or board renders blank; the chips, menu and team list still work |

## 10. Testing

**Unit (`node:test`, no DOM):**
- **Campus:**
  - 208 unique home desks;
  - the new bounds hold everything;
  - every desk, hub and coffee station is reachable from reception;
  - no overlaps or furniture in walls;
  - every sign sits inside its district or department and faces the camera;
  - executive nameplates match the abbreviations in `roles.json`.
- **Simulation:**
  - coffee breaks go to the nearest station or café by path;
  - the away budget ≤ 12 still holds;
  - help walks start and end with the help record and take priority over ambient outings;
  - Commons behaviour tests are rewritten for the new rooms.
- **`shortModelName()`:** a table of real model ids and names.
- **Chips:** the overflow decision for widths 980, 1366 and 1920 px.
- **Tasks:**
  - the tracker turns start, approval, resolve, error, stop and finish into the right status and note;
  - interrupted records on load become `attention`;
  - there is one record per conversation, and none for the receptionist's own conversations.
- **`toolsFor`:**
  - no folder → coworkers get only `ask_colleague`;
  - the receptionist gets the planner tools;
  - chats with no coworker keep today's behaviour;
  - consult runs never get `ask_colleague` or `dispatch_subagent`.
- **Ask a colleague:** name resolution (exact, search, ambiguous), the three-question limit, the consult prompt includes the colleague's profile, and failures end the `help` record.
- **Planner:**
  - `groupPlanner` at day and week edges, including midnight and a daylight-saving change;
  - due and reminder parsing and validation;
  - the briefing text for empty, normal and overdue cases.
- **Reminders:** `dueReminders` with an injected clock; each reminder fires exactly once; missed reminders are summarised above three.
- **Lifecycle:** close → destroy vs quit for each setting; quitting from the tray flushes the store; `--background` starts without a window.
- **Migration:** an old state file loads with empty tasks and the default settings.

**Desktop smoke (`tests/office-desktop.cjs`, mock provider):**
- the Commons rooms and signs are present, and clicking a district sign glides to the district;
- the model chip shows a short name;
- sending a task puts a card on the department board, and clicking the board opens the team list;
- a mock tool call to `ask_colleague` renders a colleague card and a `help` card;
- selecting the receptionist shows the planner; adding a to-do, ticking it and editing its date all work;
- a reminder due in the past fires a notification (stubbed) on the next tick;
- closing the window with the tray setting on keeps the process alive, and "Today's plan" reopens it on the receptionist.

**Visual:** screenshots at 1920 × 1080 and 1366 × 768 at the three zoom levels, both themes, for the new Commons, signs, coffee stations, executive offices, boards and planner.

**Performance:** the `axon.officeDebug` readout at the whole-campus view shows draw calls within 10% of today's and 60 fps at 1080p.

## 11. Delivery

Three parts, in order, each with its own plan, each ending with the unit tests, typecheck, desktop smoke and screenshots passing:

1. **Part A — Campus polish** (§4): renderer only. Plan written now.
2. **Part B — Task boards and teamwork** (§5): task records, toolsets, colleagues, boards. Plan written when A is merged, against the code as it is then.
3. **Part C — The receptionist** (§6): the receptionist, planner, reminders, tray. Plan written when B is merged.

## 12. Risks

- **Rebuilding the Commons** touches the most-tested part of the simulation. Mitigation: re-author the spots first, then rewrite the tests against them, before moving any district.
- **Sign legibility vs. clutter** at the whole-campus view. Mitigation: grow them with zoom as described in §4.3, check the screenshots at 1366 px, and tune the growth limits during the build (record any change as a revision).
- **Windows notification quirks** in development builds (the app ID, Focus Assist). Mitigation: set the app ID at start-up, have the planner and briefing show missed reminders anyway, and check notifications with a packaged build.
- **Token cost of colleague questions.** Bounded by the limit of three per task and five steps per consult.
- **Models that ignore tools** could reply "Done!" without recording anything. Mitigation: the prompt requires tools, her thread shows a tool card for every change so a missing card is visible, and the planner is the source of truth.
