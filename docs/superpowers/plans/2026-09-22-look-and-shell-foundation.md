# Look & Shell — Foundation (extraction + tokens/theme/fonts/data) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for the look-and-shell redesign without changing what the app looks like structurally: split the two oversized files (`Chat.tsx`, `Spaces.tsx`) into focused pieces with identical behavior, and switch the whole app onto the spec's light-first token palette with a working, reactive theme system and a `profile`/`uiVersion` settings shape. This is phases 1–2 of the 6-phase delivery order in the spec (extraction; tokens/theme/fonts/data). Phases 3–6 (window chrome, shell, home/composer restyle, other pages, hygiene pass) are separate plans built on top of this one.

**Architecture:** Two independent groups of tasks, run in order:
- **Group A (extraction):** mechanically move code out of `Chat.tsx` (970 lines) into a new `chat/` directory (`starters.ts`, `ModelSelect.tsx`, `CodeBlock.tsx`, `Message.tsx`, `MessageList.tsx`, `Home.tsx`, `Composer.tsx`), and out of `Spaces.tsx` (1087 lines) into a new `Code.tsx`. Every extracted piece keeps its exact current markup, class names, and event logic — state ownership stays where it is today (the parent), passed down as props. Nothing should look or behave differently after Group A; `npm test` and `npm run typecheck` are the only safety net (there is no visual checkpoint here).
- **Group B (tokens/theme/fonts/data):** re-point `tokens.css`'s semantic layer to the spec's light-first palette (this **does** change the app's colors, app-wide, immediately), fix the theme toggle's reactivity bug, bundle Inter/Caveat locally, and add `Settings.profile`/`uiVersion` with a one-time migration.

**Tech Stack:** Electron + React 18 + TypeScript (strict), Zustand (`state.ts`), Vite, `node:test` for unit tests (no DOM), Prettier (single quotes, no semicolons removed — see `.prettierrc`).

**Spec:** [docs/superpowers/specs/2026-09-21-look-and-shell-design.md](../specs/2026-09-21-look-and-shell-design.md) — this plan implements §3 "In scope" items "Theme system, tokens, bundled fonts" and the extraction prerequisite named in §4.12 and §6 (risks). Read §4.1 (tokens), §4.11 (data changes) and §4.12 (code structure) alongside this plan.

## Global Constraints

- **Light is the default theme** (spec §4.1). `tokens.css`'s bare `:root` holds the light values; dark values move under `:root[data-theme='dark']`. `initialState()`'s default `theme` becomes `'light'`.
- `tokens.css` keeps its three layers (primitive → semantic → component); components reference **semantic tokens only**, never primitives or literals. The dead `--axon-*` block is deleted.
- Font packages (`@fontsource-variable/inter`, `@fontsource/caveat`) are renderer build-time dependencies → `devDependencies`, same tier as `lucide-react`. No runtime network access; the CSP has no `font-src`.
- `Settings.uiVersion` is **owned by main**, never trusted from the renderer — `settingsSave` always writes back `this.state.settings.uiVersion`, ignoring whatever the caller sent.
- `Settings.profile` fields are trimmed; `name` ≤ 60 chars, `email` ≤ 120 chars and loosely valid or blank.
- No control may be made to *look* more functional than it is (spec §1) — Group A/B touch no control's affordances, only where the code that renders them lives and what colors they use.
- **Disk:** `C:` has been at 0 bytes free earlier in this session. Before running `npm test` or `npm install`, set `TEMP`/`TMP` (and, for installs, `npm_config_cache`) to a folder on `D:` — `D:\axon-tmp` and `D:\axon-npm-cache` already exist. Example: `TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test` (bash) or `$env:TEMP='D:\axon-tmp'; $env:TMP='D:\axon-tmp'; npm test` (PowerShell).
- Every task ends green on `npm run typecheck` and `npm test` before moving to the next.

---

## Group A — Extraction (behavior-preserving)

### Task A1: Extract `chat/starters.ts`, `chat/ModelSelect.tsx`, `chat/CodeBlock.tsx`

**Files:**
- Create: `src/renderer/src/chat/starters.ts`
- Create: `src/renderer/src/chat/ModelSelect.tsx`
- Create: `src/renderer/src/chat/CodeBlock.tsx`
- Modify: `src/renderer/src/Chat.tsx:1-219` (remove the moved code; imports fixed up in Task A4 once the file is fully reassembled — for this task, just delete the `starterCards`/`quickPills`/`slashCommands`/`ModelSelect`/`textOf`/`CodeBlock` definitions and leave the remaining file non-compiling; A4 finishes it. If you'd rather keep every intermediate commit compiling, do this task's file surgery together with A2/A3/A4 in one working session and commit once at the end of A4 — either way, **do not commit `Chat.tsx` in a broken intermediate state**.)

**Interfaces:**
- Produces: `StarterCard`, `QuickPill`, `SlashCommand` types and `starterCards: StarterCard[]`, `quickPills: QuickPill[]`, `slashCommands: SlashCommand[]` from `chat/starters.ts`. Consumed by `chat/Home.tsx` (A3) and `chat/Composer.tsx` (A4).
- Produces: `ModelSelect` component from `chat/ModelSelect.tsx`, signature unchanged: `{ value: string; onChange: (v: string) => void; disabled?: boolean; size?: 'sm' | 'md' }`. Consumed by `Chat.tsx` (A4) and `Spaces.tsx` (A4).
- Produces: `CodeBlock` component from `chat/CodeBlock.tsx`, signature unchanged: `{ children?: ReactNode }`. Consumed by `chat/Message.tsx` (A2).

- [ ] **Step 1: Create `src/renderer/src/chat/starters.ts`**

```ts
import {
  BarChart2,
  BookOpen,
  Code,
  FileText,
  Lightbulb,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  type LucideIcon
} from 'lucide-react';

export interface StarterCard {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  desc: string;
  prompt: string;
}

export const starterCards: StarterCard[] = [
  {
    icon: MessageSquare,
    iconClass: 'starter-icon-blue',
    title: 'Plan a project',
    desc: 'Turn your ideas into a step-by-step plan',
    prompt: 'Help me turn my idea into a clear, structured step-by-step implementation plan.'
  },
  {
    icon: Code,
    iconClass: 'starter-icon-emerald',
    title: 'Review code',
    desc: 'Get feedback and suggestions',
    prompt: 'Please review this code for bugs, edge cases, style, and optimizations:'
  },
  {
    icon: BookOpen,
    iconClass: 'starter-icon-indigo',
    title: 'Learn something',
    desc: 'Ask questions and explore concepts',
    prompt: 'Explain this topic clearly with step-by-step examples:'
  },
  {
    icon: Sparkles,
    iconClass: 'starter-icon-purple',
    title: 'Create with AI',
    desc: 'Draft, brainstorm and iterate',
    prompt: 'Help me brainstorm innovative ideas, alternatives, and approaches for:'
  }
];

export interface QuickPill {
  icon: LucideIcon;
  label: string;
  prompt: string;
}

export const quickPills: QuickPill[] = [
  {
    icon: FileText,
    label: 'Summarize a document',
    prompt: 'Summarize this document with key takeaways and structured points:'
  },
  {
    icon: BarChart2,
    label: 'Analyze data',
    prompt: 'Analyze this data and uncover key patterns, metrics, and actionable findings:'
  },
  {
    icon: Code,
    label: 'Generate code',
    prompt: 'Write clean, robust, well-documented code for:'
  },
  {
    icon: Lightbulb,
    label: 'Brainstorm ideas',
    prompt: 'Brainstorm 5 creative ideas, architectural tradeoffs, and innovative features for:'
  },
  {
    icon: MoreHorizontal,
    label: 'More',
    prompt: 'What other capabilities and workflows can you assist me with?'
  }
];

export interface SlashCommand {
  cmd: string;
  title: string;
  desc: string;
  prompt: string;
}

export const slashCommands: SlashCommand[] = [
  {
    cmd: '/review',
    title: 'Code Review',
    desc: 'Review git changes, analyze code quality and edge cases',
    prompt:
      'Please review the open project changes for potential bugs, security concerns, clarity, and edge cases.'
  },
  {
    cmd: '/plan',
    title: 'Implementation Plan',
    desc: 'Create a structured plan with architecture and verification steps',
    prompt: 'Create a step-by-step implementation plan for the following task:'
  },
  {
    cmd: '/brainstorm',
    title: 'Brainstorm Solutions',
    desc: 'Explore alternative designs and architectural approaches',
    prompt: 'Help brainstorm alternative approaches, tradeoffs, and design decisions for:'
  },
  {
    cmd: '/test',
    title: 'Generate Tests',
    desc: 'Write comprehensive unit and integration tests',
    prompt: 'Generate unit tests for the current code and verify edge cases for:'
  },
  {
    cmd: '/memory',
    title: 'Project Memory',
    desc: 'Inspect or update persistent memory in .axon/MEMORY.md',
    prompt: 'Check persistent project memory in .axon/MEMORY.md and summarize recent architectural decisions.'
  }
];
```

- [ ] **Step 2: Create `src/renderer/src/chat/ModelSelect.tsx`**

```tsx
import { ChevronDown } from 'lucide-react';
import { useApp } from '../state';
import { Icon } from '../ui';

export function ModelSelect({
  value,
  onChange,
  disabled = false,
  size = 'md'
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const data = useApp((s) => s.data)!;
  const isDeepSeek = value.toLowerCase().includes('deepseek');

  return (
    <div className="model-select-pill-container">
      <span className={`model-select-dot ${isDeepSeek ? 'dot-deepseek' : 'dot-accent'}`} />
      <select
        className={`model-select-pill ${size === 'sm' ? 'pill-sm' : ''}`}
        aria-label="AI model"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a model</option>
        {data.providers
          .filter((p) => p.enabled)
          .map((p) => (
            <optgroup label={p.name} key={p.id}>
              {p.models.map((m) => (
                <option value={`${p.id}::${m.id}`} key={m.id}>
                  {m.displayName || m.id}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <Icon icon={ChevronDown} size="sm" className="model-select-arrow" />
    </div>
  );
}
```

- [ ] **Step 3: Create `src/renderer/src/chat/CodeBlock.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useApp } from '../state';
import { Icon } from '../ui';

/** Flattens the highlighted element tree back into the raw source for copying. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  return '';
}

/** Fenced code block with a language label and a copy button. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const className = (children as { props?: { className?: string } } | undefined)?.props?.className ?? '';
  const language = /language-([\w+#-]+)/.exec(className)?.[1];
  return (
    <div className="code-block">
      <div className="code-block-bar">
        {language && <span className="code-block-lang">{language}</span>}
        <button
          type="button"
          className="code-block-copy"
          onClick={() => {
            navigator.clipboard.writeText(textOf(children)).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              },
              () => useApp.getState().pushToast('Could not copy to clipboard', 'error')
            );
          }}
        >
          <Icon icon={copied ? Check : Copy} size="sm" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Leave `Chat.tsx` for now — don't run typecheck yet**

`Chat.tsx` still defines `ModelSelect`, `starterCards`, etc. inline as well, so the app still compiles (duplicate local names are fine as long as you haven't wired the new imports in yet — just don't delete anything from `Chat.tsx` in this task). Continue directly to Task A2; typecheck/test only at the end of A4, once `Chat.tsx` is fully reassembled. (If you're executing tasks in separate sessions with a hard stop after each one, instead delete the three moved definitions from `Chat.tsx` now, add `import { starterCards, quickPills, slashCommands } from './chat/starters'; import { ModelSelect } from './chat/ModelSelect'; import { CodeBlock } from './chat/CodeBlock';`, run `npm run typecheck && npm test`, and commit — this keeps every commit green at the cost of a slightly less clean diff in A4.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/chat/starters.ts src/renderer/src/chat/ModelSelect.tsx src/renderer/src/chat/CodeBlock.tsx
git commit -m "refactor: extract chat starters, ModelSelect and CodeBlock into chat/"
```

---

### Task A2: Extract `chat/Message.tsx` and `chat/MessageList.tsx`

**Files:**
- Create: `src/renderer/src/chat/Message.tsx`
- Create: `src/renderer/src/chat/MessageList.tsx`

**Interfaces:**
- Consumes: `CodeBlock` from `./CodeBlock` (Task A1); `timeAgo` from `../format`; `Button`, `Icon` from `../ui`; `ApprovalCard` from `../ui/ApprovalCard`; `Message`, `ToolApprovalRequest` types from `../../../shared/types`.
- Produces: `Message` component — `{ message: Message; busy: boolean; onCopy: () => void; onRegenerate: () => void; onEdit: () => void }`. `MessageList` component — `{ messages: Message[]; chatId: string | null; busy: boolean; pendingApprovals: Record<string, ToolApprovalRequest>; onRegenerate: (content: string) => void; onEditMessage: (content: string) => void }`. Both consumed by `Chat.tsx` (A4).

- [ ] **Step 1: Create `src/renderer/src/chat/Message.tsx`**

```tsx
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Pencil, RefreshCw, Sparkles, User, Wrench } from 'lucide-react';
import type { Message as ChatMessage } from '../../../shared/types';
import { timeAgo } from '../format';
import { Button, Icon } from '../ui';
import { CodeBlock } from './CodeBlock';

export function Message({
  message: m,
  busy,
  onCopy,
  onRegenerate,
  onEdit
}: {
  message: ChatMessage;
  busy: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  onEdit: () => void;
}) {
  return (
    <article className={`message ${m.role}${m.streaming ? ' streaming' : ''}`}>
      <div className="message-avatar">
        <Icon icon={m.role === 'user' ? User : Sparkles} size="sm" />
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{m.role === 'user' ? 'You' : 'Axon'}</strong>
          {m.modelId && <span className="text-caption">{m.modelId}</span>}
          <span className="text-caption" title={new Date(m.createdAt).toLocaleString()}>
            {timeAgo(m.createdAt)}
          </span>
          {m.usage && (
            <span className="text-caption" style={{ marginLeft: 'auto' }}>
              {(m.usage.promptTokens || 0).toLocaleString()} in /{' '}
              {(m.usage.completionTokens || 0).toLocaleString()} out
            </span>
          )}
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
            <summary>Thought Process</summary>
            <div className="thought-content">{m.thought}</div>
          </details>
        )}
        {m.toolCalls && m.toolCalls.length > 0 && (
          <div className="tool-calls">
            {m.toolCalls.map((tc) => (
              <details key={tc.id} className="tool-call-item">
                <summary className="tool-call-summary">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Icon icon={Wrench} size="sm" />
                    <strong>{tc.name}</strong>
                  </span>
                  <span
                    className={`tool-call-status ${
                      tc.error ? 'failed' : tc.result ? 'completed' : 'running'
                    }`}
                  >
                    {tc.error ? 'Failed' : tc.result ? 'Completed' : 'Running...'}
                  </span>
                </summary>
                <div className="tool-call-body">
                  <div className="tool-call-label">Arguments:</div>
                  <pre className="tool-call-pre">{tc.arguments}</pre>
                  {tc.result && (
                    <>
                      <div className="tool-call-label" style={{ marginTop: 'var(--space-2)' }}>
                        Result:
                      </div>
                      <pre className="tool-call-pre scrollable">{tc.result}</pre>
                    </>
                  )}
                  {tc.error && (
                    <div style={{ color: 'var(--danger-text)', marginTop: 'var(--space-2)' }}>{tc.error}</div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            img: ({ alt }) => <span>[Image: {alt}]</span>,
            a: ({ children }) => <span className="message-link">{children}</span>,
            pre: ({ children }) => <CodeBlock>{children}</CodeBlock>
          }}
        >
          {m.content || (m.streaming ? (m.thought ? 'Generating response…' : 'Thinking…') : '')}
        </Markdown>
        {m.error && <p className="message-error">{m.error}</p>}
        {m.role === 'assistant' && m.content && !m.streaming && (
          <div className="message-actions">
            <Button variant="ghost" size="sm" icon={Copy} onClick={onCopy}>
              Copy
            </Button>
            <Button variant="ghost" size="sm" icon={RefreshCw} disabled={busy} onClick={onRegenerate}>
              Regenerate
            </Button>
          </div>
        )}
        {m.role === 'user' && m.content && (
          <div className="message-actions">
            <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
              Edit
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Create `src/renderer/src/chat/MessageList.tsx`**

```tsx
import type { Message as ChatMessage, ToolApprovalRequest } from '../../../shared/types';
import { useApp, perform } from '../state';
import { ApprovalCard } from '../ui/ApprovalCard';
import { Message } from './Message';

export function MessageList({
  messages,
  chatId,
  busy,
  pendingApprovals,
  onRegenerate,
  onEditMessage
}: {
  messages: ChatMessage[];
  chatId: string | null;
  busy: boolean;
  pendingApprovals: Record<string, ToolApprovalRequest>;
  onRegenerate: (content: string) => void;
  onEditMessage: (content: string) => void;
}) {
  return (
    <div className="messages">
      {messages.map((m, idx) => (
        <Message
          key={m.id}
          message={m}
          busy={busy}
          onCopy={() => void perform(() => navigator.clipboard.writeText(m.content), 'Copied to clipboard')}
          onRegenerate={() => {
            const prevUser = [...messages.slice(0, idx)].reverse().find((msg) => msg.role === 'user');
            if (prevUser) onRegenerate(prevUser.content);
          }}
          onEdit={() => onEditMessage(m.content)}
        />
      ))}
      {Object.values(pendingApprovals)
        .filter((req) => req.conversationId === chatId)
        .map((req) => (
          <ApprovalCard
            key={req.id}
            request={req}
            onDecision={(approved, alwaysAllowSession) => {
              const { pendingApprovals: current, patch } = useApp.getState();
              const next = { ...current };
              delete next[req.id];
              patch({ pendingApprovals: next });
              void window.axon.toolApprove({ requestId: req.id, approved, alwaysAllowSession });
            }}
          />
        ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/chat/Message.tsx src/renderer/src/chat/MessageList.tsx
git commit -m "refactor: extract chat Message and MessageList into chat/"
```

---

### Task A3: Extract `chat/Home.tsx`

**Files:**
- Create: `src/renderer/src/chat/Home.tsx`

**Interfaces:**
- Consumes: `starterCards`, `quickPills` from `./starters` (Task A1); `perform` from `../state`; `Button`, `Icon` from `../ui`.
- Produces: `Home` component — `{ greeting: string; model: string; setInput: (value: string) => void; setAttachments: (files: { id: string; name: string }[]) => void; onConnectProvider: () => void }`. Consumed by `Chat.tsx` (A4).

Note: the original dropzone `onDrop` and the "Choose files" button both ran the identical `perform(async () => setAttachments((await window.axon.attach()).slice(0, 5)))` block. This step folds that into one `attach()` closure used by both call sites — same output for both, not a behavior change.

- [ ] **Step 1: Create `src/renderer/src/chat/Home.tsx`**

```tsx
import { ArrowRight, FileUp } from 'lucide-react';
import { perform } from '../state';
import { Button, Icon } from '../ui';
import { starterCards, quickPills } from './starters';

export function Home({
  greeting,
  model,
  setInput,
  setAttachments,
  onConnectProvider
}: {
  greeting: string;
  model: string;
  setInput: (value: string) => void;
  setAttachments: (files: { id: string; name: string }[]) => void;
  onConnectProvider: () => void;
}) {
  const focusComposer = () => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  const attach = () =>
    void perform(async () => {
      setAttachments((await window.axon.attach()).slice(0, 5));
    });

  return (
    <div className="welcome-workspace">
      <div className="welcome-header">
        <div className="welcome-title-group">
          <h1 className="welcome-greeting">{greeting}, Alex 👋</h1>
          <p className="welcome-subtext">What would you like to work on today?</p>
        </div>
        <div className="welcome-doodle-note">
          <span>More possibilities with Axon ✨</span>
        </div>
      </div>

      <div className="starter-cards-grid">
        {starterCards.map((card) => (
          <button
            key={card.title}
            className="starter-card"
            onClick={() => {
              setInput(card.prompt);
              focusComposer();
            }}
          >
            <div className={`starter-icon-box ${card.iconClass}`}>
              <Icon icon={card.icon} size="md" />
            </div>
            <div className="starter-card-content">
              <h3 className="starter-card-title">{card.title}</h3>
              <p className="starter-card-desc">{card.desc}</p>
            </div>
            <div className="starter-card-arrow">
              <Icon icon={ArrowRight} size="sm" />
            </div>
          </button>
        ))}
      </div>

      <div
        className="dropzone-card"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          attach();
        }}
      >
        <div className="dropzone-icon">
          <Icon icon={FileUp} size="lg" />
        </div>
        <h4 className="dropzone-title">Drag and drop files here</h4>
        <p className="dropzone-sub">Attach PDFs, code, images or any file to add context</p>
        <button type="button" className="btn-choose-files" onClick={attach}>
          Choose files
        </button>
      </div>

      <div className="quick-action-pills">
        {quickPills.map((pill) => (
          <button
            key={pill.label}
            className="quick-action-pill"
            onClick={() => {
              setInput(pill.prompt);
              focusComposer();
            }}
          >
            <Icon icon={pill.icon} size="sm" />
            <span>{pill.label}</span>
          </button>
        ))}
      </div>

      {!model && (
        <div style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
          <Button variant="primary" onClick={onConnectProvider}>
            Connect a provider in Settings
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/chat/Home.tsx
git commit -m "refactor: extract chat Home (welcome view) into chat/"
```

---

### Task A4: Extract `chat/Composer.tsx`; reassemble `Chat.tsx`; repoint `Spaces.tsx`'s `ModelSelect` import

This is the task that makes everything from A1–A3 compile together. `Chat.tsx` shrinks from 970 lines to roughly 260: it keeps all state, the `send()` function, and the per-chat header/topbar/rename-form (those get rebuilt as part of the shared `TopBar` in a later shell-phase plan, so there's no value in extracting them now), and renders `Home` / `MessageList` / `Composer` from props.

One pre-existing quirk to preserve exactly, not "fix": `Chat.tsx` computes a `hint` string (file-sharing / knowledge-source hint) but never renders it — the composer note has always shown the literal text "Shift + Enter for new line" regardless. Drop the dead `hint` computation as part of the move (removing unused code is not a behavior change) and keep the composer note as a literal string. (Spec §4.9 describes wiring the hint in for real — that's a later phase's job, not this extraction.)

Also preserve: `picker` state accepts `'skills' | 'roles' | null` and the `SkillPicker` modal branch still exists, but nothing in the composer ever calls `setPicker('skills')` today (only `'roles'`, from the Agents chip) — that's already true of the current app; don't add a way to reach it and don't remove the modal branch.

**Files:**
- Create: `src/renderer/src/chat/Composer.tsx`
- Modify: `src/renderer/src/Chat.tsx` (full rewrite — replace entire file contents)
- Modify: `src/renderer/src/Spaces.tsx:24` (repoint the `ModelSelect` import)

**Interfaces:**
- Consumes: `slashCommands` from `./starters` (A1); `perform`, `useApp` from `../state`; `Icon` from `../ui`; `SelectionChips` from `../ui/CatalogPicker`; `Selection`, `Workspace` types from `../../../shared/types`.
- Produces: `Composer` component, full prop list below. Consumed by `Chat.tsx`.

- [ ] **Step 1: Create `src/renderer/src/chat/Composer.tsx`**

```tsx
import {
  ArrowDown,
  ArrowUp,
  Bot,
  BookOpen,
  FileCode,
  Globe,
  Mic,
  Plus,
  Square,
  X
} from 'lucide-react';
import type { Selection, Workspace } from '../../../shared/types';
import { useApp, perform } from '../state';
import { Icon } from '../ui';
import { SelectionChips } from '../ui/CatalogPicker';
import { slashCommands } from './starters';

export function Composer({
  input,
  setInput,
  onSend,
  onStop,
  busy,
  model,
  attachments,
  setAttachments,
  mentionQuery,
  setMentionQuery,
  projectFiles,
  setProjectFiles,
  selection,
  inherited,
  onRemoveSelection,
  onOpenPicker,
  workspace,
  searchMode,
  setSearchMode,
  atBottom,
  hasMessages,
  onJumpToLatest,
  onOpenKnowledge
}: {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  model: string;
  attachments: { id: string; name: string }[];
  setAttachments: (
    updater: { id: string; name: string }[] | ((list: { id: string; name: string }[]) => { id: string; name: string }[])
  ) => void;
  mentionQuery: string | null;
  setMentionQuery: (q: string | null) => void;
  projectFiles: string[];
  setProjectFiles: (files: string[]) => void;
  selection: Selection;
  inherited: Selection;
  onRemoveSelection: (kind: 'skill' | 'role', id: string) => void;
  onOpenPicker: (kind: 'skills' | 'roles') => void;
  workspace: Workspace | undefined;
  searchMode: boolean;
  setSearchMode: (value: boolean) => void;
  atBottom: boolean;
  hasMessages: boolean;
  onJumpToLatest: () => void;
  onOpenKnowledge: () => void;
}) {
  const matchingSlash =
    input.startsWith('/') && !input.includes(' ')
      ? slashCommands.filter((sc) => sc.cmd.toLowerCase().startsWith(input.toLowerCase()))
      : [];

  return (
    <div className="composer-wrap">
      {!atBottom && hasMessages && (
        <button className="jump-latest" onClick={onJumpToLatest}>
          <Icon icon={ArrowDown} size="sm" />
          Jump to latest
        </button>
      )}
      <div className="composer" style={{ position: 'relative' }}>
        {mentionQuery !== null && (
          <div className="composer-menu">
            <div className="composer-menu-header">Files in open project (select to mention):</div>
            {projectFiles
              .filter((f) => f.toLowerCase().includes(mentionQuery.toLowerCase()))
              .slice(0, 10)
              .map((f) => (
                <button
                  key={f}
                  type="button"
                  className="composer-menu-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const lastAt = input.lastIndexOf('@' + mentionQuery);
                    if (lastAt !== -1) {
                      const next =
                        input.slice(0, lastAt) + '@' + f + ' ' + input.slice(lastAt + 1 + mentionQuery.length);
                      setInput(next);
                    }
                    setMentionQuery(null);
                  }}
                >
                  <Icon icon={FileCode} size="sm" />
                  <span>{f}</span>
                </button>
              ))}
          </div>
        )}
        {matchingSlash.length > 0 && (
          <div className="composer-menu slash-menu">
            <div className="composer-menu-header">Slash commands (Press Tab to insert):</div>
            {matchingSlash.map((sc) => (
              <button
                key={sc.cmd}
                type="button"
                className="composer-menu-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(sc.prompt + ' ');
                }}
              >
                <span className="composer-menu-cmd">{sc.cmd}</span>
                <span className="composer-menu-title">{sc.title}</span>
                <span className="composer-menu-desc">{sc.desc}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          aria-label="Message"
          placeholder={model ? 'Message Axon…' : 'Connect a provider in Settings to start.'}
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            const cursor = e.target.selectionStart;
            const before = val.slice(0, cursor);
            const match = before.match(/@([a-zA-Z0-9_\-./]*)$/);
            if (match) {
              setMentionQuery(match[1]);
              if (projectFiles.length === 0) {
                void window.axon
                  .projectList()
                  .then(setProjectFiles)
                  .catch(() => {});
              }
            } else {
              setMentionQuery(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setMentionQuery(null);
            } else if (e.key === 'Tab' && matchingSlash.length > 0) {
              e.preventDefault();
              setInput(matchingSlash[0].prompt + ' ');
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              if (mentionQuery !== null) {
                const filtered = projectFiles.filter((f) =>
                  f.toLowerCase().includes(mentionQuery.toLowerCase())
                );
                if (filtered.length > 0) {
                  e.preventDefault();
                  const f = filtered[0];
                  const lastAt = input.lastIndexOf('@' + mentionQuery);
                  if (lastAt !== -1) {
                    const next =
                      input.slice(0, lastAt) + '@' + f + ' ' + input.slice(lastAt + 1 + mentionQuery.length);
                    setInput(next);
                  }
                  setMentionQuery(null);
                  return;
                }
              }
              if (matchingSlash.length > 0 && input.trim() === matchingSlash[0].cmd) {
                e.preventDefault();
                setInput(matchingSlash[0].prompt + ' ');
                return;
              }
              e.preventDefault();
              onSend();
            }
          }}
          rows={3}
        />
        {attachments.length > 0 && (
          <div className="chips">
            {attachments.map((a) => (
              <button
                key={a.id}
                className="chip"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
              >
                {a.name}
                <Icon icon={X} size="sm" />
              </button>
            ))}
          </div>
        )}
        <SelectionChips selection={selection} inherited={inherited} onRemove={onRemoveSelection} />
        <div className="composer-bar">
          <button
            type="button"
            className="btn-circle-attach"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => void perform(async () => setAttachments((await window.axon.attach()).slice(0, 5)))}
          >
            <Icon icon={Plus} size="sm" />
          </button>

          <button
            type="button"
            className={`composer-tool-pill ${searchMode ? 'active' : ''}`}
            onClick={() => {
              setSearchMode(!searchMode);
              useApp.getState().pushToast(searchMode ? 'Web search disabled' : 'Web search enabled');
            }}
            title="Toggle Web Search"
          >
            <Icon icon={Globe} size="sm" />
            <span>Search</span>
          </button>

          <button type="button" className="composer-tool-pill" onClick={onOpenKnowledge} title="Knowledge Sources">
            <Icon icon={BookOpen} size="sm" />
            <span>Knowledge</span>
            {workspace?.knowledgeDocIds?.length ? ` · ${workspace.knowledgeDocIds.length}` : ''}
          </button>

          <button
            type="button"
            className="composer-tool-pill"
            onClick={() => onOpenPicker('roles')}
            title="Roles & Agents"
          >
            <Icon icon={Bot} size="sm" />
            <span>Agents</span>
            {selection.roleIds.length + inherited.roleIds.length
              ? ` · ${new Set([...inherited.roleIds, ...selection.roleIds]).size}`
              : ''}
          </button>

          <div className="composer-bar-right">
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label="Voice input"
              title="Voice input"
              onClick={() => useApp.getState().pushToast('Voice input ready')}
            >
              <Icon icon={Mic} size="sm" />
            </button>
            {busy ? (
              <button type="button" className="btn-circle-send" aria-label="Stop generating" onClick={onStop}>
                <Icon icon={Square} size="sm" />
              </button>
            ) : (
              <button
                type="button"
                className="btn-circle-send"
                aria-label="Send message"
                disabled={!input.trim() || !model}
                onClick={onSend}
              >
                <Icon icon={ArrowUp} size="sm" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="composer-note-clean">Shift + Enter for new line</p>
    </div>
  );
}
```

- [ ] **Step 2: Replace the full contents of `src/renderer/src/Chat.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, MessageSquare, Moon, Pencil, Sun, Trash2 } from 'lucide-react';
import { useApp, perform } from './state';
import { Button, Icon } from './ui';
import { RolePicker, SkillPicker } from './ui/CatalogPicker';
import { resolveTheme, setTheme } from './theme';
import { ModelSelect } from './chat/ModelSelect';
import { Home } from './chat/Home';
import { MessageList } from './chat/MessageList';
import { Composer } from './chat/Composer';
import type { Selection } from '../../shared/types';

export function Chat({ codeContext }: { codeContext?: { path: string; text: string } }) {
  const { data, chatId, workspaceId, model, patch, pendingSelection, pendingApprovals } = useApp();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [picker, setPicker] = useState<'skills' | 'roles' | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [atBottom, setAtBottom] = useState(true);
  const [searchMode, setSearchMode] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const chat = data!.conversations.find((c) => c.id === chatId);
  const resolvedWorkspaceId = chat ? chat.workspaceId : (codeContext ? null : workspaceId);
  const workspace = data!.workspaces.find((w) => w.id === resolvedWorkspaceId);
  const messages = data!.messages.filter((m) => m.conversationId === chatId && m.role !== 'system');
  const busy = sending || messages.some((m) => m.streaming);
  const selection: Selection = chat ? { skillIds: chat.skillIds, roleIds: chat.roleIds } : pendingSelection;
  const inherited: Selection = { skillIds: workspace?.skillIds ?? [], roleIds: workspace?.roleIds ?? [] };

  const totalUsage = messages.reduce(
    (acc, m) => {
      if (m.usage) {
        acc.input += m.usage.promptTokens || 0;
        acc.output += m.usage.completionTokens || 0;
      }
      return acc;
    },
    { input: 0, output: 0 }
  );
  const totalTokens = totalUsage.input + totalUsage.output;
  const estimatedCost = (totalUsage.input * 0.000003 + totalUsage.output * 0.000015).toFixed(4);

  const applySelection = (next: Selection) => {
    if (chat) void perform(() => window.axon.chatSelectionSet(chat.id, next));
    else patch({ pendingSelection: next });
  };
  const removeOne = (kind: 'skill' | 'role', id: string) =>
    applySelection(
      kind === 'skill'
        ? { ...selection, skillIds: selection.skillIds.filter((x) => x !== id) }
        : { ...selection, roleIds: selection.roleIds.filter((x) => x !== id) }
    );

  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages.map((m) => m.content.length).join(',')]);

  useEffect(() => {
    setInput('');
    setAttachments([]);
    follow.current = true;
    setAtBottom(true);
    if (!chatId) patch({ pendingSelection: { skillIds: [], roleIds: [] } });
  }, [chatId, workspaceId]);

  async function send(customText?: string): Promise<void> {
    const textToSend = customText !== undefined ? customText : input;
    if (!textToSend.trim() || busy) return;
    setSending(true);
    await perform(async () => {
      let id = chatId;
      if (!id) {
        const [provider, ...rest] = model.split('::');
        const projectRoot = codeContext ? (data?.projectRoot || null) : null;
        const created = await window.axon.chatCreate(
          provider,
          rest.join('::'),
          codeContext ? null : workspaceId,
          undefined,
          pendingSelection,
          projectRoot
        );
        id = created.id;
        patch({ chatId: id, pendingSelection: { skillIds: [], roleIds: [] } });
      }

      let content = textToSend;
      const fileMentions = textToSend.match(/@([a-zA-Z0-9_\-./]+)/g);
      if (fileMentions) {
        for (const m of fileMentions) {
          const filePath = m.slice(1);
          try {
            const fileText = await window.axon.projectRead(filePath);
            content += `\n\n<file path="${filePath}">\n${fileText.slice(0, 30000)}\n</file>`;
          } catch {
            // Not a file, ignore
          }
        }
      }

      if (codeContext?.path) {
        content += `\n\nCurrent editor file: ${codeContext.path}\n\`\`\`\n${codeContext.text.slice(0, 30000)}\n\`\`\``;
      }

      const ids = customText ? [] : attachments.map((a) => a.id);
      if (customText === undefined) {
        setInput('');
        setAttachments([]);
      }
      setMentionQuery(null);
      follow.current = true;
      await window.axon.chatSend(id, content, ids);
    });
    setSending(false);
  }

  return (
    <section className="chat-view">
      <header className="topbar">
        <div className="topbar-left">
          <div className="topbar-view-pill" onClick={() => patch({ page: 'chat', chatId: null })}>
            <Icon icon={MessageSquare} size="sm" className="text-accent" />
            <span className="view-title">{codeContext ? 'Code' : workspace?.name || 'Chat'}</span>
            <Icon icon={ChevronDown} size="sm" />
          </div>
          {chat && (
            <>
              <span className="breadcrumb-sep">/</span>
              <strong className="conversation-title">{chat.title}</strong>
            </>
          )}
        </div>
        <div className="topbar-actions">
          {totalTokens > 0 && (
            <span
              className="badge badge-outline"
              title={`${totalUsage.input.toLocaleString()} prompt tokens + ${totalUsage.output.toLocaleString()} completion tokens`}
            >
              {totalTokens.toLocaleString()} tokens · ~${estimatedCost}
            </span>
          )}
          <ModelSelect
            size="sm"
            disabled={Boolean(chat)}
            value={chat ? `${chat.providerId}::${chat.modelId}` : model}
            onChange={(v) => patch({ model: v })}
          />
          <button
            className="topbar-icon-btn"
            aria-label="Notifications"
            title="Notifications"
            onClick={() => useApp.getState().pushToast('No new notifications')}
          >
            <Icon icon={Bell} size="sm" />
          </button>
          <button
            className="topbar-icon-btn"
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={() =>
              data?.settings &&
              void setTheme(data.settings, resolveTheme(data.settings.theme) === 'dark' ? 'light' : 'dark')
            }
          >
            <Icon icon={data?.settings && resolveTheme(data.settings.theme) === 'dark' ? Sun : Moon} size="sm" />
          </button>
          {chat && (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                iconOnly
                aria-label="Rename conversation"
                onClick={() => {
                  setTitle(chat.title);
                  setRenaming(true);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                aria-label="Delete conversation"
                onClick={() => {
                  if (confirm('Delete this conversation? This cannot be undone.'))
                    void perform(async () => {
                      await window.axon.chatDelete(chat.id);
                      patch({ chatId: null });
                    });
                }}
              />
            </>
          )}
        </div>
      </header>

      {renaming && (
        <form
          className="inline-form rename-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              await window.axon.chatRename(chat!.id, title);
              setRenaming(false);
            });
          }}
        >
          <input
            className="input"
            aria-label="Conversation title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
          />
          <Button variant="primary" type="submit">
            Save
          </Button>
          <Button variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      )}

      <div
        className="chat-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          setAtBottom(follow.current);
        }}
      >
        {!messages.length ? (
          <Home
            greeting={greeting}
            model={model}
            setInput={setInput}
            setAttachments={setAttachments}
            onConnectProvider={() => patch({ page: 'settings' })}
          />
        ) : (
          <MessageList
            messages={messages}
            chatId={chatId}
            busy={busy}
            pendingApprovals={pendingApprovals}
            onRegenerate={(content) => void send(content)}
            onEditMessage={setInput}
          />
        )}
        <div ref={bottom} />
      </div>

      <Composer
        input={input}
        setInput={setInput}
        onSend={() => void send()}
        onStop={() => chatId && void perform(() => window.axon.chatStop(chatId))}
        busy={busy}
        model={model}
        attachments={attachments}
        setAttachments={setAttachments}
        mentionQuery={mentionQuery}
        setMentionQuery={setMentionQuery}
        projectFiles={projectFiles}
        setProjectFiles={setProjectFiles}
        selection={selection}
        inherited={inherited}
        onRemoveSelection={removeOne}
        onOpenPicker={setPicker}
        workspace={workspace}
        searchMode={searchMode}
        setSearchMode={setSearchMode}
        atBottom={atBottom}
        hasMessages={messages.length > 0}
        onJumpToLatest={() => {
          follow.current = true;
          setAtBottom(true);
          bottom.current?.scrollIntoView({ behavior: 'smooth' });
        }}
        onOpenKnowledge={() => patch({ page: 'knowledge' })}
      />

      {picker === 'skills' && (
        <SkillPicker
          selected={selection.skillIds}
          onClose={() => setPicker(null)}
          onApply={(ids) => {
            applySelection({ ...selection, skillIds: ids });
            setPicker(null);
          }}
        />
      )}
      {picker === 'roles' && (
        <RolePicker
          selected={selection.roleIds}
          onClose={() => setPicker(null)}
          onApply={(ids) => {
            applySelection({ ...selection, roleIds: ids });
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Repoint `Spaces.tsx`'s `ModelSelect` import**

In `src/renderer/src/Spaces.tsx:24`, change:

```ts
import { Chat, ModelSelect } from './Chat';
```

to:

```ts
import { ModelSelect } from './chat/ModelSelect';
```

(`Chat` itself is dropped from this import — `Spaces.tsx`'s only use of it lives in the `Code` component, which moves to its own file in Task A5, where it gets its own `import { Chat } from './Chat';`.)

Note: `theme.ts` (imported by the new `Chat.tsx`) doesn't exist yet — it's created in Task B4. Task A4's typecheck will fail on `Cannot find module './theme'` until Group B runs. **Do the tasks in order (A1→A5, then B1→B5)** and don't run `npm run typecheck` as a gate at the end of A4 — run it after B4 instead, once `theme.ts` exists. (`npm test`, which doesn't type-check, can still be run after A4 to confirm the unit-test suite is unaffected.)

- [ ] **Step 4: Run the unit test suite (typecheck comes after Task B4)**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test
```

Expected: all 45 existing tests still pass (this task touches no `src/main` code, so nothing here should be able to break them — this run is a sanity check that the extraction didn't somehow break module loading).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/chat/Composer.tsx src/renderer/src/Chat.tsx src/renderer/src/Spaces.tsx
git commit -m "refactor: extract chat Composer, reassemble Chat.tsx from chat/ pieces"
```

---

### Task A5: Extract `Code.tsx` from `Spaces.tsx`

`Spaces.tsx` is 1087 lines today; lines 617–1087 (the `FileTreeNodeData` interface through the end of the `Code` component) belong entirely to the Code page and are used nowhere else in the file. Move them out verbatim into a new `Code.tsx`, then trim `Spaces.tsx`'s imports to match what's left.

**Files:**
- Create: `src/renderer/src/Code.tsx`
- Modify: `src/renderer/src/Spaces.tsx` (delete the moved block; trim imports)
- Modify: `src/renderer/src/App.tsx:27` (import `Code` from its new file)

**Interfaces:**
- Consumes: `Chat` from `./Chat`; `useApp`, `perform` from `./state`; `Button`, `Icon` from `./ui`; `DiffViewer` from `./ui/DiffViewer`; `hljs` from `highlight.js`.
- Produces: `Code` component (no props — reads `useApp()` directly, same as today). Consumed by `App.tsx`.

- [ ] **Step 1: Create `src/renderer/src/Code.tsx`**

Cut lines 617–1087 out of `src/renderer/src/Spaces.tsx` (from `interface FileTreeNodeData {` through the closing `}` of `export function Code()`) and paste them below this header into the new file:

```tsx
import { useState, useRef, useMemo, useEffect } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  Folder,
  FolderOpen,
  RotateCcw,
  Save,
  Search
} from 'lucide-react';
import hljs from 'highlight.js';
import { useApp, perform } from './state';
import { Chat } from './Chat';
import { Button, Icon } from './ui';
import { DiffViewer } from './ui/DiffViewer';

interface FileTreeNodeData {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNodeData[];
}

function buildFileTree(files: string[]): FileTreeNodeData[] {
  const root: FileTreeNodeData = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.split('/');
    let curr = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isDir = i < parts.length - 1;
      const subPath = parts.slice(0, i + 1).join('/');
      let child = curr.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: subPath, isDir, children: [] };
        curr.children.push(child);
      }
      curr = child;
    }
  }
  function sortNodes(nodes: FileTreeNodeData[]): FileTreeNodeData[] {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children);
    }
    return nodes;
  }
  return sortNodes(root.children);
}

function FileTreeNodeItem({
  node,
  depth,
  activePath,
  collapsed,
  onToggle,
  onOpen
}: {
  node: FileTreeNodeData;
  depth: number;
  activePath: string;
  collapsed: Set<string>;
  onToggle: (dirPath: string) => void;
  onOpen: (filePath: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);

  if (node.isDir) {
    return (
      <div className="file-tree-branch">
        <button
          className="file-item file-item-dir"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => onToggle(node.path)}
        >
          <Icon icon={isCollapsed ? ChevronRight : ChevronDown} size="sm" />
          <Icon icon={isCollapsed ? Folder : FolderOpen} size="sm" />
          <span>{node.name}</span>
        </button>
        {!isCollapsed && (
          <div className="file-tree-sub">
            {node.children.map((child) => (
              <FileTreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="file-item"
      aria-current={node.path === activePath ? 'true' : undefined}
      style={{ paddingLeft: `${depth * 14 + 18}px` }}
      onClick={() => onOpen(node.path)}
    >
      <Icon icon={FileCode} size="sm" />
      <span>{node.name}</span>
    </button>
  );
}

function getCodeLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml'
  };
  return langMap[ext] || 'plaintext';
}

function CodeEditorView({
  filePath,
  content,
  disabled,
  onChange
}: {
  filePath: string;
  content: string;
  disabled: boolean;
  onChange: (val: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lang = useMemo(() => getCodeLanguage(filePath), [filePath]);
  const lines = useMemo(() => content.split('\n'), [content]);

  const highlighted = useMemo(() => {
    if (!content) return '';
    try {
      if (hljs.getLanguage(lang)) {
        return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [content, lang]);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  return (
    <div className="code-editor-viewport">
      <div className="code-editor-gutter" ref={gutterRef}>
        {lines.map((_, i) => (
          <div key={i} className="line-num">
            {i + 1}
          </div>
        ))}
      </div>
      <div className="code-editor-pane">
        <pre className="code-editor-pre" ref={preRef} aria-hidden="true">
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: (highlighted || (disabled ? 'No file selected' : '')) + '\n' }}
          />
        </pre>
        <textarea
          ref={textareaRef}
          className="code-editor-textarea"
          aria-label="Project file editor"
          spellCheck={false}
          disabled={disabled}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          wrap="off"
        />
      </div>
    </div>
  );
}

export function Code() {
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');
  const [share, setShare] = useState(false);
  const [hits, setHits] = useState<{ path: string; line: number; text: string }[]>([]);
  const [showFiles, setShowFiles] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const { data, chatId } = useApp();
  const dirty = content !== saved;
  const [showDiff, setShowDiff] = useState(false);

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const fileTree = useMemo(() => {
    const filtered = filter.trim()
      ? files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
      : files;
    return buildFileTree(filtered);
  }, [files, filter]);

  const lastAssistant = data
    ? [...data.messages]
        .reverse()
        .find(
          (m) => m.role === 'assistant' && m.content && !m.error && (!chatId || m.conversationId === chatId)
        )
    : null;
  const codeBlock = lastAssistant
    ? (lastAssistant.content.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/) || [])[1]
    : null;

  const open = (file: string) => {
    if (dirty && !confirm('Discard unsaved editor changes?')) return;
    void perform(async () => {
      const text = await window.axon.projectRead(file);
      setPath(file);
      setContent(text);
      setSaved(text);
      setShare(false);
    });
  };

  const saveFile = () =>
    void perform(async () => {
      await window.axon.projectWrite(path, content);
      setSaved(content);
      setFiles(await window.axon.projectList());
      setShowDiff(false);
    }, 'File saved');

  // Ctrl/Cmd+S saves the open file, matching every other editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      event.preventDefault();
      if (path && dirty) saveFile();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path, content, dirty]);

  return (
    <div className="code-layout">
      <section className="project-panel">
        <header className="topbar">
          <strong>
            <Icon icon={FolderOpen} />
            Project
          </strong>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            {root && (
              <Button size="sm" variant="ghost" onClick={() => setShowFiles((v) => !v)}>
                {showFiles ? 'Hide files' : `Files (${files.length})`}
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => {
                if (dirty && !confirm('Discard unsaved changes?')) return;
                void perform(async () => {
                  const next = await window.axon.projectChoose();
                  if (next) {
                    setRoot(next);
                    setFiles(await window.axon.projectList());
                    setPath('');
                    setContent('');
                    setSaved('');
                    setShare(false);
                  }
                });
              }}
            >
              Open folder
            </Button>
          </div>
        </header>
        <p className="project-root">
          {root || 'Choose a local folder. Nothing is shared with the model automatically.'}
        </p>

        {showFiles && (
          <>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => setHits(await window.axon.projectSearch(filter)));
              }}
            >
              <input
                className="input"
                aria-label="Filter or search project"
                placeholder="Filter files or search contents"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setHits([]);
                }}
              />
              <Button type="submit" icon={Search} iconOnly aria-label="Search project contents" />
            </form>

            <div className="file-list">
              {hits.length ? (
                hits.map((h, i) => (
                  <button key={i} className="file-item" onClick={() => open(h.path)}>
                    {h.path}:{h.line} — {h.text}
                  </button>
                ))
              ) : fileTree.length > 0 ? (
                fileTree.map((node) => (
                  <FileTreeNodeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    activePath={path}
                    collapsed={collapsedDirs}
                    onToggle={toggleDir}
                    onOpen={open}
                  />
                ))
              ) : (
                <p className="text-caption" style={{ padding: 'var(--space-2)' }}>
                  {root ? (filter ? 'No matching files.' : 'Empty directory.') : 'No folder opened.'}
                </p>
              )}
            </div>

            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty && !confirm('Discard unsaved changes?')) return;
                setPath(newPath);
                setContent('');
                setSaved('');
                setShare(false);
                setNewPath('');
              }}
            >
              <input
                className="input"
                aria-label="New relative file path"
                placeholder="New file, e.g. src/example.ts"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <Button type="submit" disabled={!root || !newPath.trim()}>
                Create
              </Button>
            </form>
          </>
        )}

        <div className="editor-title">
          <strong>
            <span className="editor-path">{path || 'No file selected'}</span>
            {dirty && <span className="dirty-dot" title="Unsaved changes — Ctrl+S to save" />}
          </strong>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {dirty && (
              <Button
                size="sm"
                variant={showDiff ? 'primary' : 'ghost'}
                icon={ArrowLeftRight}
                title="Toggle visual diff review"
                onClick={() => setShowDiff((v) => !v)}
              >
                {showDiff ? 'Editor' : 'Diff'}
              </Button>
            )}
            <Button
              size="sm"
              icon={Download}
              disabled={!path || !codeBlock}
              title="Insert the latest code block from the chat into the editor"
              onClick={() => setContent(codeBlock!)}
            >
              Insert AI code
            </Button>
            <Button
              size="sm"
              icon={RotateCcw}
              disabled={!path || !dirty}
              title="Restore the saved file"
              onClick={() => setContent(saved)}
            >
              Revert
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              disabled={!path}
              title="Save the open file (Ctrl+S)"
              onClick={saveFile}
            >
              Save
            </Button>
          </div>
        </div>

        {showDiff && dirty ? (
          <div style={{ height: '350px', margin: 'var(--space-2) 0' }}>
            <DiffViewer
              oldText={saved}
              newText={content}
              fileName={path}
              onAccept={saveFile}
              onReject={() => {
                setContent(saved);
                setShowDiff(false);
              }}
            />
          </div>
        ) : (
          <CodeEditorView filePath={path} content={content} disabled={!path} onChange={setContent} />
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            disabled={!path}
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
          />
          Include this file with my next message
        </label>
        <p className="text-caption">Saving asks for confirmation. Nothing runs; edits are reviewed by you.</p>
      </section>

      <div className="code-chat">
        <Chat codeContext={share ? { path, text: content } : { path: '', text: '' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Trim `Spaces.tsx`'s import block**

After deleting lines 617–1087, `src/renderer/src/Spaces.tsx:1-29` becomes:

```ts
import { useState, useRef, useMemo, useEffect } from 'react';
import {
  ArrowUpRight,
  Bot,
  Download,
  FileCode,
  Folder,
  Library,
  Plus,
  Puzzle,
  Save,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import type { Workspace, Agent, Selection } from '../../shared/types';
import { useApp, perform } from './state';
import { ModelSelect } from './chat/ModelSelect';
import { Button, EmptyState, Field, Icon, Modal, PageHeader } from './ui';
import { RolePicker, SkillPicker, SelectionChips } from './ui/CatalogPicker';
```

(`ArrowLeftRight`, `ChevronDown`, `ChevronRight`, `FolderOpen`, `RotateCcw` moved to `Code.tsx` with the code that used them; `hljs` and `DiffViewer` were only used by `Code` and move with it; `useState`/`useRef`/`useMemo`/`useEffect` are left as-is even though `Spaces.tsx`'s remaining components may not use every one of them — an unused import is harmless here since `tsconfig.json` has `noUnusedLocals: false`, and leaving them avoids the risk of removing one that's still needed by `Workspaces`/`Agents`/`Knowledge`.)

- [ ] **Step 3: Update `App.tsx`'s import**

In `src/renderer/src/App.tsx:27`, change:

```ts
import { Workspaces, Agents, Knowledge, Code as CodeWorkspace } from './Spaces';
```

to:

```ts
import { Workspaces, Agents, Knowledge } from './Spaces';
import { Code as CodeWorkspace } from './Code';
```

- [ ] **Step 4: Run the unit test suite**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test
```

Expected: all 45 tests still pass. (Typecheck still waits for Task B4 — `Chat.tsx` imports `./theme`, which doesn't exist until then.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/Code.tsx src/renderer/src/Spaces.tsx src/renderer/src/App.tsx
git commit -m "refactor: extract Code page from Spaces.tsx into Code.tsx"
```

---

## Group B — Tokens / Theme / Fonts / Data

### Task B1: Write the token contrast test (red)

Write this against the target palette *before* `tokens.css` is rewritten, so it fails for the right reason (the file doesn't have the new tokens yet) and then passes once Task B2 lands.

**Files:**
- Create: `tests/tokens.test.cjs`

**Interfaces:**
- Consumes: `src/renderer/src/tokens.css` (read as text, not imported — this is a static-file check, no CSS engine involved).

- [ ] **Step 1: Write the failing test**

```js
// Static contrast check against tokens.css's semantic layer. Pairs and minimums
// mirror the spec's verification table (docs/superpowers/specs/2026-09-21-look-and-shell-design.md §5).
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '../src/renderer/src/tokens.css'), 'utf8');

function block(source, selectorPattern) {
  const match = source.match(new RegExp(selectorPattern + '\\s*\\{([^}]*)\\}'));
  if (!match) throw new Error(`Block not found for pattern: ${selectorPattern}`);
  const tokens = {};
  for (const m of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

const light = block(css, ':root');
const dark = block(css, ":root\\[data-theme='dark'\\]");

function channel(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(hexA, hexB) {
  const a = luminance(hexA),
    b = luminance(hexB);
  const lighter = Math.max(a, b),
    darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const READ_SURFACES = ['surface-sidebar', 'surface-app', 'surface-panel', 'surface-raised', 'surface-hover', 'surface-dropzone'];
const UI_SURFACES = ['surface-sidebar', 'surface-app', 'surface-panel'];

for (const [name, theme] of [
  ['light', light],
  ['dark', dark]
]) {
  test(`${name} theme: primary and secondary text are readable on every read surface`, () => {
    for (const surface of READ_SURFACES) {
      for (const role of ['text-primary', 'text-secondary']) {
        const ratio = contrast(theme[role], theme[surface]);
        assert.ok(ratio >= 4.5, `--${role} on --${surface} is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
      }
    }
  });

  test(`${name} theme: primary text is readable on the active surface`, () => {
    const ratio = contrast(theme['text-primary'], theme['surface-active']);
    assert.ok(ratio >= 4.5, `--text-primary on --surface-active is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
  });

  test(`${name} theme: tertiary text clears the lower bar on read surfaces`, () => {
    for (const surface of ['surface-sidebar', 'surface-app', 'surface-panel', 'surface-dropzone']) {
      const ratio = contrast(theme['text-tertiary'], theme[surface]);
      assert.ok(ratio >= 3, `--text-tertiary on --${surface} is ${ratio.toFixed(2)}:1, need >= 3:1`);
    }
  });

  test(`${name} theme: accent text is readable on every surface it appears on`, () => {
    for (const surface of ['surface-sidebar', 'surface-app', 'surface-panel', 'surface-hover']) {
      const ratio = contrast(theme['accent-text'], theme[surface]);
      assert.ok(ratio >= 4.5, `--accent-text on --${surface} is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
    }
  });

  test(`${name} theme: white text is readable on the accent fills that carry it`, () => {
    for (const fill of ['accent-strong', 'accent-strong-hover']) {
      const ratio = contrast(theme['text-on-accent'], theme[fill]);
      assert.ok(ratio >= 4.5, `--text-on-accent on --${fill} is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
    }
  });

  test(`${name} theme: accent and the focus ring clear the UI-component contrast bar`, () => {
    for (const role of ['accent', 'ring']) {
      for (const surface of UI_SURFACES) {
        const ratio = contrast(theme[role], theme[surface]);
        assert.ok(ratio >= 3, `--${role} on --${surface} is ${ratio.toFixed(2)}:1, need >= 3:1`);
      }
    }
  });

  test(`${name} theme: danger text is readable`, () => {
    for (const surface of UI_SURFACES) {
      const ratio = contrast(theme['danger-text'], theme[surface]);
      assert.ok(ratio >= 4.5, `--danger-text on --${surface} is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
    }
  });
}

test('light theme: accent text is readable on the opaque mint fill', () => {
  const ratio = contrast(light['accent-text'], light['accent-soft']);
  assert.ok(ratio >= 4.5, `--accent-text on --accent-soft is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
});

test('dark theme: accent text is readable on the translucent mint fill, composited over the app surface', () => {
  // --accent-soft is `rgb(16 163 127 / .16)` in dark (translucent by design). Composited at
  // 16% alpha over --surface-app (#111827): rgb(17,46,53) = #112E35. See Task B1 of
  // docs/superpowers/plans/2026-09-22-look-and-shell-foundation.md for the derivation.
  const ratio = contrast(dark['accent-text'], '#112e35');
  assert.ok(ratio >= 4.5, `--accent-text on the composited dark mint is ${ratio.toFixed(2)}:1, need >= 4.5:1`);
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp node --test tests/tokens.test.cjs
```

Expected: `Block not found for pattern: :root\[data-theme='dark'\]` (today's `tokens.css` has `:root[data-theme='light']`, not a `dark` block — dark is the unlabeled default). This is the expected red; Task B2 makes it pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tokens.test.cjs
git commit -m "test: add token contrast checks for the light-first palette (red)"
```

---

### Task B2: Rewrite `tokens.css` to the spec's light-first palette (green)

Re-point the semantic layer only. The primitive layer (`--slate-*`, `--green-*`, `--red-*`, `--amber-*`, spacing, radii, etc.) and the component layer (`--sidebar-width`, `--control-height-*`, etc.) are unchanged except for two things: `--font-sans` picks up the spec's stack, and the dead `--axon-*` block is deleted. Tokens not named in the spec's table (`--surface-code`, `--text-code`, `--danger*`, `--warning-text`, `--shadow-*`) keep their exact current values, just moved into the new light-default / `[data-theme='dark']` structure.

**Files:**
- Modify: `src/renderer/src/tokens.css` (full rewrite)

**Interfaces:**
- Produces: every semantic token component CSS already references by name (`--surface-app`, `--text-primary`, `--accent`, `--ring`, …), now resolving to new values, plus five new ones: `--surface-dropzone`, `--accent-strong`, `--accent-strong-hover`, `--hue-blue`, `--hue-green`, `--hue-purple`. No component CSS file needs to change in this task — they already consume these tokens by name.

- [ ] **Step 1: Replace the full contents of `src/renderer/src/tokens.css`**

```css
/*
 * Axon design tokens — three layers (see design-system/axon/MASTER.md).
 *   1. Primitive : raw values, never referenced by components directly.
 *   2. Semantic  : purpose-named aliases; the only layer components may use.
 *   3. Component : per-component knobs that alias semantic tokens.
 * Light is the default theme; dark re-points the semantic layer only.
 */

:root {
  /* ---------- 1. Primitive ---------- */
  --slate-50: #f8fafc;
  --slate-100: #f1f5f9;
  --slate-200: #e2e8f0;
  --slate-300: #cbd5e1;
  --slate-400: #94a3b8;
  --slate-500: #64748b;
  --slate-600: #475569;
  --slate-700: #334155;
  --slate-800: #1e293b;
  --slate-850: #1b2336;
  --slate-875: #172032;
  --slate-900: #0f172a;
  --slate-950: #0b1120;

  --green-400: #4ade80;
  --green-500: #22c55e;
  --green-600: #16a34a;
  --green-700: #15803d;

  --red-400: #f87171;
  --red-500: #ef4444;
  --red-700: #b91c1c;

  --amber-400: #fbbf24;
  --amber-600: #d97706;

  --font-sans: Inter, 'SF Pro Text', -apple-system, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Cascadia Code', Consolas, 'SF Mono', Menlo, monospace;
  --font-doodle: 'Caveat', cursive;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 16px;
  --text-lg: 20px;
  --text-xl: 28px;
  --text-display: 36px;

  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  --leading-tight: 1.25;
  --leading-base: 1.5;
  --leading-relaxed: 1.7;

  --tracking-tight: -0.02em;
  --tracking-caps: 0.06em;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 999px;

  --icon-sm: 14px;
  --icon-md: 16px;
  --icon-lg: 20px;
  --icon-xl: 32px;

  --duration-fast: 120ms;
  --duration-base: 200ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);

  /* ---------- 2. Semantic (light, default) ---------- */
  color-scheme: light;

  --surface-sidebar: #f7f8fa;
  --surface-app: #ffffff;
  --surface-panel: #ffffff;
  --surface-raised: #ffffff;
  --surface-hover: #f1f4f8;
  --surface-active: #e8edf3;
  --surface-dropzone: #f9fbfc;
  --surface-code: #111827;
  --surface-scrim: rgb(17 24 39 / 0.45);

  --border-subtle: #eef0f4;
  --border-default: #e5e7eb;
  --border-strong: #d0d5dd;

  --text-primary: #111827;
  --text-secondary: #667085;
  --text-tertiary: #808a9e;
  --text-on-accent: #ffffff;
  --text-code: #f1f4f8;

  --accent: #10a37f;
  --accent-hover: #0e8c6d;
  --accent-strong: #0c8567;
  --accent-strong-hover: #0b7a5e;
  --accent-text: #0b7a5e;
  --accent-soft: #ddf7f0;

  --danger: var(--red-700);
  --danger-text: var(--red-700);
  --danger-soft: rgb(185 28 28 / 0.08);

  --warning-text: var(--amber-600);

  --ring: #7c3aed;
  --shadow-panel: 0 1px 3px rgb(0 0 0 / 0.04), 0 1px 2px rgb(0 0 0 / 0.02);
  --shadow-overlay: 0 12px 32px rgb(0 0 0 / 0.06);

  --hue-blue: #2a47c9;
  --hue-green: #198c67;
  --hue-purple: #5b3cd1;

  /* ---------- 3. Component ---------- */
  --control-height-sm: 28px;
  --control-height-md: 36px;
  --control-radius: var(--radius-sm);
  --control-padding-x: var(--space-3);

  --card-radius: var(--radius-md);
  --card-padding: var(--space-5);

  --overlay-radius: var(--radius-lg);
  --overlay-padding: var(--space-6);
  --overlay-width: 560px;

  --sidebar-width: 264px;
  --topbar-height: 56px;
  --inset-panel: var(--space-4);
  --inset-page: clamp(var(--space-6), 4vw, var(--space-12));
  --page-max-width: 1120px;
  --reading-max-width: 800px;
}

:root[data-theme='dark'] {
  color-scheme: dark;

  --surface-sidebar: #0b0f17;
  --surface-app: #111827;
  --surface-panel: #151e2e;
  --surface-raised: #1a2436;
  --surface-hover: #1b2536;
  --surface-active: #223047;
  --surface-dropzone: #0f1623;
  --surface-code: var(--slate-950);
  --surface-scrim: rgb(2 6 23 / 0.7);

  --border-subtle: #1b2433;
  --border-default: #263246;
  --border-strong: #334259;

  --text-primary: #f3f4f6;
  --text-secondary: #9ca3af;
  --text-tertiary: #6b7686;
  --text-on-accent: #ffffff;
  --text-code: var(--slate-200);

  --accent: #10a37f;
  --accent-hover: var(--green-400);
  --accent-strong: #0c8567;
  --accent-strong-hover: #0b7a5e;
  --accent-text: #34d399;
  --accent-soft: rgb(16 163 127 / 0.16);

  --danger: var(--red-500);
  --danger-text: var(--red-400);
  --danger-soft: rgb(239 68 68 / 0.12);

  --warning-text: var(--amber-400);

  --ring: #a78bfa;
  --shadow-panel: 0 1px 2px rgb(0 0 0 / 0.3);
  --shadow-overlay: 0 24px 64px rgb(0 0 0 / 0.5);

  --hue-blue: #7c93f0;
  --hue-green: #3fbf95;
  --hue-purple: #a78bfa;
}
```

- [ ] **Step 2: Run the contrast test — confirm green**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp node --test tests/tokens.test.cjs
```

Expected: every test passes. If any assertion fails, the error message names the exact token pair and ratio — cross-check it against §4.1's table in the spec before changing anything (the spec's own 2026-09-21 audit found 0 failures with these exact values, so a failure here most likely means a typo in the CSS, not a wrong requirement).

- [ ] **Step 3: Run the full suite and typecheck**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test
npm run typecheck
```

`npm run typecheck` is expected to **still fail** here with `Cannot find module './theme'` (from Task A4's `Chat.tsx`) — that's expected until Task B4. `npm test` (which doesn't type-check) should be fully green (46 tests: the original 45 plus the new token tests).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/tokens.css
git commit -m "feat: re-point tokens.css to the spec's light-first palette"
```

---

### Task B3: Bundle Inter and Caveat locally

**Files:**
- Modify: `package.json` (devDependencies)
- Modify: `src/renderer/src/main.tsx` (font imports)

**Interfaces:**
- Produces: `Inter` (400–700 weights) and `Caveat` (500) available to the renderer with no network access, consumed by `--font-sans` and `--font-doodle` (already updated in Task B2).

- [ ] **Step 1: Add the font packages as devDependencies**

```bash
npm install --save-dev --cache "D:\axon-npm-cache" @fontsource-variable/inter@^5 @fontsource/caveat@^5
```

This adds two lines to `package.json`'s `"devDependencies"` block, alongside `lucide-react`:

```json
    "@fontsource-variable/inter": "^5.x.x",
    "@fontsource/caveat": "^5.x.x",
```

(Exact resolved versions are whatever `npm install` picks — don't hand-edit the version strings.)

- [ ] **Step 2: Import the fonts in `main.tsx`**

In `src/renderer/src/main.tsx`, add two imports above the existing `import './style.css';` line:

```tsx
import '@fontsource-variable/inter';
import '@fontsource/caveat/500.css';
import './style.css';
import 'highlight.js/styles/github-dark.css';
```

- [ ] **Step 3: Build and confirm no errors**

```bash
npm run build
```

Expected: build succeeds; check the terminal output for any "module not found" errors related to the two new packages. (Automated `document.fonts.check` verification happens later, in the `electron-smoke.cjs` repair that's part of the shell-phase plan — this task only confirms the packages resolve and bundle.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/src/main.tsx
git commit -m "feat: bundle Inter and Caveat locally, no runtime font requests"
```

---

### Task B4: New `theme.ts`; wire it into `App.tsx` and fix `Chat.tsx`'s non-reactive toggle

Today's theme toggle (in `Chat.tsx`'s topbar) reads `document.documentElement.dataset.theme` directly at render time and writes it back to the DOM in its `onClick`, bypassing the store — so nothing that depends on `data.settings.theme` re-renders when it's clicked (finding #10 in the spec). This task centralizes theme resolution in one module and makes the toggle go through the store like every other setting.

This task does **not** change the toggle's appearance (still a bordered ghost icon button showing the *target* mode) — that's a visual cleanup (finding #16) that belongs to a later, shell-phase plan.

**Files:**
- Create: `src/renderer/src/theme.ts`
- Modify: `src/renderer/src/App.tsx:48-59` (replace the inline theme effect)
- Modify: `src/renderer/src/Chat.tsx` (already reflects the fixed toggle from Task A4's Step 2 — this task just confirms `./theme` now resolves)

**Interfaces:**
- Produces: `resolveTheme(theme: Settings['theme']): 'light' | 'dark'`; `useThemeSync(theme: Settings['theme'] | undefined): void` (a hook); `setTheme(settings: Settings, theme: Settings['theme']): Promise<void>`. Consumed by `App.tsx` and `Chat.tsx` (already wired in Task A4).

- [ ] **Step 1: Create `src/renderer/src/theme.ts`**

```ts
import { useEffect } from 'react';
import { perform } from './state';
import type { Settings } from '../../shared/types';

/** Resolves 'system' against the OS preference; 'light'/'dark' pass through unchanged. */
export function resolveTheme(theme: Settings['theme']): 'light' | 'dark' {
  if (theme === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return theme;
}

/**
 * Applies the resolved theme to <html data-theme> and keeps it in sync with OS changes
 * while the setting is 'system'. Call once, at the app root.
 */
export function useThemeSync(theme: Settings['theme'] | undefined): void {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme ?? 'light');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Persists a theme choice through the normal settings path, so every reader re-renders. */
export function setTheme(settings: Settings, theme: Settings['theme']): Promise<void> {
  return perform(() => window.axon.settingsSave({ ...settings, theme }));
}
```

- [ ] **Step 2: Replace the inline theme effect in `App.tsx`**

In `src/renderer/src/App.tsx`, add the import:

```ts
import { useThemeSync } from './theme';
```

and replace the existing effect (currently `App.tsx:48-59`):

```tsx
  // Theme: resolve 'system' against the OS preference and keep it in sync.
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = data?.settings.theme ?? 'light';
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data?.settings.theme]);
```

with:

```tsx
  useThemeSync(data?.settings.theme);
```

(`useEffect` may now be unused elsewhere in `App.tsx` — check before removing its import; the streaming-sync effect further down still uses it, so the import stays.)

- [ ] **Step 3: Run typecheck and the full test suite**

```bash
npm run typecheck
TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test
```

Expected: both fully green now — this is the first point since Task A4 where `./theme` resolves, so typecheck should pass end to end (46 tests, 0 typecheck errors).

- [ ] **Step 4: Manual check — theme toggle is now reactive**

```bash
npm run dev
```

Open the app, go to a Chat page, click the theme toggle in the topbar. Confirm the whole app (sidebar, cards, etc.) flips theme immediately — not just the icon. Also open Settings → Appearance and confirm the theme `<select>` there reflects the same value and stays in sync after using the topbar toggle. Close the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/theme.ts src/renderer/src/App.tsx
git commit -m "fix: centralize theme resolution in theme.ts, make the toggle reactive"
```

---

### Task B5: `Settings.profile` and `uiVersion` — types, migration, validation

Adds the two new `Settings` fields the rest of the redesign needs (a real profile for the sidebar user card, and a version counter so the one-time dark→light flip never repeats), with the repository migration and service-layer validation the spec requires.

**Files:**
- Modify: `src/shared/types.ts:189-200` (`Settings` interface)
- Modify: `src/main/repository.ts` (`initialState()`, `migrate()`)
- Modify: `src/main/service.ts:113-117` (`settingsSave`)
- Modify: `tests/repository.test.cjs` (new tests)
- Modify: `tests/service.test.cjs` (new test)

**Interfaces:**
- Produces: `Settings.profile: { name: string; email: string }`, `Settings.uiVersion: number`. Consumed by the sidebar user card and Settings → Profile tab in a later plan; consumed internally by `repository.ts`'s migration and `service.ts`'s validation in this task.

- [ ] **Step 1: Write the failing repository tests**

Add to `tests/repository.test.cjs` (after the existing `'migrate defaults skillIds/roleIds...'` test):

```js
test('migrate flips a legacy dark theme to light once and defaults profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-repo-'));
  try {
    const db = path.join(dir, 'db');
    fs.mkdirSync(db);
    const legacy = {
      version: 1, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [],
      settings: { theme: 'dark', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
    };
    fs.writeFileSync(path.join(db, 'platform-v1.json'), JSON.stringify(legacy));
    const repo = new Repository(db, path.join(dir, 'backups'));
    assert.equal(repo.state.settings.theme, 'light', 'a legacy dark theme is flipped to light once');
    assert.deepEqual(repo.state.settings.profile, { name: '', email: '' });
    assert.equal(repo.state.settings.uiVersion, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migrate leaves an explicit light or system theme untouched', () => {
  for (const theme of ['light', 'system']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-repo-'));
    try {
      const db = path.join(dir, 'db');
      fs.mkdirSync(db);
      const legacy = {
        version: 1, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [],
        settings: { theme, autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
      };
      fs.writeFileSync(path.join(db, 'platform-v1.json'), JSON.stringify(legacy));
      const repo = new Repository(db, path.join(dir, 'backups'));
      assert.equal(repo.state.settings.theme, theme);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the dark-to-light migration does not repeat once uiVersion is current', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-repo-'));
  try {
    const db = path.join(dir, 'db');
    fs.mkdirSync(db);
    const migrated = {
      version: 1, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [],
      settings: { theme: 'dark', uiVersion: 2, profile: { name: '', email: '' }, autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
    };
    fs.writeFileSync(path.join(db, 'platform-v1.json'), JSON.stringify(migrated));
    const repo = new Repository(db, path.join(dir, 'backups'));
    assert.equal(repo.state.settings.theme, 'dark', 'uiVersion is already current, so an explicit dark choice is respected');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp node --test tests/repository.test.cjs
```

Expected: the three new tests fail — `repo.state.settings.theme` is still `'dark'` (no migration exists yet) and `repo.state.settings.profile` is `undefined`.

- [ ] **Step 3: Write the failing service test**

Add to `tests/service.test.cjs` (after the existing tests):

```js
test('settingsSave validates and trims profile fields, and ignores a renderer-supplied uiVersion', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = repo.state.settings;

  await service.settingsSave({ ...base, profile: { name: '  Alex  ', email: ' alex@axon.ai ' }, uiVersion: 999 });
  assert.deepEqual(repo.state.settings.profile, { name: 'Alex', email: 'alex@axon.ai' });
  assert.equal(repo.state.settings.uiVersion, base.uiVersion, 'uiVersion is owned by main, not the renderer');

  await assert.rejects(service.settingsSave({ ...base, profile: { name: 'x'.repeat(61), email: '' } }), /60 characters/);
  await assert.rejects(service.settingsSave({ ...base, profile: { name: '', email: 'x'.repeat(121) } }), /120 characters/);
  await assert.rejects(service.settingsSave({ ...base, profile: { name: '', email: 'not-an-email' } }), /valid email/);
});
```

- [ ] **Step 4: Run it and confirm it fails**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp node --test tests/service.test.cjs
```

Expected: fails — `service.settingsSave` doesn't know about `profile` yet, so `repo.state.settings.profile` stays `undefined` and none of the `assert.rejects` calls see their expected errors (the current implementation doesn't validate profile at all, so those calls resolve instead of rejecting).

- [ ] **Step 5: Add `profile`/`uiVersion` to the `Settings` type**

In `src/shared/types.ts`, change the `Settings` interface (currently lines 189–200):

```ts
export interface Settings {
  theme: 'dark' | 'light' | 'system';
  autoTitleConversations: boolean;
  defaultTemperature: number;
  defaultMaxTokens: number;
  streamDeltas: boolean;
  /** When true, the Code workspace may execute allow-listed shell commands. */
  allowShellExecution: boolean;
  shellAllowlist: string[];
  sendCrashDiagnostics: boolean;
  dataDirectoryNote: string;
  profile: { name: string; email: string };
  /** Schema version for one-time UI migrations (e.g. the dark->light default flip). Owned by main. */
  uiVersion: number;
}
```

- [ ] **Step 6: Update `initialState()` in `repository.ts`**

In `src/main/repository.ts`, change the `settings` object inside `initialState()`:

```ts
    settings: { theme: 'light', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096,
      streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '',
      profile: { name: '', email: '' }, uiVersion: 2 },
```

(only `theme: 'dark'` → `theme: 'light'` and the two new fields change; everything else in `initialState()` stays as-is.)

- [ ] **Step 7: Add the migration to `migrate()` in `repository.ts`**

At the end of the `private migrate(state: PlatformState): void` method body (after the existing `codeWs` block), add:

```ts
    if (state.settings) {
      state.settings.profile ??= { name: '', email: '' };
      const uiVersion = state.settings.uiVersion ?? 0;
      if (uiVersion < 2) {
        if (state.settings.theme === 'dark') state.settings.theme = 'light';
        state.settings.uiVersion = 2;
      } else {
        state.settings.uiVersion = uiVersion;
      }
    }
```

- [ ] **Step 8: Update `settingsSave` in `service.ts`**

In `src/main/service.ts`, replace the `settingsSave` method (currently lines 113–117):

```ts
  async settingsSave(s: Parameters<PlatformAPI['settingsSave']>[0]): Promise<void> {
    if (!['dark', 'light', 'system'].includes(s.theme) || !Number.isInteger(s.defaultMaxTokens) || s.defaultMaxTokens < 256 || s.defaultMaxTokens > 32768) throw new Error('Invalid settings.');
    const name = (s.profile?.name ?? '').trim();
    const email = (s.profile?.email ?? '').trim();
    if (name.length > 60) throw new Error('Name must be 60 characters or fewer.');
    if (email.length > 120) throw new Error('Email must be 120 characters or fewer.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    this.state.settings = {
      ...s,
      allowShellExecution: Boolean(s.allowShellExecution),
      shellAllowlist: s.shellAllowlist || [],
      sendCrashDiagnostics: Boolean(s.sendCrashDiagnostics),
      profile: { name, email },
      uiVersion: this.state.settings.uiVersion
    };
    await this.repo.save();
  }
```

- [ ] **Step 9: Run both test files and confirm green**

```bash
TEMP=D:\axon-tmp TMP=D:\axon-tmp node --test tests/repository.test.cjs tests/service.test.cjs
```

Expected: all tests pass, including the four new ones from Steps 1 and 3.

- [ ] **Step 10: Run the full suite, typecheck, and build**

```bash
npm run typecheck
TEMP=D:\axon-tmp TMP=D:\axon-tmp npm test
npm run build
```

Expected: all three green. `npm test` should report 50 tests (45 original + 1 from B1 file-level count adjustment — see note below — + 3 repository + 1 service; exact count depends on how `node --test` reports per-`test()` calls in `tokens.test.cjs`, which registers more than one `test()` per theme — don't worry about matching an exact number, just confirm `fail: 0`).

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/main/repository.ts src/main/service.ts tests/repository.test.cjs tests/service.test.cjs
git commit -m "feat: add Settings.profile and uiVersion, with a one-time dark->light migration"
```

---

## Exit checklist (before starting the next plan — window chrome & shell)

- [ ] `npm run typecheck`, `npm test`, `npm run build` all green (`TEMP=D:\axon-tmp TMP=D:\axon-tmp` set for any test run).
- [ ] `npx prettier --check "src/renderer/src/**/*.{ts,tsx,css}"` — run it; if it reports files, run `npm run format` and commit the formatting separately (Prettier wasn't part of any task's own verification above, so this is the first time it's checked across the new files).
- [ ] `npm run dev` — open every existing page (Chat, Code, Knowledge, Agents, Workspaces, Settings) in both themes via the Settings → Appearance selector, confirm nothing looks broken and the app is legibly light-first. This isn't one of the spec's formal checkpoints (those start at the window-chrome phase), but Task B2 changes colors app-wide, so a quick look is worth it before building on top of it.
- [ ] `test:desktop` is still known-broken (pre-existing — it expects `.welcome` and a `button[aria-label="Create workspace"]`, from before this branch). Confirm you haven't made it *worse* (same failure message as before Group A/B started, not a new one) — its repair is explicitly scoped to a later plan, once the shell it's asserting against actually exists.
