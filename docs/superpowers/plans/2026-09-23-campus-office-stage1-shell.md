# Campus Office — Stage 1: One-screen shell and conversation panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Axon opens maximized on the office and nothing else. Everything the old pages did that people still need (the full conversation, tool approvals, model choice, Settings, the knowledge library) works from inside the office.

**Architecture:** Extract the message, code-block, model-select and approval rendering out of `Chat.tsx` into `src/renderer/src/chat/`. The office side panel renders a full thread with those pieces. Settings and Knowledge become overlays owned by the office store. `App.tsx` renders only the office. The `Chat`, `Code`, `Agents` and `Workspaces` pages are deleted, and `Knowledge` moves to its own file. Pure logic (thread lookup, library workspace, window-state restore) goes into small modules with `node:test` coverage.

**Tech Stack:** Electron 3x + React 18 + TypeScript strict, Zustand, Vite (electron-vite), `node:test` with the TypeScript transpile hook used by `tests/office-sim.test.cjs`, Electron desktop smoke tests.

**Spec:** [docs/superpowers/specs/2026-09-23-campus-office-design.md](../specs/2026-09-23-campus-office-design.md) §4.1, §4.2, §4.11 (Stage 1 of the six increments in §6).

## Global Constraints

- The office is the only screen; no control navigates to another page (spec §1, §4.1).
- Tool approvals must be answerable from the office (spec §2 finding 4).
- No control may look more functional than it is (look-and-shell spec §1).
- Components use semantic tokens from `tokens.css`, never raw hex (look-and-shell §4.1). New office CSS goes in `features/office/office.css`.
- Disk: run tests with `TEMP`/`TMP` on `D:` (`D:\axon-tmp`).
- Every task ends with `npm run typecheck` and `npm test` green.

## Deliberate deviations from the spec (recorded here, applied in the spec's next revision)

1. The window state is stored in `window-state.json` in `userData` (main-only), not in `Settings`, so that `Settings` validation and migration stay untouched.
2. "Esc clears the selection" is dropped. The panel always shows a coworker, so there is no empty-selection state to return to. Esc closes the top overlay.
3. The knowledge library reaches conversations through a renderer-maintained **"Office Library"** workspace, whose document list mirrors all imported documents. It's used by the three Library residents (Knowledge Librarian, Research Analyst, Writer). The spec didn't cover this because it wasn't yet known that knowledge retrieval is workspace-scoped (`service.ts:195`).

## File map

| File | Responsibility |
|---|---|
| `src/renderer/src/chat/CodeBlock.tsx` (new) | fenced code block with language label and copy |
| `src/renderer/src/chat/ModelSelect.tsx` (new) | model picker pill (moved verbatim) |
| `src/renderer/src/chat/MessageView.tsx` (new) | one message: meta, thought, tool calls, markdown, error, copy |
| `src/renderer/src/chat/PendingApprovals.tsx` (new) | approval cards for one conversation, wired to `toolApprove` |
| `src/renderer/src/Knowledge.tsx` (new) | the Knowledge screen moved out of `Spaces.tsx` |
| `src/renderer/src/ui/escape.ts` (new) | shared Esc stack used by `Modal` and `Overlay` |
| `features/office/activity/thread.ts` (new) | pure: which conversation a coworker's panel shows; list of their threads |
| `features/office/activity/Conversation.tsx` (new) | the thread view in the side panel |
| `features/office/library.ts` (new) | pure `officeLibraryWorkspace()` + `syncOfficeLibrary()` |
| `features/office/shell/Overlay.tsx` (new) | modal sheet over the office |
| `src/main/windowState.ts` (new) | load/save/restore window bounds and maximized flag |
| `features/office/activity/ActivityPanel.tsx` | uses `Conversation`, overflow menu, collapsed feed |
| `features/office/activity/AgentComposer.tsx` | model pill, no-model state, fresh-thread rule, library workspace |
| `features/office/store/officeStore.ts` | `overlay`, `startFresh()` |
| `features/office/OfficeCanvas.tsx` | gear and library buttons open overlays |
| `features/office/OfficePage.tsx` | renders overlays |
| `src/renderer/src/App.tsx` | office only; shortcuts |
| `src/main/index.ts` | maximized start and remembered bounds |
| `src/renderer/src/Chat.tsx`, `Spaces.tsx` | **deleted** |
| `tests/office-panel.test.cjs` (new) | unit tests for `thread.ts`, `library.ts`, `windowState.ts` |
| `tests/office-desktop.cjs` | updated for the thread, overlays and no pages |
| `tests/electron-smoke.cjs` | updated to the office-only shell |

---

### Task 1: Pure helpers with tests (thread lookup, office library, window state)

**Files:**
- Create: `src/renderer/src/features/office/activity/thread.ts`
- Create: `src/renderer/src/features/office/library.ts`
- Create: `src/main/windowState.ts`
- Test: `tests/office-panel.test.cjs`

