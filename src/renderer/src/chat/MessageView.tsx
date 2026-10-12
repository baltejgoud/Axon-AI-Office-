import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import type { Message, ToolCall } from '../../../shared/types';
import { perform, useApp } from '../state';
import { timeAgo } from '../format';
import {
  Button,
  IconBook,
  IconCheck,
  IconCompose,
  IconCopy,
  IconPaperclip,
  IconSparkle,
  IconTerminal,
  IconUser
} from '../ui';
import './rewrite.css';
import { skillChip, toolPresentation } from './workPresentation';
import { MessageMarkdown } from './MessageMarkdown';
import { useReading, worthReading } from './reading';
import { visibleUserText } from '../../../shared/user-text';
export { visibleUserText };

/** Messages of yours longer than this start folded, with Show more. */
const FOLD_AT = { chars: 600, lines: 8 };

/** The standard card for a tool call: its name and state, opening to its arguments and result. */
export function ToolCallDetails({ call: tc, conversationId }: { call: ToolCall; conversationId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [fullOutput, setFullOutput] = useState<{
    content: string;
    nextOffset?: number;
    total: number;
  } | null>(null);
  const presentation = toolPresentation(tc);
  const loadOutput = async () => {
    const id =
      conversationId ??
      useApp
        .getState()
        .data?.messages.find((m) =>
          tc.outputArtifactId ? m.toolOutputId === tc.outputArtifactId : m.toolCallId === tc.id
        )?.conversationId;
    if (!id) return;
    const next = await window.axon.readToolArtifact(
      id,
      tc.outputArtifactId ?? tc.id,
      fullOutput?.nextOffset ?? 0
    );
    setFullOutput(next);
  };
  return (
    <details className="tool-call-item" onToggle={(e) => setExpanded(e.currentTarget.open)}>
      <summary className="tool-call-summary">
        <span className="tool-call-name">
          <IconTerminal size={14} />
          <strong title={tc.name}>{presentation.label}</strong>
          {presentation.target && (
            <span className="tool-call-target" title={presentation.target}>
              {presentation.target}
            </span>
          )}
        </span>
        <span className={`tool-call-status ${presentation.status}`}>
          {presentation.status === 'failed'
            ? 'Failed'
            : presentation.status === 'completed'
              ? 'Completed'
              : 'Running…'}
        </span>
      </summary>
      {expanded && (
        <div className="tool-call-body">
          <div className="tool-call-label">Arguments</div>
          <pre className="tool-call-pre">{tc.arguments}</pre>
          {tc.result !== undefined && (
            <>
              <div className="tool-call-label">Result</div>
              <pre className="tool-call-pre scrollable">{tc.result}</pre>
            </>
          )}
          {tc.outputArtifactId && (
            <>
              <button onClick={() => void perform(loadOutput)}>
                {fullOutput
                  ? fullOutput.nextOffset === undefined
                    ? 'Read from start'
                    : 'Next output page'
                  : 'View full saved output'}
              </button>
              {fullOutput && <pre className="tool-call-pre scrollable">{fullOutput.content}</pre>}
              {fullOutput && (
                <small>
                  {fullOutput.nextOffset ?? fullOutput.total} / {fullOutput.total} characters
                </small>
              )}
            </>
          )}
          {tc.error && <div className="tool-call-error">{tc.error}</div>}
        </div>
      )}
    </details>
  );
}

/** A skill looked up or read: a quiet chip, since there is nothing in it to open. */
function SkillChip({ call }: { call: ToolCall }) {
  const chip = skillChip(call);
  if (!chip) return null;
  return (
    <span className={`skill-chip ${chip.status}`} title={chip.text}>
      <IconBook size={12} />
      <span>{chip.text}</span>
    </span>
  );
}

/** The tallest the edit box grows before it scrolls. */
const MAX_EDIT_BOX = 280;
/** The narrowest an open edit box is, even for a one-word message. */
const MIN_EDIT_WIDTH = 260;

/** One message in a thread: meta line, thought, tool calls, markdown body and actions. */
export function MessageView({
  message: m,
  authorName = 'Axon',
  actions,
  renderToolCall,
  onContinue,
  onEdit,
  editNote,
  folder
}: {
  message: Message;
  authorName?: string;
  actions?: ReactNode;
  /** For a reply that stopped early: asks them to carry on. */
  onContinue?: () => void;
  /**
   * For a message of yours that can be edited: gives it an Edit button that opens the message as a
   * box to rewrite. Called with the new words; true when they were accepted, false when not (the
   * box stays open, with what you wrote).
   */
  onEdit?: (words: string) => Promise<boolean>;
  /** Under the open edit box: what saving replaces. */
  editNote?: string;
  /** The conversation's project folder: where saving a reply starts. */
  folder?: string | null;
  /**
   * A card of its own for some tool calls; return nothing to use the standard one, or false to
   * leave the call out (it is shown somewhere else).
   */
  renderToolCall?: (call: ToolCall) => ReactNode;
}) {
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const waiting = useApp((s) => Object.values(s.pendingApprovals).find((r) => r.messageId === m.id));
  const [copied, setCopied] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const copyable = m.role === 'assistant' && Boolean(m.content) && !m.streaming;
  const pictures = (m.attachments ?? []).filter((a) => a.kind === 'image');
  const readable = copyable && worthReading(m.content);
  const shownText = m.role === 'user' ? visibleUserText(m.content) : m.content;
  const foldable =
    m.role === 'user' && (shownText.length > FOLD_AT.chars || shownText.split('\n').length > FOLD_AT.lines);
  const folded = foldable && !unfolded;
  const calls = (m.toolCalls ?? [])
    .map((call) => ({ call, custom: renderToolCall?.(call) }))
    .filter(({ custom }) => custom !== false);

  // Editing a message of yours: the words become a box of the same width, to rewrite and send again.
  const editable = m.role === 'user' && !m.streaming && Boolean(onEdit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editWidth, setEditWidth] = useState(MIN_EDIT_WIDTH);
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const wasEditing = useRef(false);
  const noteId = useId();
  const open = editing && editable;
  // They went back to work (or the message stopped being editable): the box closes, as it can't send.
  useEffect(() => {
    if (!editable) setEditing(false);
  }, [editable]);
  // Opening puts the cursor at the end of the words; closing puts you back on Edit.
  useEffect(() => {
    if (open) {
      const box = field.current;
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
    } else if (wasEditing.current) body.current?.querySelector<HTMLElement>('[data-action="edit"]')?.focus();
    wasEditing.current = open;
  }, [open]);
  // The box grows with the words, up to a height, then scrolls.
  useLayoutEffect(() => {
    const box = field.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_EDIT_BOX)}px`;
  }, [draft, open]);
  const startEdit = () => {
    setEditWidth(Math.max(MIN_EDIT_WIDTH, body.current?.offsetWidth ?? 0));
    setDraft(shownText);
    setEditing(true);
  };
  const cancelEdit = () => {
    if (!saving) setEditing(false);
  };
  const saveEdit = async () => {
    const words = draft.trim();
    if (!words || saving || !onEdit) return;
    setSaving(true);
    try {
      if (await onEdit(words)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void saveEdit();
    }
  };
  return (
    <article data-message-id={m.id} className={`message ${m.role}${m.streaming ? ' streaming' : ''}`}>
      <div className="message-avatar">
        {m.role === 'user' ? <IconUser size={15} /> : <IconSparkle size={14} />}
      </div>
      <div
        ref={body}
        className={`message-body${open ? ' editing' : ''}`}
        style={open ? { width: editWidth } : undefined}
      >
        <div className="message-meta">
          <strong>{m.role === 'user' ? (m.from ?? 'You') : authorName}</strong>
          <span className="text-caption" title={new Date(m.createdAt).toLocaleString()}>
            {timeAgo(m.createdAt)}
          </span>
          {m.streaming && (
            <span className="message-status">
              {!waiting && (
                <span className="thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              )}
              {waiting
                ? waiting.question
                  ? 'Waiting for your answer'
                  : 'Waiting for your OK'
                : m.toolCalls?.some((call) => toolPresentation(call).status === 'running')
                  ? 'Working'
                  : m.thought && !m.content
                    ? 'Thinking'
                    : 'Writing'}
            </span>
          )}
        </div>
        {m.thought && (
          <details className="thought-block" onToggle={(e) => setThoughtOpen(e.currentTarget.open)}>
            <summary>Reasoning summary</summary>
            {thoughtOpen && <div className="thought-content">{m.thought}</div>}
          </details>
        )}
        {calls.length > 0 && (
          <div className="tool-calls">
            {calls.map(({ call, custom }) =>
              custom ? (
                <Fragment key={call.id}>{custom}</Fragment>
              ) : skillChip(call) ? (
                <SkillChip key={call.id} call={call} />
              ) : (
                <ToolCallDetails key={call.id} call={call} conversationId={m.conversationId} />
              )
            )}
          </div>
        )}
        {pictures.length > 0 && (
          <div className="message-pictures">
            {pictures.map((a) =>
              a.thumbnail ? (
                <img key={a.id} src={a.thumbnail} alt={a.name} title={a.name} />
              ) : (
                <span key={a.id} className="message-picture-name" title={a.name}>
                  <IconPaperclip size={12} />
                  {a.name}
                </span>
              )
            )}
          </div>
        )}
        {open ? (
          <div className="message-edit" role="group" aria-label="Edit your message" aria-busy={saving}>
            <textarea
              ref={field}
              className="textarea message-edit-field"
              aria-label="Your message"
              aria-describedby={editNote ? noteId : undefined}
              value={draft}
              disabled={saving}
              rows={2}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={editKeys}
            />
            {editNote && (
              <p className="message-edit-note" id={noteId}>
                {editNote}
              </p>
            )}
            <div className="message-edit-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={saving || !draft.trim()}
                onClick={() => void saveEdit()}
              >
                {saving ? 'Sending…' : 'Save and send'}
              </Button>
              <Button variant="ghost" size="sm" disabled={saving} onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={`message-content${folded ? ' folded' : ''}`}>
            <MessageMarkdown headingIds>
              {m.role === 'user'
                ? shownText
                : m.content ||
                  (m.streaming && !waiting ? (m.thought ? 'Generating response…' : 'Thinking…') : '')}
            </MessageMarkdown>
          </div>
        )}
        {foldable && !open && (
          <button
            type="button"
            className="message-fold"
            aria-expanded={unfolded}
            onClick={() => setUnfolded(!unfolded)}
          >
            {unfolded ? 'Show less' : 'Show more'}
          </button>
        )}
        {m.notice && (
          <p className={`message-notice${m.incomplete ? ' stopped-early' : ''}`}>
            <span>
              {m.incomplete && <strong>Stopped early · </strong>}
              {m.notice}
            </span>
            {m.incomplete && onContinue && (
              <Button variant="secondary" size="sm" onClick={onContinue}>
                Continue
              </Button>
            )}
          </p>
        )}
        {m.error && <p className="message-error">{m.error}</p>}
        {(actions || copyable || (editable && !open)) && (
          <div className="message-actions">
            {editable && !open && (
              <Button
                variant="ghost"
                size="sm"
                icon={IconCompose}
                data-action="edit"
                title="Change this message and send it again"
                aria-label="Edit your message"
                onClick={startEdit}
              >
                Edit
              </Button>
            )}
            {readable && (
              <Button
                variant="ghost"
                size="sm"
                icon={IconBook}
                data-action="read"
                title="Read in a wide view, with contents"
                onClick={() => useReading.getState().read({ message: m, authorName, folder })}
              >
                Read
              </Button>
            )}
            {copyable && (
              <Button
                variant="ghost"
                size="sm"
                icon={copied ? IconCheck : IconCopy}
                onClick={() =>
                  void perform(async () => {
                    await navigator.clipboard.writeText(m.content);
                    setCopied(true);
                  })
                }
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
            {actions}
          </div>
        )}
      </div>
    </article>
  );
}
