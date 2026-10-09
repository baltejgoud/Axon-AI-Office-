import { useEffect, useRef, useState } from 'react';
import { perform, useApp } from '../../../state';
import { wholeConversation, replyFileName } from '../../../chat/transcript';
import type { Message } from '../../../../../shared/types';
import type { AgentRun } from '../../../../../shared/runtime';
import { useReading } from '../../../chat/reading';
import { useOfficeStore } from '../store/officeStore';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import { coworkerById } from '../../../../../shared/coworkers';
import { historyRuns, runLifecycle, type HistoryFilter } from '../lifecycle';
import { LifecycleBadge } from './LifecycleBadge';
import { useEscape } from '../../../ui/escape';
import { plural } from '../../../format';
import { IconChevronLeft } from '../../../ui';

/** The left chevron, turned: "show more" on a folded rail. */
const IconChevronRight = ({ size }: { size: number }) => (
  <IconChevronLeft size={size} style={{ transform: 'rotate(180deg)' }} />
);

const name = (id: string) => coworkerById(id)?.name ?? id;
/** Whether the rail shows only the team's status, kept on this computer. */
const RAIL_KEY = 'axon.railCollapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * One slim rail over the office: how the team is doing, with Activity & results and Company
 * operations beside it. It folds down to the status alone.
 */
export function GlobalWork() {
  const runs = useApp((s) => s.data?.runs);
  const teams = useApp((s) => s.data?.teams);
  const open = useOfficeStore((s) => s.activityHistoryOpen);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const active = (runs ?? []).filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  const team = teams?.findLast((t) => ['meeting', 'planned', 'working', 'reporting'].includes(t.status));
  const multiTarget =
    active.at(-1) ?? (team ? { agentId: team.leadId, conversationId: team.conversationId } : undefined);
  const fold = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? '0' : '1');
    } catch {
      // Folded for this session only.
    }
  };
  return (
    <div className={`global-work${collapsed ? ' collapsed' : ''}`}>
      <button
        className="office-presence-main"
        aria-expanded={open}
        aria-controls="office-activity-history"
        title="Open activity and saved results"
        onClick={() => useOfficeStore.getState().setActivityHistoryOpen(!open)}
      >
        {active.length
          ? `${plural(new Set(active.map((r) => r.agentId)).size, 'coworker')} active`
          : 'Your team is ready'}
      </button>
      {!collapsed && (
        <>
          <button
            className="office-history-link"
            onClick={() => useOfficeStore.getState().setActivityHistoryOpen(!open)}
          >
            Activity & results
          </button>
          <button
            className="office-history-link office-company-link"
            onClick={() => useOfficeStore.getState().openOverlay('company')}
          >
            Company operations
          </button>
        </>
      )}
      {multiTarget && (
        <button
          className="office-history-link"
          onClick={() => {
            const office = useOfficeStore.getState();
            office.focusOn(multiTarget, { fly: false });
            office.openConversation('updates');
          }}
        >
          Multi Agents
        </button>
      )}
      <button
        className="global-work-fold"
        aria-label={
          collapsed ? 'Show Activity & results and Company operations' : 'Fold the rail to the team status'
        }
        title={collapsed ? 'Show more' : 'Fold'}
        aria-expanded={!collapsed}
        onClick={fold}
      >
        {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
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
          <article
            className="history-run"
            key={run.runId}
            title={
              !conversations?.some((c) => c.id === run.conversationId)
                ? 'This conversation is no longer available'
                : undefined
            }
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
            <div className="result-actions">
              <button
                disabled={
                  !conversations?.some((c) => c.id === run.conversationId) || !coworkerById(run.agentId)
                }
                onClick={() => {
                  useOfficeStore
                    .getState()
                    .focusOn({ agentId: run.agentId, conversationId: run.conversationId });
                  close();
                }}
              >
                Open
              </button>
              {run.completedAt && conversations?.some((c) => c.id === run.conversationId) && (
                <SavedResult run={run} />
              )}
            </div>
          </article>
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

function SavedResult({ run }: { run: AgentRun }) {
  const [reply, setReply] = useState<Message>();
  const folder = useApp((s) => s.data?.conversations.find((c) => c.id === run.conversationId)?.projectRoot);
  useEffect(() => {
    let disposed = false;
    void wholeConversation(run.conversationId)
      .then((messages) => {
        if (!disposed)
          setReply(
            messages.findLast(
              (m) =>
                m.role === 'assistant' &&
                !m.streaming &&
                m.content &&
                m.createdAt >= run.startedAt &&
                m.createdAt <= run.completedAt!
            )
          );
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [run.runId, run.completedAt]);
  return (
    <>
      {reply && <p className="result-shelf-preview">{reply.content}</p>}
      {reply && (
        <button
          onClick={() => {
            useReading.getState().read({ message: reply, authorName: name(run.agentId), folder });
          }}
        >
          Read result
        </button>
      )}
      <button
        disabled={!reply}
        onClick={() =>
          void perform(async () => {
            await navigator.clipboard.writeText(reply!.content);
            useApp.getState().pushToast('Result copied');
          })
        }
      >
        Copy
      </button>
      <button
        disabled={!reply}
        onClick={() =>
          void perform(async () => {
            const saved = await window.axon.documentSave(
              replyFileName(reply!.content, `${name(run.agentId)} result`),
              reply!.content,
              folder
            );
            if (saved) useApp.getState().pushToast(`Saved to ${saved}`);
          })
        }
      >
        Save as file
      </button>
    </>
  );
}
