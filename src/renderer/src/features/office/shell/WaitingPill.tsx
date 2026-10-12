import { useMemo } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';

interface Waiting {
  agentId: string;
  conversationId: string;
  /** What they wait on is a question for you, not a step to approve. */
  question: boolean;
}

/**
 * Coworkers waiting for your OK or your answer anywhere in the office, not only the one you are
 * looking at. A click takes you to the next of them, to their conversation and the step that is waiting.
 */
export function WaitingPill() {
  const approvals = useApp((s) => s.pendingApprovals);
  const conversations = useApp((s) => s.data?.conversations);
  const selectedId = useOfficeStore((s) => s.selectedAgentId);
  const waiting = useMemo(() => {
    const byAgent = new Map<string, Waiting>();
    for (const request of Object.values(approvals)) {
      const agentId = conversations?.find((c) => c.id === request.conversationId)?.agentId;
      if (agentId && !byAgent.has(agentId) && OFFICE_AGENTS.some((a) => a.id === agentId))
        byAgent.set(agentId, { agentId, conversationId: request.conversationId, question: Boolean(request.question) });
    }
    return [...byAgent.values()];
  }, [approvals, conversations]);
  if (!waiting.length) return null;
  const next = waiting.find((w) => w.agentId !== selectedId) ?? waiting[0];
  const names = waiting.map((w) => OFFICE_AGENTS.find((a) => a.id === w.agentId)?.name ?? w.agentId);
  const nextName = names[waiting.indexOf(next)];
  const questions = waiting.every((w) => w.question);
  const words = questions
    ? waiting.length === 1
      ? '1 has a question'
      : `${waiting.length} have questions`
    : waiting.length === 1
      ? '1 needs your OK'
      : `${waiting.length} need your OK`;
  return (
    <button
      className="office-waiting"
      onClick={() => useOfficeStore.getState().focusOn(next)}
      title={`Waiting for ${questions ? 'your answer' : 'your OK'}: ${names.join(', ')}. Go to ${nextName}.`}
    >
      <span className="office-waiting-dot" />
      {words}
    </button>
  );
}
