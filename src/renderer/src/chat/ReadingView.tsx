import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { perform, useApp } from '../state';
import { Button, IconCheck, IconClose, IconCopy, IconDownload } from '../ui';
import { useEscape } from '../ui/escape';
import { MessageMarkdown } from './MessageMarkdown';
import { sections, useReading, type Reading } from './reading';
import { replyFileName } from './transcript';
import './reading.css';

/** The reading view, over everything, for whichever reply is open in it. Mounted once, at the root. */
export function ReadingHost() {
  const open = useReading((s) => s.open);
  if (!open) return null;
  return createPortal(
    <ReadingView key={open.message.id} reading={open} onClose={() => useReading.getState().read(null)} />,
    document.body
  );
}

/**
 * A long reply, read properly: a wide column in larger type, its headings as contents to jump to
 * (each section can be copied on its own), and Copy and Save as file at hand. The page keys work:
 * Page Up and Down, Home and End, Space.
 */
function ReadingView({ reading, onClose }: { reading: Reading; onClose: () => void }) {
  const { message, authorName, folder } = reading;
  const parts = useMemo(() => sections(message.content), [message.content]);
  const scroller = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [active, setActive] = useState(parts[0]?.id);
  useEscape(onClose);
  useEffect(() => scroller.current?.focus(), []);

  const copy = (key: string, text: string) =>
    void perform(async () => {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    });
  const save = () =>
    void perform(async () => {
      const path = await window.axon.documentSave(
        replyFileName(message.content, `${authorName} reply`),
        message.content,
        folder
      );
      if (path) useApp.getState().pushToast(`Saved to ${path}`);
    });
  const jump = (id: string) => {
    const target = scroller.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target || !scroller.current) return;
    scroller.current.scrollTo({ top: target.offsetTop - 16, behavior: 'smooth' });
    setActive(id);
  };
  // The contents follow the page: the last heading scrolled past is the current one.
  const follow = () => {
    const box = scroller.current;
    if (!box) return;
    let current = parts[0]?.id;
    for (const part of parts) {
      const heading = box.querySelector<HTMLElement>(`#${CSS.escape(part.id)}`);
      if (heading && heading.offsetTop - box.scrollTop <= 80) current = part.id;
    }
    setActive(current);
  };
  const contents = parts.length >= 2 ? parts : [];
  const when = new Date(message.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="reading-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="reading-view" role="dialog" aria-modal="true" aria-label={`${authorName}’s reply`}>
        <header className="reading-head">
          <div className="reading-byline">
            <strong>{authorName}</strong>
            <small>{when}</small>
          </div>
          <div className="reading-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={copied === 'all' ? IconCheck : IconCopy}
              onClick={() => copy('all', message.content)}
            >
              {copied === 'all' ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="ghost" size="sm" icon={IconDownload} onClick={save}>
              Save as file…
            </Button>
            <Button variant="ghost" size="sm" icon={IconClose} iconOnly aria-label="Close (Esc)" onClick={onClose} />
          </div>
        </header>
        <div className={`reading-columns${contents.length ? ' with-contents' : ''}`}>
          {contents.length > 0 && (
            <nav className="reading-contents" aria-label="Contents">
              <small>Contents</small>
              <ol>
                {contents.map((part) => (
                  <li key={part.id} className={`level-${part.level}${active === part.id ? ' active' : ''}`}>
                    <button type="button" className="reading-toc-link" onClick={() => jump(part.id)}>
                      {part.title}
                    </button>
                    <button
                      type="button"
                      className="reading-toc-copy"
                      title="Copy this section"
                      aria-label={`Copy the section “${part.title}”`}
                      onClick={() => copy(part.id, part.markdown)}
                    >
                      {copied === part.id ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="reading-scroll" ref={scroller} tabIndex={0} onScroll={follow}>
            <article className="reading-article message-content">
              <MessageMarkdown headingIds>{message.content}</MessageMarkdown>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
