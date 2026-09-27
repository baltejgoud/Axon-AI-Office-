# Transparency Wave 1 — context meter, cost dashboard, restore points — design

- **Date:** 2026-09-27
- **Branch:** written on `feat/connectors`; implementation gets its own branch.
- **Status:** approved in chat, section by section.

## Goal

Surface state Axon already computes internally but never shows: how full the context window is,
what a run costs, and that recovery snapshots exist. This is the first of three waves addressing
gaps found in Claude Desktop / ChatGPT Desktop / Codex (2026 user complaints: hidden context usage
until auto-compaction, hidden/no cost visibility before or during a run, silent data loss after
redesigns). None of these three pieces add new autonomous behavior — they expose existing data.

Two later waves (not in this spec): multi-agent audit trail + reviewable diffs (extends the
existing permission system); shared memory notebook + scheduled background coworkers (new
subsystems with real security surface).

## Decisions (asked 2026-09-27)

| Question | Answer |
|---|---|
| Cost basis | **User-configured price per model.** No bundled price table (Axon is provider-agnostic with no official endpoint). Cost fields are optional per `ModelSpec`; unconfigured models show token counts only, never a fabricated dollar figure. |
| Restore scope | **Whole-state restore only**, v1. The existing backup system snapshots the entire `PlatformState`, not per-conversation; per-conversation extraction is out of scope here (see Future work). |
| Live cost ticker | **Estimated, reconciled.** No protocol reports true per-token cost mid-stream. Show an estimate that grows with streamed output length, then snap to the provider's actual reported `usage` at turn end. Labeled as an estimate. |

## Today

- `fitToBudget` (`src/main/history.ts:33`) trims whole turns to fit `CONTEXT_BUDGET - system.length`
  characters (`CONTEXT_BUDGET = 300000`, `src/main/service.ts:79`). This is the exact number that
  gates truncation — the ground truth for how full a conversation is — but it is computed and
  discarded; nothing outside `sendMessage` ever sees it.
- `ModelSpec` (`src/shared/types.ts:13`) already has an unused `contextWindow?: number` (tokens).
- `Message.usage?: ChatUsage` (`src/shared/types.ts:110`) holds `promptTokens`/`completionTokens`,
  set once per turn after `streamChat` resolves (`src/main/service.ts:815`). Some protocols/models
  may not report it; it stays `undefined` for that turn.
- No pricing data exists anywhere in the codebase (confirmed by search). No cost math is possible
  without new user input.
- `Repository` (`src/main/repository.ts`) writes a rolling backup of the whole `platform-v1.json`
  at startup and at most every 10 minutes (`BACKUP_EVERY_MS`), keeping the last 10
  (`BACKUPS_KEPT`). Backups live in `backupDir`, named `state-<ISO timestamp>.json`. Nothing reads
  them back today except the corruption-quarantine path, which discards rather than restores.
- Settings UI (`src/renderer/src/Settings.tsx`, `ProviderDialog.tsx`) lets a user add models by
  typing an id; `displayName` defaults to the id. No advanced per-model fields exist yet.
- `ToolApprovalRequest.preview` (`src/shared/types.ts:358`) and `DiffViewer.tsx` already exist —
  reviewable-diff groundwork is partly built, but that is Wave 2 scope, not touched here.

## Design

### 1. Context usage meter

**Shared computation** (`src/shared/context-usage.ts`, new):

```ts
export interface ContextUsage {
  usedChars: number;
  budgetChars: number;
  pct: number;              // usedChars / budgetChars, clamped [0,1]
  tokenBasis?: { usedTokens: number; windowTokens: number }; // when available
  estimated: boolean;        // true when tokenBasis is absent (character proxy only)
}
```

- Main computes this at the same point `fitToBudget` already runs (`service.ts:708`), from the
  same `requests`/`system` values — no duplicate logic, just capturing the numbers already in
  scope.
- When the resolved model has `contextWindow` set **and** the conversation's last assistant
  message has `usage.promptTokens`, populate `tokenBasis` and prefer it for `pct`. Otherwise
  `estimated: true` and `pct` comes from the character ratio.
- **Live delivery:** attach `contextUsage` to the existing `chat` IPC emit payload emitted at the
  start of each step (`service.ts:760`) and after each turn completes, so the renderer updates
  without polling.
- **On conversation open** (before any message is sent): new IPC method
  `getContextUsage(conversationId): ContextUsage | null` computes the same thing from the
  conversation's existing history, so the meter is populated immediately, not just after sending.
- **UI:** a slim bar + percentage in the conversation header (`Conversation.tsx`), always visible,
  not just a tooltip at a threshold. Hover/expand shows the raw numbers (`usedChars / budgetChars`,
  or `usedTokens / windowTokens` when known) and whether it's estimated.
