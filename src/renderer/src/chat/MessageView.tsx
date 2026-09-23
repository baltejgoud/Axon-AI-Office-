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

/** What the user typed, without the attachment and file-context blocks appended for the model. */
export function visibleUserText(content: string): string {
  return content.split('\n\n<attachment')[0].split('\n\nFile context: ')[0];
}

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
  const copyable = m.role === 'assistant' && Boolean(m.content) && !m.streaming;
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
                  <span
                    className={`tool-call-status ${tc.error ? 'failed' : tc.result ? 'completed' : 'running'}`}
                  >
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
              ? visibleUserText(m.content)
              : m.content || (m.streaming ? (m.thought ? 'Generating response…' : 'Thinking…') : '')}
          </Markdown>
        </div>
        {m.error && <p className="message-error">{m.error}</p>}
        {(actions || copyable) && (
          <div className="message-actions">
            {copyable && (
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
            )}
            {actions}
          </div>
        )}
      </div>
    </article>
  );
}
