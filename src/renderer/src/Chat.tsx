import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Code,
  Copy,
  FileCode,
  FileText,
  FileUp,
  Globe,
  Lightbulb,
  MessageSquare,
  Mic,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Sparkles,
  Square,
  Sun,
  Trash2,
  User,
  Wrench,
  X
} from 'lucide-react';
import { useApp, perform } from './state';
import { timeAgo } from './format';
import { Button, Icon } from './ui';
import { RolePicker, SkillPicker, SelectionChips } from './ui/CatalogPicker';
import { ApprovalCard } from './ui/ApprovalCard';
import type { Selection } from '../../shared/types';

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

const starterCards = [
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

const quickPills = [
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

const slashCommands = [
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

/** Flattens the highlighted element tree back into the raw source for copying. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  return '';
}

/** Fenced code block with a language label and a copy button. */
function CodeBlock({ children }: { children?: ReactNode }) {
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

  const matchingSlash =
    input.startsWith('/') && !input.includes(' ')
      ? slashCommands.filter((sc) => sc.cmd.toLowerCase().startsWith(input.toLowerCase()))
      : [];

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

  const hint = codeContext?.path
    ? `Sharing ${codeContext.path} (up to 30k characters)`
    : workspace?.knowledgeDocIds.length
      ? `${workspace.knowledgeDocIds.length} knowledge source${workspace.knowledgeDocIds.length === 1 ? '' : 's'}`
      : 'Shift + Enter for a new line';

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
            onClick={() => {
              const cur = document.documentElement.dataset.theme || 'light';
              const next = cur === 'dark' ? 'light' : 'dark';
              document.documentElement.dataset.theme = next;
              if (data?.settings) {
                void window.axon.settingsSave({ ...data.settings, theme: next });
              }
            }}
          >
            <Icon
              icon={(document.documentElement.dataset.theme || 'light') === 'dark' ? Sun : Moon}
              size="sm"
            />
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
                    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
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
                void perform(async () => {
                  const files = (await window.axon.attach()).slice(0, 5);
                  setAttachments(files);
                });
              }}
            >
              <div className="dropzone-icon">
                <Icon icon={FileUp} size="lg" />
              </div>
              <h4 className="dropzone-title">Drag and drop files here</h4>
              <p className="dropzone-sub">Attach PDFs, code, images or any file to add context</p>
              <button
                type="button"
                className="btn-choose-files"
                onClick={() =>
                  void perform(async () => {
                    const files = (await window.axon.attach()).slice(0, 5);
                    setAttachments(files);
                  })
                }
              >
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
                    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                  }}
                >
                  <Icon icon={pill.icon} size="sm" />
                  <span>{pill.label}</span>
                </button>
              ))}
            </div>

            {!model && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
                <Button variant="primary" onClick={() => patch({ page: 'settings' })}>
                  Connect a provider in Settings
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="messages">
            {messages.map((m) => (
              <article key={m.id} className={`message ${m.role}${m.streaming ? ' streaming' : ''}`}>
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
                              <div style={{ color: 'var(--danger-text)', marginTop: 'var(--space-2)' }}>
                                {tc.error}
                              </div>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Copy}
                        onClick={() =>
                          void perform(() => navigator.clipboard.writeText(m.content), 'Copied to clipboard')
                        }
                      >
                        Copy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={RefreshCw}
                        disabled={busy}
                        onClick={() => {
                          const idx = messages.findIndex((msg) => msg.id === m.id);
                          const prevUser = [...messages.slice(0, idx)]
                            .reverse()
                            .find((msg) => msg.role === 'user');
                          if (prevUser) {
                            void send(prevUser.content);
                          }
                        }}
                      >
                        Regenerate
                      </Button>
                    </div>
                  )}
                  {m.role === 'user' && m.content && (
                    <div className="message-actions">
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setInput(m.content)}>
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {Object.values(pendingApprovals)
              .filter((req) => req.conversationId === chatId)
              .map((req) => (
                <ApprovalCard
                  key={req.id}
                  request={req}
                  onDecision={(approved, alwaysAllowSession) => {
                    const next = { ...pendingApprovals };
                    delete next[req.id];
                    patch({ pendingApprovals: next });
                    void window.axon.toolApprove({
                      requestId: req.id,
                      approved,
                      alwaysAllowSession
                    });
                  }}
                />
              ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="composer-wrap">
        {!atBottom && messages.length > 0 && (
          <button
            className="jump-latest"
            onClick={() => {
              follow.current = true;
              setAtBottom(true);
              bottom.current?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
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
                          input.slice(0, lastAt) +
                          '@' +
                          f +
                          ' ' +
                          input.slice(lastAt + 1 + mentionQuery.length);
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
            placeholder={
              model
                ? 'Message Axon…'
                : 'Connect a provider in Settings to start.'
            }
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
                        input.slice(0, lastAt) +
                        '@' +
                        f +
                        ' ' +
                        input.slice(lastAt + 1 + mentionQuery.length);
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
                void send();
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
          <SelectionChips selection={selection} inherited={inherited} onRemove={removeOne} />
          <div className="composer-bar">
            <button
              type="button"
              className="btn-circle-attach"
              aria-label="Attach files"
              title="Attach files"
              onClick={() =>
                void perform(async () => {
                  setAttachments((await window.axon.attach()).slice(0, 5));
                })
              }
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

            <button
              type="button"
              className="composer-tool-pill"
              onClick={() => patch({ page: 'knowledge' })}
              title="Knowledge Sources"
            >
              <Icon icon={BookOpen} size="sm" />
              <span>Knowledge</span>
              {workspace?.knowledgeDocIds?.length ? ` · ${workspace.knowledgeDocIds.length}` : ''}
            </button>

            <button
              type="button"
              className="composer-tool-pill"
              onClick={() => setPicker('roles')}
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
                <button
                  type="button"
                  className="btn-circle-send"
                  aria-label="Stop generating"
                  onClick={() => chatId && void perform(() => window.axon.chatStop(chatId))}
                >
                  <Icon icon={Square} size="sm" />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-circle-send"
                  aria-label="Send message"
                  disabled={!input.trim() || !model}
                  onClick={() => void send()}
                >
                  <Icon icon={ArrowUp} size="sm" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="composer-note-clean">
          Shift + Enter for new line
        </p>
      </div>
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
