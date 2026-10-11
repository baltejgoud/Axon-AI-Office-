# Agent dashboards — coworkers show the data they gathered — design

- **Date:** 2026-10-11
- **Branch:** `feat/agent-dashboards` (worktree `.claude/worktrees/dashboards`, from main c5524bb).
- **Status:** decisions asked and answered 2026-10-11 (below); design approved in chat 2026-10-11.

## Goal

When a coworker has gathered data worth seeing at a glance (numbers, comparisons, trends, a list
of findings or leads), it can show it as a dashboard instead of burying it in prose. The dashboard
appears as a card in its conversation and stays in a Dashboards sheet you can reopen later.

## Decisions (asked 2026-10-11)

| Question | Answer |
|---|---|
| What the dashboard is | **Agents publish one** with a new tool, `show_dashboard`. |
| Who can publish | **Every coworker**, and your own plain chats. Display only, so no approval. |
| Where it shows | **A card in the conversation + a Dashboards sheet** (Ctrl+K, left rail, the card's Open). |

Out of scope: dashboards on the 3D desk screens, scheduled refresh, exporting a whole dashboard.

## Approaches considered

1. *Structured widgets that Axon draws* — **chosen**. The model fills in a fixed set of building
   blocks; Axon renders them with its own components, in both themes. Nothing the model writes runs.
2. Model-written HTML in a sandboxed iframe — more freedom, but model-authored code runs inside the
   app, every dashboard looks different, and themes break.
3. No new records, read dashboards back out of tool-call arguments — messages are paged, so the
   sheet would have to load every conversation, and updating one in place has nowhere to live.

## The tool

`show_dashboard` (`src/main/dashboards.ts`), offered by `toolsFor` to every run that isn't a
colleague consult, with or without a folder, and kept by `selectTools` like the other core tools.
`permissions.decide` allows it (it touches only the dashboard records).

Input:

- `title` (required, ≤ 120 chars), `summary` (optional, ≤ 600)
- `dashboard_id` (optional): update that dashboard in place; only one from the same conversation.
- `sources` (optional, ≤ 20): `{ title, url? }`, where the data came from.
- `widgets` (1–12), each one of:
  - `stat` — `label`, `value` (number or short text), `unit?`, `change?` ("+12%"), `note?`
  - `bar` — `title`, `data: [{ label, value }]` (≤ 30), `unit?`
  - `line` — `title`, `x: [labels]` (≤ 100), `series: [{ name, values: [numbers] }]` (≤ 6), `unit?`
  - `table` — `title`, `columns` (≤ 12), `rows` (≤ 200; cells are numbers or text ≤ 300)
  - `list` — `title`, `items: [{ text, detail?, url? }]` (≤ 50)
  - `text` — `title?`, `body` (Markdown, ≤ 4,000)

The description tells the model: use it for data worth seeing at a glance, not for a simple answer;
only data it actually gathered, with sources; still write a short answer in text.

`normalizeDashboard(args)` checks types and limits, keeps only http(s) links, requires finite
numbers and series as long as `x`, and returns either a clean dashboard or an error naming exactly
what is wrong (e.g. `widgets[2].series[0].values has 9 numbers; x has 10 labels.`), so the model can
call again. The whole input must be under 40 KB of JSON.

The result to the model: `Dashboard "<title>" is on screen for the user (id <id>). Pass dashboard_id
to update it.`

## Records

`Dashboard` in `src/shared/types.ts`: `id, title, summary?, widgets, sources, agentId?,
conversationId, toolCallId, createdAt, updatedAt`. `PlatformState.dashboards` (repository
normalizes a missing list to `[]`), newest 200 kept. Every change emits
`{ channel: 'dashboards', dashboards }` and the window swaps them in, like teams.
`dashboardDelete(id)` IPC removes one. Deleting a conversation keeps its dashboards (the sheet's
"Go to conversation" is then hidden).

## The window

- **Card in the conversation** (`office/dashboards/DashboardCard.tsx`, routed by
  `officeToolCard`): title, who and when, up to four stat tiles, how many charts/tables/lists, and
  **Open**. When that call's dashboard was updated later, "Updated since — opens the latest". When
  the call failed, the card isn't shown (the model's retry is).
- **Dashboards sheet** (`Overlay` 'dashboards', wide and flush): left, every dashboard newest first
  with the coworker's portrait, name and date, filtered by coworker; right, the dashboard in full
  with "Go to conversation" and "Delete" (one native confirm). Opened from Ctrl+K "Dashboards", a
  button by Company in the left rail, or a card's Open (which selects that one).
- **Widgets** (`office/dashboards/Widgets.tsx`): stat tiles in a row; bars and lines are SVG drawn
  here (no chart library in the app), following the dataviz skill; tables scroll inside their card
  and have "Copy as CSV"; lists show links that open through the app's external-link path; text
  uses `MessageMarkdown`. All model text is rendered as text.

## Testing

- `tests/dashboards.test.cjs`: normalization accepts each widget type and rejects each limit with a
  precise message; links other than http(s) dropped; `toolsFor` offers the tool to coworkers and
  plain chats; `selectTools` keeps it; through the service with a mocked model: a call saves a
  record, emits it, an update by id replaces it, an id from another conversation is refused, and a
  saved state without `dashboards` loads.
- Desktop: `tests/dashboards-desktop.cjs` seeds a conversation with a dashboard call, screenshots
  the card and the sheet at 1536×816, light and dark, after `npx electron-vite build`.
- `npm test` and `npm run typecheck` pass.
