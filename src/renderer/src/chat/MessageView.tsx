import { Fragment, useState, type ReactNode } from 'react';
import type { Message, ToolCall } from '../../../shared/types';
import { perform, useApp } from '../state';
import { timeAgo } from '../format';
import { Button, IconBook, IconCheck, IconCopy, IconSparkle, IconTerminal, IconUser } from '../ui';
import { toolPresentation } from './workPresentation';
import { MessageMarkdown } from './MessageMarkdown';
import { useReading, worthReading } from './reading';

/** Messages of yours longer than this start folded, with Show more. */
const FOLD_AT = { chars: 600, lines: 8 };

/** What the user typed, without the attachment and file-context blocks appended for the model. */
export function visibleUserText(content: string): string {
  return content.split('\n\n<attachment')[0].split('\n\nFile context: ')[0].split('\n\n<file path=')[0];
}

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

/** One message in a thread: meta line, thought, tool calls, markdown body and actions. */
export function MessageView({
  message: m,
  authorName = 'Axon',
  actions,
  renderToolCall,
  onContinue,
  folder
}: {
  message: Message;
  authorName?: string;
  actions?: ReactNode;
  /** For a reply that stopped early: asks them to carry on. */
  onContinue?: () => void;
  /** The conversation's project folder: where saving a reply starts. */
  folder?: string | null;
  /**
   * A card of its own for some tool calls; return nothing to use the standard one, or false to
   * leave the call out (it is shown somewhere else).
   */
  renderToolCall?: (call: ToolCall) => ReactNode;
}) {
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const copyable = m.role === 'assistant' && Boolean(m.content) && !m.streaming;
  const readable = copyable && worthReading(m.content);
  const shownText = m.role === 'user' ? visibleUserText(m.content) : m.content;
  const foldable =
    m.role === 'user' && (shownText.length > FOLD_AT.chars || shownText.split('\n').length > FOLD_AT.lines);
  const folded = foldable && !unfolded;
  const calls = (m.toolCalls ?? [])
    .map((call) => ({ call, custom: renderToolCall?.(call) }))
    .filter(({ custom }) => custom !== false);
  return (
    <article data-message-id={m.id} className={`message ${m.role}${m.streaming ? ' streaming' : ''}`}>
      <div className="message-avatar">
        {m.role === 'user' ? <IconUser size={15} /> : <IconSparkle size={14} />}
      </div>
      <div className="message-body">
        <div className="message-meta">
          <strong>{m.role === 'user' ? (m.from ?? 'You') : authorName}</strong>
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
              {m.toolCalls?.some((call) => toolPresentation(call).status === 'running')
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
              ) : (
                <ToolCallDetails key={call.id} call={call} conversationId={m.conversationId} />
              )
            )}
          </div>
        )}
        <div className={`message-content${folded ? ' folded' : ''}`}>
          <MessageMarkdown headingIds>
            {m.role === 'user'
              ? shownText
              : m.content || (m.streaming ? (m.thought ? 'Generating response…' : 'Thinking…') : '')}
          </MessageMarkdown>
        </div>
        {foldable && (
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
        {(actions || copyable) && (
          <div className="message-actions">
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