- **Error handling:** if `contextWindow` is configured but grossly implausible (e.g. 0 or negative
  from a typo), fall back to the character proxy and ignore it — never divide by zero or show a
  negative/NaN percentage.

### 2. Cost / usage dashboard

**Data model additions** (`src/shared/types.ts`):

```ts
export interface ModelSpec {
  // ...existing fields
  pricePerMillionInputTokens?: number;   // USD, user-entered
  pricePerMillionOutputTokens?: number;  // USD, user-entered
}
```

No new persisted collection. Every assistant `Message` already carries `usage`, `providerId`,
`modelId`, `createdAt` — a full ledger already exists implicitly in `state.messages`. The
dashboard is a read-only aggregation, computed on demand, not maintained incrementally.

**Aggregation** (`src/main/usage-report.ts`, new): given `state.messages`, `state.providers`,
group by day / provider / model / conversation, summing `promptTokens`, `completionTokens`, and —
only where both the message's model and its price fields are known — a computed dollar cost. A
turn whose model has no configured price contributes to the token totals but a `null`/omitted
dollar figure, and the dashboard shows "no price set for this model" rather than a $0.00 that
would misrepresent an unknown cost.

**Pre-flight estimate:** immediately before `sendMessage` starts a run (`service.ts`, near line
708 where `requests` is finalized), compute the same character-count proxy already used for the
context meter, convert to an approximate token count, multiply by the model's input price, and add
worst-case completion cost using `defaultMaxTokens` × output price. Emit this as part of the
existing pre-send flow so the UI can show "~$X.XX estimated" before the call goes out. Skipped
entirely (no estimate shown) when the model has no price configured.

**Streaming "live" estimate:** as `deltaText` grows `activeAssistant.content` (`service.ts:800`),
the renderer-side estimate recomputes cost from character count so far × output price, ticking up
during generation. When the turn ends and `activeAssistant.usage` is set from the provider's actual
report, the displayed figure snaps to the exact value computed from real token counts. The UI
distinguishes "estimating…" from "actual" so nobody mistakes one for the other.

**UI:** a new "Usage" section in Settings (aggregate view: today / this week / all-time, by
model/provider, with a table of recent conversations and their cost) plus the per-conversation
running total shown next to the context meter in the conversation header. Price fields are added
to `ProviderDialog.tsx` as an optional, collapsed-by-default pair of inputs per model ("Cost per
1M input/output tokens (optional)").

### 3. Restore-point UI

**New IPC surface** (`src/main/repository.ts` gains, `src/preload`/`platform.ts` expose):

- `listBackups(): BackupSummary[]` — reads `backupDir`, and for each `state-*.json` file parses
  just enough to report `{ file, timestamp, conversations, workspaces, providers, lastMessageAt }`
  without loading the full document into the renderer process. Sorted newest first.
- `restoreBackup(file: string): void` —
  1. Validates `file` resolves inside `backupDir` (no traversal).
  2. Takes an immediate ad-hoc backup of the **current** live state first (reuses
     `Repository.backup()`), so restoring is itself undoable.
  3. Parses and runs the chosen file through the same `validate()` used by `loadValidated`
     (`repository.ts:89`); refuses on failure with a clear error, current state untouched.
  4. Writes the validated content over `platform-v1.json` and requests an app relaunch — restoring
     in place while the MCP client manager, task scheduler, and open windows hold live state
     derived from the old data is unsafe, so a clean relaunch is required rather than attempted.

**UI:** a new "Restore point" area in Settings, next to the existing local-data/security info
(README already documents that area). Lists snapshots with relative time and the before/after
summary counts from `BackupSummary`. Restoring is a destructive-style confirmation (matching the
native-confirmation pattern already used for file writes) — not a casually-reachable default
button — stating plainly that the current state will be backed up first and the app will restart.

## Testing

- `context-usage.ts`: unit tests for the pct/estimated logic — zero-length history, budget
  exceeded, `contextWindow` present vs absent, implausible `contextWindow` values.
- `usage-report.ts`: unit tests for aggregation — messages with no `usage`, models with no price,
  mixed priced/unpriced turns in one aggregation window.
- `repository.ts` additions: unit tests for `listBackups` (empty dir, corrupt backup file skipped
  not crashed) and `restoreBackup` (path traversal rejected, invalid content rejected without
  touching current state, current state backed up before overwrite).
- Manual/desktop-E2E check: open a long conversation and confirm the meter matches
  `fitToBudget`'s actual trimming point; set a model's price and confirm the Settings → Usage
  totals match a hand-computed sum for a small fixture.

## Future work (explicitly out of scope here)

- Per-conversation restore (extracting one conversation out of a whole-state backup).
- A bundled/maintained price table for well-known providers, as an alternative to manual entry.
- True per-token live cost metering, if a protocol ever exposes incremental usage during streaming.