**Interfaces:**
- Produces: `agentThreads(conversations: Conversation[], agentId: string): Conversation[]` (newest `updatedAt` first).
- Produces: `activeThread(conversations: Conversation[], agentId: string, runtime?: { conversationId?: string; fresh?: boolean }): Conversation | undefined`.
- Produces: `OFFICE_LIBRARY_ID = 'office-library'`, `LIBRARY_RESIDENTS: readonly string[]`, `officeLibraryWorkspace(existing: Workspace | undefined, documentIds: string[], now: number): Workspace | null` (returns `null` when nothing changes), `syncOfficeLibrary(): Promise<string>`.
- Produces: `WindowState { bounds?: { x; y; width; height }; maximized: boolean }`, `restoreState(saved: unknown, displays: { x; y; width; height }[]): WindowState`, `loadWindowState(file: string, displays): WindowState`, `saveWindowState(file: string, state: WindowState): void`.

- [ ] **Step 1: Write the failing tests** in `tests/office-panel.test.cjs`:

```js
// Pure logic behind the office side panel, the office library and the window state.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const thread = require('../src/renderer/src/features/office/activity/thread.ts');
const library = require('../src/renderer/src/features/office/library.ts');
const windowState = require('../src/main/windowState.ts');

const conv = (id, agentId, updatedAt) => ({ id, agentId, updatedAt, title: id });

test('agentThreads lists only that coworker, newest first', () => {
  const list = [conv('a', 'writer', 1), conv('b', 'designer', 5), conv('c', 'writer', 9)];
  assert.deepEqual(thread.agentThreads(list, 'writer').map((c) => c.id), ['c', 'a']);
});

test('activeThread prefers the runtime conversation, then the newest thread', () => {
  const list = [conv('a', 'writer', 1), conv('c', 'writer', 9)];
  assert.equal(thread.activeThread(list, 'writer', { conversationId: 'a' }).id, 'a');
  assert.equal(thread.activeThread(list, 'writer', {}).id, 'c');
  assert.equal(thread.activeThread(list, 'writer', undefined).id, 'c');
});

test('activeThread returns nothing when a fresh thread was requested', () => {
  const list = [conv('a', 'writer', 1)];
  assert.equal(thread.activeThread(list, 'writer', { fresh: true }), undefined);
});

test('activeThread ignores a runtime conversation that was deleted', () => {
  const list = [conv('a', 'writer', 1)];
  assert.equal(thread.activeThread(list, 'writer', { conversationId: 'gone' }).id, 'a');
});

test('officeLibraryWorkspace creates the library with every document', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1', 'd2'], 100);
  assert.equal(w.id, library.OFFICE_LIBRARY_ID);
  assert.deepEqual(w.knowledgeDocIds, ['d1', 'd2']);
  assert.equal(w.createdAt, 100);
  assert.equal(w.fileAccess.enabled, false);
});

test('officeLibraryWorkspace returns null when the documents already match', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1', 'd2'], 100);
  assert.equal(library.officeLibraryWorkspace(w, ['d2', 'd1'], 200), null);
});

test('officeLibraryWorkspace updates the documents and keeps createdAt', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1'], 100);
  const next = library.officeLibraryWorkspace(w, ['d1', 'd3'], 200);
  assert.deepEqual(next.knowledgeDocIds, ['d1', 'd3']);
  assert.equal(next.createdAt, 100);
  assert.equal(next.updatedAt, 200);
});

test('library residents are the three Library coworkers', () => {
  assert.deepEqual([...library.LIBRARY_RESIDENTS].sort(), ['knowledge-librarian', 'research-analyst', 'writer']);
});

const display = { x: 0, y: 0, width: 1920, height: 1040 };

test('restoreState defaults to maximized with no bounds', () => {
  assert.deepEqual(windowState.restoreState(undefined, [display]), { maximized: true });
  assert.deepEqual(windowState.restoreState({ nonsense: 1 }, [display]), { maximized: true });
});

test('restoreState keeps normal bounds that are on a screen', () => {
  const saved = { maximized: false, bounds: { x: 100, y: 80, width: 1200, height: 800 } };
  assert.deepEqual(windowState.restoreState(saved, [display]), saved);
});

test('restoreState drops bounds that are off every screen or too small', () => {
  const off = { maximized: false, bounds: { x: 5000, y: 80, width: 1200, height: 800 } };
  assert.deepEqual(windowState.restoreState(off, [display]), { maximized: false });
  const tiny = { maximized: false, bounds: { x: 0, y: 0, width: 200, height: 100 } };
  assert.deepEqual(windowState.restoreState(tiny, [display]), { maximized: false });
});

test('load and save round-trip through a file and survive corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-window-'));
  try {
    const file = path.join(dir, 'window-state.json');
    assert.deepEqual(windowState.loadWindowState(file, [display]), { maximized: true });
    const state = { maximized: false, bounds: { x: 10, y: 10, width: 1300, height: 850 } };
    windowState.saveWindowState(file, state);
    assert.deepEqual(windowState.loadWindowState(file, [display]), state);
    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(windowState.loadWindowState(file, [display]), { maximized: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `TEMP='D:\axon-tmp' TMP='D:\axon-tmp' node --test tests/office-panel.test.cjs`
Expected: FAIL with `Cannot find module '.../activity/thread.ts'`.

- [ ] **Step 3: Implement `activity/thread.ts`**

```ts
import type { Conversation } from '../../../../../shared/types';

