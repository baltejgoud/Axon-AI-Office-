import { useEffect, useState } from 'react';
import { useOfficeStore, type AgentActivity } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';

type Notice = AgentActivity & { conversationId?: string };
/** Only new completion/error events become cards; opening the app does not replay history. */
export function OfficeNotifications() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [expanded, setExpanded] = useState(false);
  const hidden = useOfficeStore(
    (s) => s.focusMode || s.workFullscreen || s.coworkerCard || s.conversationOpen || s.activityHistoryOpen
  );
  useEffect(() => {
    let seen = new Set(
      Object.values(useOfficeStore.getState().agentRuntime).flatMap((r) => r.activities.map((a) => a.id))
    );
    return useOfficeStore.subscribe((state, previous) => {
      if (state.agentRuntime === previous.agentRuntime) return;
      const next = new Set<string>();
      const fresh: Notice[] = [];
      for (const runtime of Object.values(state.agentRuntime))
        for (const activity of runtime.activities) {
          next.add(activity.id);
          if (!seen.has(activity.id) && (activity.type === 'completed' || activity.type === 'error'))
            fresh.push({ ...activity, conversationId: runtime.conversationId });
        }
      seen = next;
      if (fresh.length)
        setNotices((current) =>
          [...fresh.sort((a, b) => b.timestamp - a.timestamp), ...current].slice(0, 20)
        );
    });
  }, []);
  if (hidden || !notices.length) return null;
  return (
    <section
      className="office-notifications"
      data-office-obstacle
      aria-label="Office notifications"
      aria-live="polite"
    >
      {notices.length > 1 && (
        <button className="notice-group" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {notices.length} new updates · {expanded ? 'Collapse' : 'Show all'}
        </button>
      )}
      {(expanded ? notices : notices.slice(0, 1)).map((notice) => (
        <article key={notice.id} className={`office-notice ${notice.type}`}>
          <button
            aria-label={`Dismiss ${notice.title}`}
            className="notice-dismiss"
            onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
          >
            ×
          </button>
          <strong>{OFFICE_AGENTS.find((a) => a.id === notice.agentId)?.name}</strong>
          <p>{notice.title}</p>
          {notice.detail && <small>{notice.detail}</small>}
          <button
            onClick={() => {
              useOfficeStore
                .getState()
                .focusOn({ agentId: notice.agentId, conversationId: notice.conversationId });
              setNotices((current) => current.filter((n) => n.id !== notice.id));
            }}
          >
            {notice.type === 'error' ? 'Review error' : 'Open result'}
          </button>
        </article>
      ))}
      <button
        className="notice-history"
        onClick={() => useOfficeStore.getState().setActivityHistoryOpen(true)}
      >
        View activity history
      </button>
    </section>
  );
}
