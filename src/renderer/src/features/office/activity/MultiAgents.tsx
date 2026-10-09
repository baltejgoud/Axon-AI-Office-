import { Virtuoso } from 'react-virtuoso';
import { activitySentence, runStage } from '../../../../../shared/runtimePresentation';
import type { AuditEntry } from '../../../../../shared/audit';
import { useState, useEffect } from 'react';
import { useApp, perform } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { coworkerById } from '../../../../../shared/coworkers';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import type { AgentActivity } from '../store/officeStore';
import { runLifecycle } from '../lifecycle';
import { plural } from '../../../format';
import { ColleagueSummary } from '../ColleagueSummary';
import { OFFICE_AGENTS } from '../data/officeAgents';
const name = (id: string) => coworkerById(id)?.name ?? id;
export function MultiAgents({
  conversationId,
  activities
}: {
  conversationId?: string;
  activities: AgentActivity[];
}) {
  const runs = useApp((s) => s.data?.runs);
  const teams = useApp((s) => s.data?.teams);
  const messages = useApp((s) => s.data?.agentMessages);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [view, setView] = useState<'tasks' | 'communication' | 'timeline'>('tasks');
  const related = (teams ?? []).filter(
    (t) =>
      t.conversationId === conversationId ||
      t.plan?.assignments.some((a) => a.conversationId === conversationId)
  );
  const team = related.at(-1);
  const shown = (runs ?? []).filter((r) =>
    team ? r.teamId === team.id : r.conversationId === conversationId
  );
  const auditKey = shown.map((r) => `${r.conversationId}:${r.updatedAt}`).join('|');
  useEffect(() => {
    let disposed = false;
    const ids = [...new Set(shown.map((r) => r.conversationId))];
    void Promise.all(ids.map((id) => window.axon.auditList({ conversationId: id, limit: 100 })))
      .then((results) => {
        if (!disposed)
          setAudit(
            results
              .flat()
              .sort((a, b) => b.at - a.at)
              .slice(0, 300)
          );
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [auditKey]);
  const active = shown.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  const assignmentCount = team?.plan?.assignments.length ?? 0;
  const completed = team?.plan?.assignments.filter((a) => a.status === 'done').length ?? 0;
  const communication = (messages ?? []).filter((m) => shown.some((r) => r.runId === m.runId));
  const openConversation = (agentId: string, id?: string) => {
    useOfficeStore.getState().focusOn({ agentId, conversationId: id });
    useOfficeStore.getState().setPanelTab('chat');
  };
  return (
    <section className="multi-agents" aria-label="Multi Agents">
      <header>
        <h3>{team?.goal ?? 'Coworker work'}</h3>
        <p>{team ? `Lead: ${name(team.leadId)} · ${team.status}` : 'Live execution state'}</p>
        <p className="multi-agents-counts">
          {/* Counted in the badges' own words; states with nobody in them are left out. */}
          {[
            ...shown.reduce((counts, run) => {
              const state = runLifecycle(run.status);
              const entry = counts.get(state.label) ?? { tone: state.tone, n: 0 };
              counts.set(state.label, { ...entry, n: entry.n + 1 });
              return counts;
            }, new Map<string, { tone: string; n: number }>())
          ].map(([label, { tone, n }]) => (
            <span key={label} className={`multi-agents-count is-${tone}`}>
              {n} {label.toLowerCase()}
            </span>
          ))}
          {shown.length === 0 && <span>No runs yet</span>}
        </p>
        {assignmentCount > 0 && (
          <>
            <progress value={completed} max={assignmentCount} />
            <small>
              {completed} of {plural(assignmentCount, 'task')} completed
            </small>
          </>
        )}
        {team && ['meeting', 'planned', 'working', 'reporting'].includes(team.status) && (
          <button onClick={() => void perform(() => window.axon.teamStop(team.id))}>Stop Team</button>
        )}
        {team && ['failed', 'stopped', 'interrupted'].includes(team.status) && (
          <button onClick={() => void perform(() => window.axon.teamRetry(team.id))}>Resume team</button>
        )}
      </header>
      <nav aria-label="Multi Agents view">
        {(['tasks', 'communication', 'timeline'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === 'tasks' ? 'Task graph' : v === 'communication' ? 'Communication' : 'Timeline'}
          </button>
        ))}
      </nav>
      {view === 'tasks' && (
        <div className="multi-task-graph">
          {team?.plan?.assignments.map((a) => {
            const run = shown.filter((r) => r.taskId === a.id).at(-1);
            return (
              <article key={a.id}>
                {OFFICE_AGENTS.find((agent) => agent.id === a.ownerId) ? (
                  <ColleagueSummary
                    agent={OFFICE_AGENTS.find((agent) => agent.id === a.ownerId)!}
                    run={run}
                  />
                ) : (
                  <strong>{name(a.ownerId)}</strong>
                )}
                <p>{a.title}</p>
                {!run && <span>{a.status}</span>}
                {a.dependsOn.length > 0 && (
                  <p>
                    Depends on:{' '}
                    {a.dependsOn
                      .map((id) => team.plan?.assignments.find((t) => t.id === id)?.title ?? id)
                      .join(', ')}
                  </p>
                )}
                {run?.context && (
                  <p>
                    {Math.ceil(run.context.inputTokens / 1000)}K /{' '}
                    {Math.ceil(run.context.contextWindow / 1000)}K context ·{' '}
                    {run.context.compactionPerformed ? 'Optimizing' : 'Healthy'}
                  </p>
                )}
                {run?.activeTool && <p>{run.activeTool.replaceAll('_', ' ')}</p>}
                {a.note && <p>{a.note}</p>}
                {a.conversationId && (
                  <button onClick={() => openConversation(a.ownerId, a.conversationId)}>
                    Conversation & work
                  </button>
                )}
                <details>
                  <summary>Files and result</summary>
                  <p>{a.files?.join(', ') || 'No planned files'}</p>
                  <p>{a.result || 'No result yet'}</p>
                </details>
              </article>
            );
          })}
          {shown
            .filter((r) => !r.taskId || r.taskId === 'team' || !team?.plan)
            .slice(-20)
            .map((r) => (
              <article key={r.runId}>
                {OFFICE_AGENTS.find((agent) => agent.id === r.agentId) ? (
                  <ColleagueSummary agent={OFFICE_AGENTS.find((agent) => agent.id === r.agentId)!} run={r} />
                ) : (
                  <strong>{name(r.agentId)}</strong>
                )}
                <p>{r.summary}</p>
                <span>{runStage(r)}</span>
                {r.context && (
                  <p>
                    {Math.ceil(r.context.inputTokens / 1000)}K / {Math.ceil(r.context.contextWindow / 1000)}K
                    context
                  </p>
                )}
                <p>{r.activeTool?.replaceAll('_', ' ')}</p>
                <small>{Math.round(((r.completedAt ?? Date.now()) - r.startedAt) / 1000)}s</small>
                {r.error && <p>{r.error}</p>}
                <button onClick={() => openConversation(r.agentId, r.conversationId)}>Conversation</button>
              </article>
            ))}
          {!shown.length && !team && <p>No runs yet. Give a coworker a task to see its progress here.</p>}
        </div>
      )}
      {view === 'communication' && (
        <ol>
          {communication.slice(-100).map((m) => (
            <li key={m.messageId}>
              <strong>
                {name(m.fromAgentId)} → {name(m.toAgentId)}
              </strong>
              <p>{m.content}</p>
              <small>
                {m.type.replaceAll('_', ' ')} · {m.status}
              </small>
            </li>
          ))}
          {!communication.length && <p>No colleague messages yet.</p>}
        </ol>
      )}
      {view === 'timeline' && (
        <>
          <Virtuoso
            style={{ height: 420 }}
            data={audit}
            itemContent={(_, entry) => (
              <article>
                <strong>{entry.actor.name}</strong>
                <p>{activitySentence(entry)}</p>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>
                <details>
                  <summary>Technical details</summary>
                  <p>
                    {entry.tool} · {entry.decision} · {entry.result}
                  </p>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{entry.subject}</pre>
                  <p>{entry.detail}</p>
                </details>
              </article>
            )}
          />
          <details>
            <summary>Earlier session updates ({activities.length})</summary>
            <ol>
              {activities.slice(-100).map((a) => (
                <li key={a.id}>
                  <strong>{a.title}</strong>
                  <p>{a.detail}</p>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      {team?.status === 'done' && (
        <article>
          <strong>Team completed</strong>
          <p>
            {plural(new Set(team.plan?.assignments.map((a) => a.ownerId)).size, 'coworker')} took part ·{' '}
            {plural(completed, 'task')} completed
          </p>
          <p>{team.report}</p>
        </article>
      )}
    </section>
  );
}