type Thread = Pick<Conversation, 'id' | 'agentId' | 'updatedAt'>;

/** Every conversation with this coworker, newest first. */
export function agentThreads<T extends Thread>(conversations: readonly T[], agentId: string): T[] {
  return conversations
    .filter((conversation) => conversation.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The conversation the side panel shows: the one the office is tracking for this coworker if it
 * still exists, otherwise their newest. Nothing when the user asked for a fresh thread.
 */
export function activeThread<T extends Thread>(
  conversations: readonly T[],
  agentId: string,
  runtime?: { conversationId?: string; fresh?: boolean }
): T | undefined {
  if (runtime?.fresh) return undefined;
  const tracked = conversations.find((c) => c.id === runtime?.conversationId);
  return tracked ?? agentThreads(conversations, agentId)[0];
}
```

- [ ] **Step 4: Implement `library.ts`**

```ts
import type { Workspace } from '../../../../shared/types';
import { useApp } from '../../state';

export const OFFICE_LIBRARY_ID = 'office-library';
/** The coworkers who work in the Library and can search imported documents. */
export const LIBRARY_RESIDENTS: readonly string[] = ['knowledge-librarian', 'research-analyst', 'writer'];

/**
 * The workspace through which the Library's coworkers reach every imported document. Knowledge
 * retrieval is scoped to a conversation's workspace, and the office has no other workspace UI.
 * Returns null when the saved workspace already lists exactly these documents.
 */
export function officeLibraryWorkspace(
  existing: Workspace | undefined,
  documentIds: string[],
  now: number
): Workspace | null {
  const ids = [...documentIds].sort();
  if (existing && [...existing.knowledgeDocIds].sort().join('\n') === ids.join('\n')) return null;
  return {
    id: OFFICE_LIBRARY_ID,
    name: 'Office Library',
    description: 'Documents the Library can search.',
    icon: '📚',
    systemPrompt: '',
    instructions: '',
    defaultProviderId: null,
    defaultModelId: null,
    enabledTools: [],
    knowledgeDocIds: ids,
    skillIds: [],
    roleIds: [],
    fileAccess: { enabled: false, roots: [] },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

/** Brings the Office Library in line with the imported documents; returns its id. */
export async function syncOfficeLibrary(): Promise<string> {
  const data = useApp.getState().data;
  if (!data) return OFFICE_LIBRARY_ID;
  const next = officeLibraryWorkspace(
    data.workspaces.find((w) => w.id === OFFICE_LIBRARY_ID),
    data.documents.map((d) => d.id),
    Date.now()
  );
  if (next) {
    await window.axon.workspaceSave(next);
    await useApp.getState().refresh();
  }
  return OFFICE_LIBRARY_ID;
}
```

Before writing it, check `Workspace` in `src/shared/types.ts` and match every required field exactly (add `builtin` only if required). The unit test imports `library.ts`, which imports `state.ts`, which imports `zustand`; that works in Node. `window` is only touched inside `syncOfficeLibrary`, which the test doesn't call.

- [ ] **Step 5: Implement `src/main/windowState.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  bounds?: Rect;
  maximized: boolean;
}

const MIN_WIDTH = 980;
const MIN_HEIGHT = 680;
const isRect = (value: unknown): value is Rect =>
  !!value &&
  typeof value === 'object' &&
  ['x', 'y', 'width', 'height'].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

/** Validates saved state: maximized unless the user left it restored, bounds only if visible and usable. */
export function restoreState(saved: unknown, displays: Rect[]): WindowState {
  if (!saved || typeof saved !== 'object' || typeof (saved as WindowState).maximized !== 'boolean')
    return { maximized: true };
  const { maximized, bounds } = saved as WindowState;
  if (!isRect(bounds) || bounds.width < MIN_WIDTH || bounds.height < MIN_HEIGHT) return { maximized };
  const visible = displays.some(
    (d) =>
      bounds.x + 100 <= d.x + d.width &&
      bounds.x + bounds.width - 100 >= d.x &&
      bounds.y >= d.y - 10 &&
      bounds.y + 40 <= d.y + d.height
  );
  return visible ? { maximized, bounds } : { maximized };
}

export function loadWindowState(file: string, displays: Rect[]): WindowState {
  try {
    return restoreState(JSON.parse(readFileSync(file, 'utf8')), displays);
  } catch {
    return { maximized: true };
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // Losing the window size is harmless; never block quitting over it.
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `TEMP='D:\axon-tmp' TMP='D:\axon-tmp' node --test tests/office-panel.test.cjs`
Expected: PASS, 11 tests.

- [ ] **Step 7: Typecheck, full test run, commit**

```bash
npm run typecheck && TEMP='D:\axon-tmp' TMP='D:\axon-tmp' npm test
git add tests/office-panel.test.cjs src/main/windowState.ts src/renderer/src/features/office/activity/thread.ts src/renderer/src/features/office/library.ts
git commit -m "feat(office): thread lookup, office library and window-state helpers"
```

---

### Task 2: Extract chat rendering into `chat/`

**Files:**
- Create: `src/renderer/src/chat/CodeBlock.tsx`, `chat/ModelSelect.tsx`, `chat/MessageView.tsx`, `chat/PendingApprovals.tsx`
- Modify: `src/renderer/src/Chat.tsx` (import the extracted pieces; still exists until Task 5)

**Interfaces:**
- Produces: `CodeBlock({ children?: ReactNode })`.
- Produces: `ModelSelect({ value: string; onChange: (v: string) => void; disabled?: boolean; size?: 'sm' | 'md' })`, unchanged.
- Produces: `MessageView({ message: Message; authorName?: string; actions?: ReactNode })`. It renders `<article className="message {role}">` exactly as `Chat.tsx:563-686` does, minus the Regenerate/Edit buttons, which the caller passes in `actions`. The Copy button stays inside `MessageView`.
- Produces: `PendingApprovals({ conversationId: string | null })`, which renders the `ApprovalCard`s for that conversation and handles the decision exactly as `Chat.tsx:688-705`.

- [ ] **Step 1: Create `chat/CodeBlock.tsx`.** Move `textOf` and `CodeBlock` from `Chat.tsx:181-219` verbatim and add `export` to `CodeBlock`. Imports: `useState, type ReactNode` from react; `Check, Copy` from lucide-react; `useApp` from `../state`; `Icon` from `../ui`.

- [ ] **Step 2: Create `chat/ModelSelect.tsx`.** Move `Chat.tsx:46-86` verbatim. Imports: `ChevronDown` from lucide-react; `useApp` from `../state`; `Icon` from `../ui`.

- [ ] **Step 3: Create `chat/MessageView.tsx`**

```tsx
import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Sparkles, User, Wrench } from 'lucide-react';
import type { Message } from '../../../shared/types';
import { perform } from '../state';
import { timeAgo } from '../format';
import { Button, Icon } from '../ui';
import { CodeBlock } from './CodeBlock';

/** One message in a thread: meta line, thought, tool calls, markdown body and actions. */
export function MessageView({
  message: m,
  authorName = 'Axon',
  actions
}: {
  message: Message;
  authorName?: string;
  actions?: ReactNode;
}) {
  return (
    <article className={`message ${m.role}${m.streaming ? ' streaming' : ''}`}>
      <div className="message-avatar">
        <Icon icon={m.role === 'user' ? User : Sparkles} size="sm" />
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{m.role === 'user' ? 'You' : authorName}</strong>
          <span className="text-caption" title={new Date(m.createdAt).toLocaleString()}>
            {timeAgo(m.createdAt)}
          </span>
          {m.streaming && (
            <span className="message-status">
              <span className="thinking-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Generating
            </span>
          )}
        </div>
        {m.thought && (
          <details className="thought-block">
            <summary>Thought process</summary>
            <div className="thought-content">{m.thought}</div>
          </details>
        )}
        {m.toolCalls && m.toolCalls.length > 0 && (
          <div className="tool-calls">
            {m.toolCalls.map((tc) => (
              <details key={tc.id} className="tool-call-item">
                <summary className="tool-call-summary">
                  <span className="tool-call-name">
                    <Icon icon={Wrench} size="sm" />
                    <strong>{tc.name}</strong>
                  </span>
                  <span className={`tool-call-status ${tc.error ? 'failed' : tc.result ? 'completed' : 'running'}`}>
                    {tc.error ? 'Failed' : tc.result ? 'Completed' : 'Running…'}
                  </span>
                </summary>
                <div className="tool-call-body">
                  <div className="tool-call-label">Arguments</div>
                  <pre className="tool-call-pre">{tc.arguments}</pre>
                  {tc.result && (
                    <>
                      <div className="tool-call-label">Result</div>
                      <pre className="tool-call-pre scrollable">{tc.result}</pre>
                    </>
                  )}
                  {tc.error && <div className="tool-call-error">{tc.error}</div>}
                </div>
              </details>
            ))}
          </div>
        )}
        <div className="message-content">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              img: ({ alt }) => <span>[Image: {alt}]</span>,
              a: ({ children }) => <span className="message-link">{children}</span>,
              pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
            }}
          >
            {m.role === 'user'
              ? m.content.split('\n\n<attachment')[0].split('\n\nFile context: ')[0]
              : m.content || (m.streaming ? (m.thought ? 'Generating response…' : 'Thinking…') : '')}
          </Markdown>
        </div>
        {m.error && <p className="message-error">{m.error}</p>}
        {(actions || (m.role === 'assistant' && m.content && !m.streaming)) && (
          <div className="message-actions">
            {m.role === 'assistant' && m.content && !m.streaming && (
              <Button
                variant="ghost"
                size="sm"
                icon={Copy}
                onClick={() => void perform(() => navigator.clipboard.writeText(m.content), 'Copied to clipboard')}
              >
                Copy
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </article>
  );
}
```

Check `Message` in `src/shared/types.ts` for `thought`, `toolCalls`, `error` and `streaming` (they're used by `Chat.tsx`, so they exist). Then add CSS for `.tool-call-name` (`display:flex; align-items:center; gap:var(--space-2)`) and `.tool-call-error` (`color:var(--danger-text); margin-top:var(--space-2)`) next to the existing `.tool-call-*` rules in `style.css`. Those rules replace the inline styles in `Chat.tsx`.

- [ ] **Step 4: Create `chat/PendingApprovals.tsx`**

```tsx
import { useApp } from '../state';
import { ApprovalCard } from '../ui/ApprovalCard';

/** Tool calls in this conversation that are waiting for the user's decision. */
export function PendingApprovals({ conversationId }: { conversationId: string | null }) {
  const pendingApprovals = useApp((s) => s.pendingApprovals);
  if (!conversationId) return null;
  return (
    <>
      {Object.values(pendingApprovals)
        .filter((request) => request.conversationId === conversationId)
        .map((request) => (
          <ApprovalCard
            key={request.id}
            request={request}
            onDecision={(approved, alwaysAllowSession) => {
              const next = { ...useApp.getState().pendingApprovals };
              delete next[request.id];
              useApp.getState().patch({ pendingApprovals: next });
              void window.axon.toolApprove({ requestId: request.id, approved, alwaysAllowSession });
            }}
          />
        ))}
    </>
  );
}
```

- [ ] **Step 5: Point `Chat.tsx` at the extracted pieces.** Delete its `ModelSelect`, `textOf` and `CodeBlock` definitions. Replace the message `<article>` map with `<MessageView message={m} actions={…Regenerate/Edit buttons…} />`, and the approvals map with `<PendingApprovals conversationId={chatId} />`. Import `ModelSelect` from `./chat/ModelSelect`, and re-export it (`export { ModelSelect } from './chat/ModelSelect';`) so `Spaces.tsx` keeps compiling until Task 5. Remove the now-unused imports.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && TEMP='D:\axon-tmp' TMP='D:\axon-tmp' npm test && npm run build`
Expected: all green.

```bash
git add src/renderer/src/chat src/renderer/src/Chat.tsx src/renderer/src/style.css
git commit -m "refactor(chat): extract message, code block, model select and approvals"
```

---

### Task 3: Conversation thread, model pill and fresh threads in the side panel

**Files:**
- Create: `src/renderer/src/features/office/activity/Conversation.tsx`
- Modify: `features/office/activity/ActivityPanel.tsx`, `features/office/activity/AgentComposer.tsx`, `features/office/store/officeStore.ts`, `features/office/office.css`

**Interfaces:**
- Consumes: `activeThread`, `agentThreads` (Task 1); `MessageView`, `PendingApprovals`, `ModelSelect` (Task 2); `LIBRARY_RESIDENTS`, `syncOfficeLibrary` (Task 1).
- Produces (store): `AgentRuntime.fresh?: boolean`; `startFresh(agentId: string): void` sets `{ conversationId: undefined, fresh: true, currentTask: undefined, lastResponse: undefined, status: 'idle' }`; `setAgentConversation(agentId, id)` also clears `fresh`; `overlay: 'settings' | 'knowledge' | null`; `openOverlay(o: 'settings' | 'knowledge' | null): void`.
- Produces: `Conversation({ agentId: string; agentName: string; conversation: Conversation | undefined })`.

- [ ] **Step 1: Store changes** in `officeStore.ts`. Add `fresh?: boolean` to `AgentRuntime`; add `overlay` + `openOverlay`; add `startFresh`; make `setAgentConversation` set `fresh: false`. Leave `activeWing` in place (Stage 2 removes it).

```ts
  overlay: null as 'settings' | 'knowledge' | null,
  openOverlay: (overlay) => set({ overlay }),
  startFresh: (agentId) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: { ...current, conversationId: undefined, fresh: true, currentTask: undefined, lastResponse: undefined, status: 'idle' }
      }
    });
  },
```

- [ ] **Step 2: Create `Conversation.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import type { Conversation as Thread } from '../../../../../shared/types';
import { useApp } from '../../../state';
import { MessageView } from '../../../chat/MessageView';
import { PendingApprovals } from '../../../chat/PendingApprovals';

/** The whole thread with the selected coworker, following new output unless the user scrolled up. */
export function Conversation({ agentName, conversation }: { agentName: string; conversation: Thread | undefined }) {
  const messages = useApp((s) =>
    conversation ? s.data?.messages.filter((m) => m.conversationId === conversation.id && m.role !== 'system') : undefined
  ) ?? [];
  const pending = useApp((s) =>
    Object.values(s.pendingApprovals).filter((r) => r.conversationId === conversation?.id).length
  );
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const scroller = useRef<HTMLElement | null>(null);

  useEffect(() => {
    follow.current = true;
  }, [conversation?.id]);
  useEffect(() => {
    if (follow.current) end.current?.scrollIntoView({ block: 'end' });
  }, [messages.map((m) => m.content.length + (m.toolCalls?.length ?? 0)).join(','), pending]);
  useEffect(() => {
    const el = end.current?.closest<HTMLElement>('.activity-body') ?? null;
    scroller.current = el;
    if (!el) return;
    const onScroll = () => {
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  if (!messages.length && !pending) return <div ref={end} />;
  return (
    <section className="office-thread" aria-label={`Conversation with ${agentName}`}>
      <div className="messages">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} authorName={agentName} />
        ))}
        <PendingApprovals conversationId={conversation?.id ?? null} />
      </div>
      <div ref={end} />
    </section>
  );
}
```

Zustand `useApp` with a selector that returns a new array re-renders on every store change. That's acceptable here, but to avoid render loops use `useShallow` from `zustand/react/shallow` around both selectors if React warns about "getSnapshot should be cached". Verify in the running app during Step 6.

- [ ] **Step 3: Rewrite the body of `ActivityPanel.tsx`.** Keep the header and hero. Replace the `current-task-card`, `response-preview-box` and "Open full conversation" sections with:
  1. an intro card, shown only when there's no conversation: the agent description and capability chips (the existing markup under "Let's make progress");
  2. `<Conversation agentName={agent.name} conversation={conversation} />`;
  3. the Recent updates feed, showing the first 3 activities plus a "Show all (n)" toggle button (`useState`), with the empty state unchanged.

  Use `const conversation = activeThread(data?.conversations ?? [], agent.id, runtime);`. Add a header overflow button (`MoreHorizontal`, `aria-label="Conversation options"`) that opens a small menu (`role="menu"`) with "New conversation" (calls `startFresh(agent.id)`), then up to 8 earlier threads from `agentThreads()` labelled with title + `timeAgo(updatedAt)` (calls `setAgentConversation(agent.id, id)`). It closes on outside click or Esc. For Library residents, the menu also has "Manage library" (`openOverlay('knowledge')`). Remove `openConversation` and the `patch({ page: 'chat' })` call.

- [ ] **Step 4: Composer changes** in `AgentComposer.tsx`:
  - Thread choice: replace the `existing` lookup with `activeThread(data?.conversations ?? [], agentId, runtime)`, so a fresh request creates a new conversation.
  - Model: under the textarea row, add `<ModelSelect size="sm" value={conversation ? `${conversation.providerId}::${conversation.modelId}` : model} disabled={Boolean(conversation)} onChange={(v) => patch({ model: v })} />`. Its title is "Model for this conversation" when enabled and "Start a new conversation to change model" when disabled.
  - No model: when `!model && !conversation`, replace the send button's area with a `button.composer-connect` "Connect a model" that calls `useOfficeStore.getState().openOverlay('settings')`. The textarea stays usable.
  - Library: when creating a conversation for an agent in `LIBRARY_RESIDENTS`, use `workspaceId = await syncOfficeLibrary()`. For existing Library conversations, call `syncOfficeLibrary()` before `chatSend` so newly imported documents are searchable.
  - Remove `patch({ chatId: convId })`: the office no longer drives the Chat page.

- [ ] **Step 5: CSS** in `office.css`, all tokens:
  - `.office-thread` spaces its messages at `var(--space-3)` and resets the chat page's max-width.
  - `.office-thread .message` becomes a compact card: avatar 24px, body font `var(--text-sm)` (use the existing token names in `tokens.css`), code blocks scroll horizontally, `pre { max-height: 320px; overflow: auto }`.
  - `.office-thread .message.user .message-body` gets `background: var(--surface-hover); border-radius: var(--radius-md); padding: var(--space-2) var(--space-3)`.
  - `.activity-menu` and `.activity-menu [role=menuitem]` are the overflow menu (raised surface, shadow, 36px rows).
  - `.composer-model-row` is a flex row under the textarea, and `.composer-connect` is an accent-soft pill button.
  - `.activity-feed-more` is a ghost text button.

- [ ] **Step 6: Verify in the running app**

Run: `npm run typecheck && TEMP='D:\axon-tmp' TMP='D:\axon-tmp' npm test && npm run build`
Then run `npm run dev` (via the preview tool), select a coworker, send a task with the fixture or real provider, and confirm the thread renders, streams and scrolls; "New conversation" empties the thread and the next send creates a second conversation; the model pill locks once a conversation exists.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/features/office
git commit -m "feat(office): full conversation thread, approvals, model pill and fresh threads in the side panel"
```

---

### Task 4: Office-only shell with Settings and Knowledge overlays; delete the old pages

**Files:**
- Create: `src/renderer/src/ui/escape.ts`, `src/renderer/src/features/office/shell/Overlay.tsx`, `src/renderer/src/Knowledge.tsx`
- Modify: `src/renderer/src/ui/index.tsx` (Modal uses `escape.ts`), `App.tsx`, `features/office/OfficePage.tsx`, `features/office/OfficeCanvas.tsx`, `features/office/office.css`, `src/renderer/src/state.ts` (`page` comment and default only)
- Delete: `src/renderer/src/Chat.tsx`, `src/renderer/src/Spaces.tsx`

**Interfaces:**
- Produces: `pushEscape(handler: () => void): () => void` (returns an unregister function); `useEscape(handler: () => void, active = true): void`.
- Produces: `Overlay({ title: string; onClose: () => void; children: ReactNode; wide?: boolean })`.
- Produces: `Knowledge()` from `src/renderer/src/Knowledge.tsx`, the same component as before, moved.

- [ ] **Step 1: `ui/escape.ts`.** Move `escapeStack`/`bindEscape` out of `ui/index.tsx`:

```ts
import { useEffect, useRef } from 'react';

const stack: (() => void)[] = [];
let bound = false;

/** Registers an Esc handler; only the most recently registered one runs. */
export function pushEscape(handler: () => void): () => void {
  if (!bound) {
    bound = true;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && stack.length) {
        event.preventDefault();
        stack[stack.length - 1]();
      }
    });
  }
  stack.push(handler);
  return () => {
    const index = stack.lastIndexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current());
  }, [active]);
}
```

In `Modal`, replace the escape-stack code with `useEscape(onClose)`, keeping the first-field focus effect.

- [ ] **Step 2: `shell/Overlay.tsx`**

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useEscape } from '../../../ui/escape';

