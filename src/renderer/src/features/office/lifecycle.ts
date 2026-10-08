import type { AgentRun, RunStatus } from '../../../../shared/runtime';

export type LifecycleTone = 'queued' | 'working' | 'attention' | 'completed' | 'failed' | 'stopped';
export interface Lifecycle {
  label: string;
  tone: LifecycleTone;
  action: string;
}

/** Keep the meaning of a run consistent wherever work is shown. */
export function runLifecycle(status: RunStatus): Lifecycle {
  switch (status) {
    case 'planned':
    case 'queued':
      return { label: 'Queued', tone: 'queued', action: 'View task' };
    case 'starting':
    case 'working':
      return { label: 'Working', tone: 'working', action: 'Follow work' };
    case 'waiting_for_agent':
      return { label: 'Waiting for colleague', tone: 'working', action: 'Follow work' };
    case 'waiting_for_approval':
      return { label: 'Needs you', tone: 'attention', action: 'Review request' };
    case 'waiting_for_user':
      return { label: 'Needs you', tone: 'attention', action: 'Reply to coworker' };
    case 'blocked':
      return { label: 'Blocked', tone: 'attention', action: 'Review blocker' };
    case 'completed':
      return { label: 'Completed', tone: 'completed', action: 'Open result' };
    case 'failed':
      return { label: 'Failed', tone: 'failed', action: 'Review error' };
    case 'canceling':
      return { label: 'Stopping', tone: 'stopped', action: 'View task' };
    case 'canceled':
      return { label: 'Canceled', tone: 'stopped', action: 'Open conversation' };
    case 'interrupted':
      return { label: 'Interrupted', tone: 'attention', action: 'Resume conversation' };
  }
}

export function latestRun(
  runs: readonly AgentRun[],
  agentId: string,
  conversationId?: string
): AgentRun | undefined {
  return runs
    .filter((r) => r.agentId === agentId && (!conversationId || r.conversationId === conversationId))
    .reduce<AgentRun | undefined>(
      (latest, run) => (!latest || run.updatedAt > latest.updatedAt ? run : latest),
      undefined
    );
}

export type HistoryFilter = 'all' | 'active' | 'attention' | 'completed';
export function historyRuns(
  runs: readonly AgentRun[],
  filter: HistoryFilter,
  query: string,
  name: (id: string) => string
): AgentRun[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return runs
    .filter((run) => {
      const state = runLifecycle(run.status);
      const match =
        filter === 'all' ||
        (filter === 'active' && ['queued', 'working'].includes(state.tone)) ||
        (filter === 'attention' && ['attention', 'failed'].includes(state.tone)) ||
        (filter === 'completed' && state.tone === 'completed');
      const text =
        `${name(run.agentId)} ${run.summary ?? ''} ${run.error ?? ''} ${state.label}`.toLowerCase();
      return match && words.every((word) => text.includes(word));
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
