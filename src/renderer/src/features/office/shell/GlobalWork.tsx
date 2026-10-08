import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import { coworkerById } from '../../../../../shared/coworkers';
import { historyRuns, runLifecycle, type HistoryFilter } from '../lifecycle';
import { LifecycleBadge } from './LifecycleBadge';
import { useEscape } from '../../../ui/escape';

const name = (id: string) => coworkerById(id)?.name ?? id;
export function GlobalWork() {
  const runs = useApp((s) => s.data?.runs);
  const open = useOfficeStore((s) => s.activityHistoryOpen);
  const active = (runs ?? []).filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  return (
    <div className="global-work">
      <button
        className="office-presence-main"
        aria-expanded={open}
        aria-controls="office-activity-history"
        title="Open activity and saved results"
        onClick={() => useOfficeStore.getState().setActivityHistoryOpen(!open)}
      >
        {active.length
          ? `${new Set(active.map((r) => r.agentId)).size} coworkers active`
          : 'Your team is ready'}
      </button>
      <button
        className="office-history-link"
        onClick={() => useOfficeStore.getState().setActivityHistoryOpen(!open)}
      >
        Activity & results
      </button>
      <button className="office-history-link office-company-link" onClick={() => useOfficeStore.getState().openOverlay('company')}>
        Company operations
      </button>
      {open && <ActivityHistory />}
    </div>
  );
}

function ActivityHistory() {
  const runs = useApp((s) => s.data?.runs);
  const conversations = useApp((s) => s.data?.conversations);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => useOfficeStore.getState().setActivityHistoryOpen(false);
  useEscape(close);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        root.current?.contains(event.target) ||
        (event.target instanceof Element && event.target.closest('.global-work'))
      )
        return;
      close();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (
        previous?.isConnected &&
        (!document.activeElement ||
          document.activeElement === document.body ||
          root.current?.contains(document.activeElement))
      )
        previous.focus();
    };
  }, []);
  const results = historyRuns(runs ?? [], filter, query, name);
  return (
    <section
      ref={root}
      id="office-activity-history"
      className="global-work-panel"
      role="dialog"
      aria-label="Activity and results"
      data-office-obstacle
    >
      <header>
        <strong>Activity & results</strong>
        <button aria-label="Close activity history" onClick={close}>
          ×
        </button>
      </header>
      <input
        ref={input}
        aria-label="Search activity"
        placeholder="Find a coworker, task or result…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(30);
        }}
      />
      <div className="history-filters" role="group" aria-label="Filter activity">
        {(['all', 'active', 'attention', 'completed'] as const).map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setLimit(30);
            }}
          >
            {value === 'attention' ? 'Needs you' : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="history-results">
        {results.slice(0, limit).map((run) => (
          <button
            className="history-run"
            key={run.runId}
            disabled={!conversations?.some((c) => c.id === run.conversationId) || !coworkerById(run.agentId)}
            title={
              !conversations?.some((c) => c.id === run.conversationId)
                ? 'This conversation is no longer available'
                : undefined
            }
            onClick={() => {
              const office = useOfficeStore.getState();
              office.focusOn({ agentId: run.agentId, conversationId: run.conversationId });
              close();
            }}
          >
            <span className="history-run-heading">
              <strong>{name(run.agentId)}</strong>
              <LifecycleBadge status={run.status} />
            </span>
            <span className="history-run-summary">{run.summary || run.error || 'Conversation task'}</span>
            <span className="history-run-footer">
              <time dateTime={new Date(run.updatedAt).toISOString()}>
                {new Date(run.updatedAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </time>
              <span>
                {conversations?.some((c) => c.id === run.conversationId) && coworkerById(run.agentId)
                  ? `${runLifecycle(run.status).action} →`
                  : 'Conversation unavailable'}
              </span>
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="history-empty">
            {query || filter !== 'all'
              ? 'No matching tasks. Try another search or filter.'
              : 'Your work will appear here. Completed results stay available after notifications are dismissed.'}
          </p>
        )}
        {results.length > limit && (
          <button className="history-more" onClick={() => setLimit((n) => n + 30)}>
            Show more ({results.length - limit})
          </button>
        )}
      </div>
    </section>
  );
}