/** A sheet over the office for Settings and the library. Esc or the close button dismisses it. */
export function Overlay({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="office-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        className={`office-overlay-panel ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="office-overlay-header">
          <h2 id={titleId}>{title}</h2>
          <button className="office-overlay-close" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="office-overlay-body">{children}</div>
      </div>
    </div>
  );
}
```

Focus trap: add a `keydown` handler on the panel that wraps Tab or Shift+Tab between the first and last focusable elements (`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`).

- [ ] **Step 3: `Knowledge.tsx`.** Move `Knowledge` from `Spaces.tsx:516-813` (up to the line before `export function Code`) together with only the imports it uses. After each import or delete, call `syncOfficeLibrary()` (import from `./features/office/library`) inside the same `perform` task, so the Library coworkers see changes immediately. Drop its `PageHeader` wrapper `page`/`page-inner` divs and render the header actions (Import documents) at the top of the body, because the Overlay supplies the title.

- [ ] **Step 4: `OfficePage.tsx` renders overlays**

```tsx
import './office.css';
import { OfficeCanvas } from './OfficeCanvas';
import { ActivityPanel } from './activity/ActivityPanel';
import { Overlay } from './shell/Overlay';
import { useOfficeStore } from './store/officeStore';
import { SettingsPanel } from '../../Settings';
import { Knowledge } from '../../Knowledge';

