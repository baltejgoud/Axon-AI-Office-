# Transparency Wave 2 — audit trail and reviewable, undoable diffs — design

- **Date:** 2026-09-27
- **Branch:** `feat/transparency` (continues Wave 1).
- **Status:** decisions asked and answered 2026-09-27 (below); design awaiting approval.

## Goal

Make every action any agent takes visible after the fact, and make every file change a coworker
saves reviewable before and undoable after. Wave 1 exposed what runs cost and how full their
context is; Wave 2 exposes what they *did*. It extends the existing permission system rather than
adding a new one.

## Decisions (asked 2026-09-27)

| Question | Answer |
|---|---|
| What the audit trail records | **Every tool call by every agent**: coworkers, the colleagues they consult, sub-agents. Each with its permission outcome and who decided. Persisted with a size cap, filterable, exportable. |
| How far reviewable diffs go | **Review + undo.** The approval card shows a real diff instead of raw `+`/`-` lines, and any file a coworker saved can be reverted from the work surface. Reverting asks first. |

## Today

- `PermissionManager.check` (`src/main/security/permissions.ts:59`) returns allow / ask / deny.
  An ask becomes an approval request resolved as a boolean: approved, rejected, timed out after
  5 minutes, or withdrawn when the run stops. The reason is lost; nothing is recorded anywhere.
- Tool calls happen at three places in `src/main/service.ts`: the chat run loop (`chatSend`), a
  colleague's consult (`askColleague` → `consult` → `deps.execute`), and a sub-agent
  (`runSubagent`). Only the chat loop's calls are saved (as `Message.toolCalls`); colleague and
  sub-agent calls leave no trace but their final text.
- `write_file` (`src/main/tools/registry.ts:210`) reads the old content, writes the new, and
  returns `change: FileChange` (lines added/removed, hunks). A failed read (a file over 1 MB, a
  binary file) is treated as "new file": `before = null`, so `change.created` is wrong for them.
- The approval card (`src/renderer/src/ui/ApprovalCard.tsx`) prints the diff preview as raw lines.
  The office work surface (`features/office/workspace/WorkViews.tsx`, `CodeView`) already renders
  proposals and saved changes as diff rows via `diffRows()` (`workspace/work.ts:330`).
- There is no undo. Recovery is "use version control".

## Approaches considered

**Where the audit trail lives.**
1. *An append-only JSON-lines file beside the saved state, capped* — **chosen**. It can grow large
   without bloating `platform-v1.json` or its 10-minute backups, and restoring a Wave 1 restore
   point does not rewrite history (the restore itself becomes an entry).
2. A collection in `PlatformState` — simplest, but every backup carries it and a restore rolls
   the audit trail back, which defeats its purpose.
3. Derive it from `Message.toolCalls` — impossible: colleague and sub-agent calls, and permission
   outcomes, are not in messages.

**Where undo keeps the previous content.**
1. *A checkpoint file per saved write, capped by count and size* — **chosen**. Works for any
   folder, Git or not.
2. Git (stash/commit) — only for repositories, and it touches the user's history.
3. Keep the old content on the `ToolCall` in saved state — bloats state and every backup.

## Design

### 1. Audit trail

**Entry** (`src/shared/audit.ts`, new):

```ts
export type AuditDecision =
  | 'allowed'          // policy allowed it without asking (or a session grant did)
  | 'approved'         // you approved it
  | 'approved-session' // you approved it and allowed it for the rest of the session
  | 'rejected'         // you rejected it
  | 'timed-out'        // nobody answered within 5 minutes
  | 'withdrawn'        // the run stopped while it waited
  | 'denied'           // policy refused it (outside the folders, shell off, tool off)
  | 'skipped'          // not run: bad arguments, unknown or unavailable tool, a scheduled run that can't ask
  | 'reverted';        // you undid a saved change

export interface AuditEntry {
  id: string;
  at: number;
  conversationId?: string;
  /** Who acted; for a colleague or sub-agent, on whose behalf. */
  actor: { kind: 'coworker' | 'colleague' | 'subagent' | 'chat' | 'you'; id?: string; name: string; onBehalfOf?: string };
  tool: string;
  /** What it was about: a path, a command, a connector's arguments. Never file contents; at most 300 characters. */
  subject: string;
  decision: AuditDecision;
  /** For calls that ran: whether the tool succeeded. */
  result?: 'ok' | 'error';
  /** A denial's reason, a tool's error (first 300 characters), what an undo restored. */
  detail?: string;
  toolCallId?: string;
  change?: { added: number; removed: number; created: boolean };
}
```

**Store** (`src/main/audit/log.ts`, new): `AuditLog` over `<userData>/audit/audit.jsonl`.
`record(entry)` appends one line and keeps the newest entries in memory. `list(query)` returns the
newest first, filtered by conversation, actor id, decision group, and time, paged by `before`.
The log is capped at **20,000 entries**: past 25,000 it is compacted to the newest 20,000 (rewrite
to a temp file, then rename). A damaged line is skipped on load, never fatal. Writes are queued so
entries keep their order. The file never holds file contents, prompts or model output: only the
`subject`.

**Permission outcomes.** `PermissionManager.createApprovalRequest` keeps its boolean `promise` and
gains `outcome: Promise<'approved' | 'approved-session' | 'rejected' | 'timed-out' | 'withdrawn'>`,
resolved together with it. `check()` results already carry `allow`/`deny` + reason. A call allowed
by a session grant records `allowed` with the detail "Allowed for this session".

**Recording points** (all in `service.ts`, through one private `audit(...)` helper that builds
`actor` and `subject`):
- The chat run loop: every branch that answers a call (bad arguments, colleague, planner,
  unavailable connector, unknown tool, deny, ask → outcome, executed → result).
