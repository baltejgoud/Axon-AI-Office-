import './bell.css';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useApp } from '../../../state';
import { IconBell } from '../../../ui';
import { useEscape } from '../../../ui/escape';
import { useOfficeStore } from '../store/officeStore';
import { deriveNotices, isRead, timeAgo, unreadCount, type Notice } from '../notices';
import { useNoticeMemory } from './noticeMemory';

/** How often "2 min ago" is looked at again. */
const REFRESH_MS = 30_000;

/**
 * The bell in the office's top bar: how many things want you or are worth a look (steps and questions
 * waiting, tasks that finished or stopped, a team's plan or report), and a short list to open them
 * from. Clicking one goes to its conversation and marks it read.
 */
export function NotificationBell() {
  const approvals = useApp((s) => s.pendingApprovals);
  const tasks = useApp((s) => s.data?.tasks);
  const teams = useApp((s) => s.data?.teams);
  const runs = useApp((s) => s.data?.runs);
  const conversations = useApp((s) => s.data?.conversations);
  const servers = useApp((s) => s.data?.mcpServers);
  const memory = useNoticeMemory((s) => s.memory);
  const markRead = useNoticeMemory((s) => s.read);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const notices = useMemo(
    () =>
      deriveNotices({
        approvals: Object.values(approvals),
        tasks: tasks ?? [],
        teams: teams ?? [],
        runs: runs ?? [],
        conversations: conversations ?? [],
        servers,
        now
      }),
    [approvals, tasks, teams, runs, conversations, servers, now]
  );
  const unread = unreadCount(notices, memory);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  useEscape(() => close(), open);

  // Opening moves focus into the list (its first row, or the panel when it is empty); a click
  // anywhere else closes it without taking focus back from where you clicked.
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const first = panel.current?.querySelector<HTMLElement>('.office-bell-row');
    (first ?? panel.current)?.focus();
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const go = (notice: Notice) => {
    markRead([notice.id]);
    setOpen(false);
    if (!notice.agentId) return;
    useOfficeStore.getState().focusOn({ agentId: notice.agentId, conversationId: notice.conversationId });
  };
  const rowKeys = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.office-bell-row')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div className="office-bell" ref={root}>
      <button
        ref={button}
        className={open ? 'active' : ''}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
      >
        <IconBell size={16} />
        {unread > 0 && (
          <span className="office-bell-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div ref={panel} className="office-bell-panel" role="dialog" aria-label="Notifications" tabIndex={-1}>
          <header className="office-bell-head">
            <strong>Notifications</strong>
            <button type="button" className="office-bell-all" disabled={!unread} onClick={() => markRead(notices.map((n) => n.id))}>
              Mark all read
            </button>
          </header>
          {notices.length ? (
            <ul className="office-bell-list" onKeyDown={rowKeys}>
              {notices.map((notice) => {
                const fresh = !isRead(notice, memory);
                return (
                  <li key={notice.id}>
                    <button
                      type="button"
                      className={`office-bell-row is-${notice.kind}${fresh ? ' is-unread' : ''}`}
                      onClick={() => go(notice)}
                    >
                      <span className="office-bell-dot" aria-hidden="true" />
                      <span className="office-bell-text">
                        <span className="office-bell-line">
                          <strong>{notice.who}</strong>
                          <span className="office-bell-title">{notice.title}</span>
                        </span>
                        <span className="office-bell-what">{notice.what}</span>
                        <span className="office-bell-when">
                          {fresh && <span className="office-sr-only">Unread. </span>}
                          {timeAgo(notice.at, now)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="office-bell-empty">
              Nothing new. You’ll see it here when a coworker needs you, or finishes something.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