export function OfficePage() {
  const overlay = useOfficeStore((s) => s.overlay);
  const close = () => useOfficeStore.getState().openOverlay(null);
  return (
    <div className="office-container">
      <OfficeCanvas />
      <ActivityPanel />
      {overlay === 'settings' && (
        <Overlay title="Settings" onClose={close} wide>
          <SettingsPanel />
        </Overlay>
      )}
      {overlay === 'knowledge' && (
        <Overlay title="Library" onClose={close} wide>
          <Knowledge />
        </Overlay>
      )}
    </div>
  );
}
```

If `SettingsPanel` renders its own page title and `page` wrappers, remove the outer `page` wrapper there too (keep the tabs). Check it still fits a 960px-wide sheet.

- [ ] **Step 5: `OfficeCanvas.tsx`.** The gear calls `useOfficeStore.getState().openOverlay('settings')`, keeping `aria-label="Office settings"`. Add a library button (`BookOpen`, `aria-label="Open library"`) before the gear that calls `openOverlay('knowledge')`. Remove the `useApp`/`patch` import if unused.

- [ ] **Step 6: `App.tsx`.** Remove the `Chat`, `SettingsPanel`, `Spaces` and `Building2` imports, the "Back to your office" button and all `page === …` branches except the office. Render `<OfficePage />` unconditionally. Shortcuts: Ctrl+K focuses `[aria-label="Find a coworker"]`; Ctrl+, calls `useOfficeStore.getState().openOverlay('settings')`; delete the Ctrl+N handler. Leave the stream handling as is.

- [ ] **Step 7: Delete `Chat.tsx` and `Spaces.tsx`**, then `grep -rn "Spaces'\|/Chat'\|page: '" src/renderer/src` and fix any leftovers. Delete the `ModelSelect` re-export along with `Chat.tsx`.

- [ ] **Step 8: CSS for overlays** in `office.css`:
  - `.office-overlay`: fixed inset 0, `background: rgb(15 23 42 / .28)`, `backdrop-filter: blur(3px)`, grid centered, `z-index: 50`, fade-in 160ms (none under reduced motion).
  - `.office-overlay-panel`: `width: min(720px, 100vw - 32px)`, or 960px with `.wide`; `max-height: calc(100vh - 64px)`; `background: var(--surface-raised)`; `border-radius: var(--radius-xl)`; shadow; flex column; scale-in from .98.
  - The header is sticky with a title and the close button; the body scrolls.

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && TEMP='D:\axon-tmp' TMP='D:\axon-tmp' npm test && npm run build`
In the running app: the gear opens Settings, Esc closes it; an edit-provider modal inside Settings closes on Esc without closing Settings; the library button opens the Library; Ctrl+, opens Settings; nothing navigates away from the office.

