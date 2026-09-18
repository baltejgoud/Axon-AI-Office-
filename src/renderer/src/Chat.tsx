import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  ArrowUp,
  Bot,
  ClipboardList,
  Code,
  Compass,
  Copy,
  Loader,
  Paperclip,
  Pencil,
  PenLine,
  Puzzle,
  Sparkles,
  Square,
  Trash2,
  User,
  X
} from 'lucide-react';
import { useApp, perform } from './state';
import { Button, Icon } from './ui';
import { RolePicker, SkillPicker, SelectionChips } from './ui/CatalogPicker';
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
  return (
    <select
      className={size === 'sm' ? 'select select-sm' : 'select'}
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
  );
}

const suggestions = [
  {
    icon: ClipboardList,
    label: 'Plan a project',
    prompt: 'Help me turn this idea into a concrete plan with milestones.'
  },
  { icon: Code, label: 'Review some code', prompt: 'Review this code for bugs, clarity and edge cases.' },
  {
    icon: Compass,
    label: 'Explore an idea',
    prompt: 'Help me think through this problem from a few different angles.'
  },
  {
    icon: PenLine,
    label: 'Tighten some writing',
    prompt: 'Make this message shorter and clearer without losing the point.'
  }
];

export function Chat({ codeContext }: { codeContext?: { path: string; text: string } }) {
  const { data, chatId, workspaceId, model, patch, pendingSelection } = useApp();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; name: string }[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [picker, setPicker] = useState<'skills' | 'roles' | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  const chat = data!.conversations.find((c) => c.id === chatId);
  const workspace = data!.workspaces.find((w) => w.id === (codeContext ? 'code' : workspaceId));
  const messages = data!.messages.filter((m) => m.conversationId === chatId && m.role !== 'system');
  const busy = sending || messages.some((m) => m.streaming);
  const selection: Selection = chat ? { skillIds: chat.skillIds, roleIds: chat.roleIds } : pendingSelection;
  const inherited: Selection = { skillIds: workspace?.skillIds ?? [], roleIds: workspace?.roleIds ?? [] };
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
    if (!chatId) patch({ pendingSelection: { skillIds: [], roleIds: [] } });
  }, [chatId, workspaceId]);

  async function send(): Promise<void> {
    if (!input.trim() || busy) return;
    setSending(true);
    await perform(async () => {
      let id = chatId;
      if (!id) {
        const [provider, ...rest] = model.split('::');
        const created = await window.axon.chatCreate(
          provider,
          rest.join('::'),
          codeContext ? 'code' : workspaceId,
          undefined,
          pendingSelection
        );
        id = created.id;
        patch({ chatId: id, pendingSelection: { skillIds: [], roleIds: [] } });
      }
      const context = codeContext?.path
        ? `\n\nCurrent editor file: ${codeContext.path}\n\`\`\`\n${codeContext.text.slice(0, 30000)}\n\`\`\``
        : '';
      const content = input + context;
      const ids = attachments.map((a) => a.id);
      setInput('');
      setAttachments([]);
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
        <div className="breadcrumb">
          <span>{codeContext ? 'Code' : workspace?.name || 'Chat'}</span>
          <span className="breadcrumb-sep">/</span>
          <strong>{chat?.title || 'New conversation'}</strong>
        </div>
        <div className="topbar-actions">
          <ModelSelect
            size="sm"
            disabled={Boolean(chat)}
            value={chat ? `${chat.providerId}::${chat.modelId}` : model}
            onChange={(v) => patch({ model: v })}
          />
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
        }}
      >
        {!messages.length ? (
          <div className="welcome">
            <span className="icon-tile">
              <Icon icon={Sparkles} size="lg" />
            </span>
            <h1>{workspace?.name ?? 'What are you working on?'}</h1>
            <p>
              {workspace?.description ||
                'Messages go to the model selected above. Attach files or add knowledge sources for context.'}
            </p>
            <div className="suggestions">
              {suggestions.map(({ icon, label, prompt }) => (
                <button key={label} className="suggestion" onClick={() => setInput(prompt)}>
                  <span className="suggestion-title">
                    <Icon icon={icon} />
                    {label}
                  </span>
                  <p>{prompt}</p>
                </button>
              ))}
            </div>
            {!model && (
              <Button variant="primary" onClick={() => patch({ page: 'settings' })}>
                Connect a provider
              </Button>
            )}
          </div>
        ) : (
          <div className="messages">
            {messages.map((m) => (
              <article key={m.id} className={`message ${m.role}`}>
                <div className="message-avatar">
                  <Icon icon={m.role === 'user' ? User : Sparkles} size="sm" />
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    <strong>{m.role === 'user' ? 'You' : 'Axon'}</strong>
                    {m.modelId && <span className="text-caption">{m.modelId}</span>}
                    {m.streaming && (
                      <span className="message-status">
                        <Icon icon={Loader} size="sm" />
                        Generating
                      </span>
                    )}
                  </div>
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                    components={{
                      img: ({ alt }) => <span>[Image: {alt}]</span>,
                      a: ({ children }) => <span className="message-link">{children}</span>
                    }}
                  >
                    {m.content || (m.streaming ? 'Thinking…' : '')}
                  </Markdown>
                  {m.error && <p className="message-error">{m.error}</p>}
                  {m.role === 'assistant' && m.content && (
                    <div className="message-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Copy}
                        onClick={() => void perform(() => navigator.clipboard.writeText(m.content))}
                      >
                        Copy
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            aria-label="Message"
            placeholder={
              model ? `Message ${workspace?.name || 'Axon'}…` : 'Connect a provider in Settings to start.'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
            <Button
              variant="ghost"
              size="sm"
              icon={Paperclip}
              onClick={() =>
                void perform(async () => {
                  setAttachments((await window.axon.attach()).slice(0, 5));
                })
              }
            >
              Attach
            </Button>
            <Button variant="ghost" size="sm" icon={Bot} onClick={() => setPicker('roles')}>
              Roles
              {selection.roleIds.length + inherited.roleIds.length
                ? ` · ${new Set([...inherited.roleIds, ...selection.roleIds]).size}`
                : ''}
            </Button>
            <Button variant="ghost" size="sm" icon={Puzzle} onClick={() => setPicker('skills')}>
              Skills
              {selection.skillIds.length + inherited.skillIds.length
                ? ` · ${new Set([...inherited.skillIds, ...selection.skillIds]).size}`
                : ''}
            </Button>
            <span className="composer-hint">{hint}</span>
            {busy ? (
              <Button
                variant="secondary"
                icon={Square}
                iconOnly
                aria-label="Stop generating"
                onClick={() => chatId && void perform(() => window.axon.chatStop(chatId))}
              />
            ) : (
              <Button
                variant="primary"
                icon={ArrowUp}
                iconOnly
                aria-label="Send message"
                disabled={!input.trim() || !model}
                onClick={() => void send()}
              />
            )}
          </div>
        </div>
        <p className="composer-note">
          Messages and selected content are sent to your chosen provider. Check important answers.
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