- `askColleague`'s `execute` callback: actor `colleague`, `onBehalfOf` the asking coworker.
- `runSubagent`: actor `subagent` (its role), `onBehalfOf` the coworker whose run dispatched it
  (passed down from the chat loop's `subagentRunner`).
- Undo (below): actor `you`, decision `reverted`.

`subject` by tool: a path for file tools, the command for `run_command`/`start_process`, the
colleague and question for `ask_colleague`, the task title for planner tools, compact JSON of the
arguments (without `content`-like fields) for connector tools, all cut to 300 characters.

**IPC:** `auditList(query: AuditQuery): AuditEntry[]` and `auditExport(): Promise<boolean>`, a
save dialog writing the whole log as JSON; false when cancelled.

**UI — Settings → Activity log** (new section, after Usage). Filters in one row: coworker (any,
or one), and a decision group: *All*, *Asked you* (approved/approved-session/rejected/timed-out/
withdrawn), *Refused* (denied/rejected/timed-out/skipped), *Changes* (writes and reverts). Each row gives
the time, who (and "for <name>" when on behalf of someone), the tool in words, the subject, and
the decision as a text badge (never colour alone), plus the result when it failed. The groups
overlap on purpose: *Refused* is denied/rejected/timed-out/skipped. A row with a
`toolCallId` in a coworker conversation has "Show", which opens that coworker's work surface on
the call. "Load more" pages back. "Export…" saves the log. A footnote says the log is kept on
this computer, holds no file contents, and keeps the newest 20,000 entries.

### 2. Reviewable diffs

The approval card renders a `diff` preview with the same rows the work surface uses: a shared
`DiffLines` component (moved out of `WorkViews.tsx` into `src/renderer/src/ui/DiffLines.tsx`) over
`diffRows()`, with old/new line numbers and add/remove tints. A preview longer than 400 rows shows
the first 400 and "Show all N lines". The card's title and copy say what the tool will do in words
("Save changes to `src/app.ts`: 12 lines added, 3 removed").

### 3. Undo a saved change

**Checkpoint** (`src/main/audit/checkpoints.ts`, new). A successful `write_file` makes one
checkpoint under `<userData>/checkpoints/<toolCallId>.json`:
`{ toolCallId, conversationId, root, path, existed: boolean, before?: string, afterHash, savedAt }`.
- `write_file` stops guessing: it checks whether the file exists **before** reading it. Existing
  but unreadable (over 1 MB, binary) → the write still happens, `change.created` is false, and the
  checkpoint records `existed: true` with no `before`, so undo says it can't restore that one.
  This also fixes the wrong `created` flag today.
- `before` and `existed` travel from the tool to the service in a new `ToolHandlerResult.previous`
  field that the service keeps and never sends to the model or the window.
- Cap: the newest **500** checkpoints and **200 MB**; older ones are pruned on save.

**Revert** (`Service.revertChange(toolCallId)`, IPC `revertChange`):
1. Find the checkpoint; none → "This change can't be undone any more (only the last 500 are kept)."
   `existed` with no `before` → "Axon couldn't keep this file's previous version (it's over 1 MB
   or not text)."
2. The checkpoint's `root` must be the open project; otherwise → "Open `<root>` to undo this change."
3. Read the file now. If it differs from `afterHash`, the confirmation warns that it has changed
   since the coworker saved it and undoing replaces those later edits too.
4. Native confirmation (Cancel is the default): "Undo <coworker>'s change to `<path>`?", detail
   "Puts back the version from before <time>." or, for a file the coworker created, "Deletes the
   file they created." Cancel → rejects with "Undo cancelled.", nothing changed.
5. Restore through `Project.write`, or for a created file the new `Project.remove(path)` (same
   `safe()` checks: inside the project, no sensitive files, no symbolic links).
6. Record `reverted` in the audit log, mark the saved `ToolCall.change.revertedAt`, delete the
   checkpoint (an undo is not undone twice), save, and emit a `chat` event for the call.

The path comes only from the checkpoint, never from the window.

**UI:** in the work surface's *Changes* view, a saved write gets "Undo this change". It is hidden
for proposals; for a call without a checkpoint it reads "Can't be undone" with the reason beside
it. After undo the change shows "Undone" there and in the side panel's work summary.

## Error handling

- The audit log can never stop a run: a failed append is logged to the console and dropped.
- A checkpoint that can't be written means the change can't be undone; the write still stands,
  and the audit entry's detail says undo isn't available.
- Undo failures (file locked, project closed) report the reason and leave the checkpoint in place.

## Testing

- `AuditLog`: append and list newest first; filters; paging; compaction at the cap keeps the
  newest; a damaged line is skipped; entries survive a restart; no `content` field is ever stored.
- `PermissionManager`: each outcome (approved, approved-session, rejected, timed-out with mock
  timers, withdrawn).
- Service: a run records allowed / approved / rejected / denied / skipped entries with the right
  actor and subject; a colleague's lookups are recorded on behalf of the asker; a sub-agent's calls
  on behalf of its coworker; a write records its change stats.
- Checkpoints: a write makes one; an existing unreadable file is recorded as not restorable and is
  no longer reported as created; pruning by count.
- Revert: restores content; deletes a created file; refuses outside the open project; warns when
  the file changed since; Cancel changes nothing; records `reverted` and marks the call.
- Desktop E2E: Settings → Activity log lists the smoke run's calls.

## Out of scope

- Undo for anything but `write_file` (commands and connector actions can't be reversed by Axon).
- Partial approval (editing a proposed change before approving it).
- Syncing or sending the audit log anywhere.
