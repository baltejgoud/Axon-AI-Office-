import type { AgentRun } from '../../../../shared/runtime';
import { useApp } from '../../state';
import { AgentPortrait } from './AgentPortrait';
import type { OfficeAgent } from './data/officeAgents';
import { latestRun } from './lifecycle';
import { LifecycleBadge } from './shell/LifecycleBadge';
import { useOfficeStore } from './store/officeStore';

/** The same coworker identity and result wherever someone is choosing who to work with. */
export function ColleagueSummary({ agent, run: supplied }: { agent: OfficeAgent; run?: AgentRun }) {
  const data = useApp((s) => s.data);
  const remembered = useOfficeStore((s) => s.agentModels[agent.id]);
  const run = supplied ?? latestRun(data?.runs ?? [], agent.id);
  const conversation = run
    ? data?.conversations.find((c) => c.id === run.conversationId)
    : data?.conversations.filter((c) => c.agentId === agent.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const reply = data?.messages
    .filter(
      (m) =>
        m.conversationId === conversation?.id &&
        m.role === 'assistant' &&
        !m.streaming &&
        m.content &&
        (!run || (m.createdAt >= run.startedAt && m.createdAt <= (run.completedAt ?? Infinity)))
    )
    .at(-1);
  const modelId = conversation?.modelId ?? remembered?.split('::').slice(1).join('::');
  const model = data?.providers.flatMap((p) => p.models).find((m) => m.id === modelId);
  return (
    <span className="colleague-summary">
      <AgentPortrait agent={agent} />
      <span className="colleague-summary-body">
        <strong>{agent.name}</strong>
        <small>
          {agent.role} · {agent.department}
        </small>
        <span className="colleague-summary-chips">
          {run ? (
            <LifecycleBadge status={run.status} stoppedEarly={Boolean(reply?.incomplete)} />
          ) : (
            <span className="status-badge">
              {reply?.incomplete ? 'Stopped early' : reply?.error ? 'Failed' : reply ? 'Completed' : 'Idle'}
            </span>
          )}
          <span className="colleague-model">{model?.displayName ?? modelId ?? 'Default model'}</span>
        </span>
        {reply && <span className="colleague-result-preview">{reply.content}</span>}
      </span>
    </span>
  );
}