```bash
git add -A src/renderer/src
git commit -m "feat(shell): office-only app with Settings and Library overlays; remove old pages"
```

---

### Task 5: Open maximized and remember the window

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `loadWindowState`, `saveWindowState`, `WindowState` (Task 1).

- [ ] **Step 1: Wire it into `createWindow`**

```ts
import { app, BrowserWindow, ipcMain, session, dialog, screen } from 'electron';
import { loadWindowState, saveWindowState } from './windowState';
// …
function createWindow(): void {
  const stateFile = join(app.getPath('userData'), 'window-state.json');
  const saved = loadWindowState(stateFile, screen.getAllDisplays().map((d) => d.workArea));
  window = new BrowserWindow({ ...(saved.bounds ?? { width: 1380, height: 900 }), minWidth: 980, minHeight: 680, show: false,
    title: 'Axon — AI Studio', backgroundColor: '#f7f8fa', autoHideMenuBar: true,
    webPreferences: { /* unchanged */ } });
  // …
  window.once('ready-to-show', () => {
    if (saved.maximized) window?.maximize();
    window?.show();
  });
  window.on('close', () => {
    if (!window) return;
    saveWindowState(stateFile, { maximized: window.isMaximized(), bounds: window.getNormalBounds() });
  });
```

`#f7f8fa` is the light `--surface-sidebar` from the look-and-shell palette. Light is the default theme, so first paint no longer flashes dark.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`. Launch `npm start`: the window opens maximized. Un-maximize it, resize, quit and relaunch: it reopens at that size. Maximize, quit and relaunch: it opens maximized.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(window): open maximized and remember size and position"
```

---

### Task 6: Update the desktop checks

**Files:**
- Modify: `tests/office-desktop.cjs`, `tests/electron-smoke.cjs`

- [ ] **Step 1: `office-desktop.cjs`.** Keep the existing flow and change these steps:
  - After the analyst task completes, replace the `.response-preview-box` assertions with: `.office-thread .message.assistant` contains "existing provider pipeline", and `.office-thread .message.user` contains "Confirm the office provider connection."
  - Assert `document.querySelector('.return-to-office') === null`.
  - Model pill: before the first send, `.activity-composer [aria-label="AI model"]` exists and is enabled; after sending, it's disabled.
  - Fresh thread: open `[aria-label="Conversation options"]`, click "New conversation", and assert `.office-thread` is gone. Send "Second thread" and assert the snapshot has two conversations for `research-analyst`.
  - Overlays: click `[aria-label="Office settings"]` and assert `.office-overlay [role=dialog]` with the heading "Settings". Dispatch `keydown` Escape on `window` and assert the overlay is gone. Click `[aria-label="Open library"]` and assert the heading "Library", then close it.
  - Update the Files desk and backend steps, which currently read `.response-preview-box`, to read `.office-thread` instead.
  - Update the PASS line to list the new checks.

- [ ] **Step 2: `electron-smoke.cjs`.** Read it, then replace its expectations of `.welcome-workspace` and the sidebar with the office equivalents: wait for `.office-viewport`, assert there's no `.sidebar`, assert the gear opens the Settings overlay, and keep any IPC/isolation checks it has.

- [ ] **Step 3: Run both**

Run: `npm run build && npx electron tests/office-desktop.cjs && npx electron tests/electron-smoke.cjs`
Expected: `OFFICE_CHECK_PASS` and the smoke PASS line. Look at the screenshots in `test-results/office/` (`office-response.png`, `office-dark.png`) to check the thread visually.

- [ ] **Step 4: Commit**

```bash
git add tests/office-desktop.cjs tests/electron-smoke.cjs
git commit -m "test(office): desktop checks for the thread, overlays and office-only shell"
```

---

## Self-review

- Spec §4.1: maximized start (Task 5), office-only and pages removed (Task 4), overlays (Task 4), shortcuts (Task 4), `page` collapsed (Task 4). Deviations 1 and 2 are recorded above.
- Spec §4.2: thread with markdown, code, tools and approvals (Tasks 2–3), collapsed feed (Task 3), model pill with the read-only rule (Task 3), New conversation and earlier threads (Task 3), no-model button (Task 3). File chips from Hand-to are Stage 5.
- Spec §4.11: no model configured (Task 3). The rest belongs to later stages.
- Names: `startFresh`, `openOverlay`, `overlay`, `activeThread`, `agentThreads`, `syncOfficeLibrary`, `LIBRARY_RESIDENTS`, `OFFICE_LIBRARY_ID`, `pushEscape`, `useEscape`, `loadWindowState`, `saveWindowState`, `restoreState` are used consistently across tasks.
