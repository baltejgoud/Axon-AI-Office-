import { useEffect, useRef } from 'react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { coworkerById } from '../../../shared/coworkers';
import { riskSummary } from '../../../shared/toolRisk';
import { useApp } from '../state';
import { ApprovalCard } from '../ui/ApprovalCard';
import { QuestionCard } from '../ui/QuestionCard';
import { Button, IconCheck, IconClose } from '../ui';
import { useToolRisks } from './useToolRisk';

/**
 * Answers a tool's request, from its card in the thread or from the office's work surface. `grant`
 * lets the tool run again without asking: for this task (the conversation's current run) or for the
 * session (until Axon restarts). A question is answered with `answerQuestion`, not approved: it is
 * left waiting if asked to approve.
 */
export function decideApproval(request: ToolApprovalRequest, approved: boolean, grant?: 'task' | 'session') {
  if (request.question && approved) return;
  settle(request, {
    approved,
    ...(approved && grant === 'session' ? { alwaysAllowSession: true } : {}),
    ...(approved && grant === 'task' ? { allowForTask: true } : {})
  });
}

/** Answers a coworker's question with a choice or your own words; no words at all skips it. */
export function answerQuestion(request: ToolApprovalRequest, answer: string) {
  const words = answer.trim();
  settle(request, { approved: words !== '', ...(words ? { answer: words } : {}) });
}

function settle(request: ToolApprovalRequest, decision: { approved: boolean; alwaysAllowSession?: boolean; allowForTask?: boolean; answer?: string }) {
  const next = { ...useApp.getState().pendingApprovals };
  delete next[request.id];
  useApp.getState().patch({ pendingApprovals: next });
  void window.axon.toolApprove({ requestId: request.id, ...decision });
}

/** Typing in a field keeps Ctrl+Enter for itself. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Tool calls in this conversation that are waiting for the user's decision, and questions the
 * coworker has put to you. While steps show, Ctrl+Enter approves the first one (unless you are typing
 * somewhere; a question is never approved this way). With two or more steps waiting, Approve all and
 * Reject all decide each one exactly as deciding it on its own card would, with no grants.
 */
export function PendingApprovals({ conversationId }: { conversationId: string | null }) {
  const pendingApprovals = useApp((s) => s.pendingApprovals);
  const agentId = useApp((s) => s.data?.conversations.find((c) => c.id === conversationId)?.agentId);
  const root = useRef<HTMLDivElement>(null);
  const waiting = Object.values(pendingApprovals).filter((request) => request.conversationId === conversationId);
  const steps = waiting.filter((request) => !request.question);
  const first = steps[0];
  const risks = useToolRisks(steps.map((request) => request.toolName));
  useEffect(() => {
    if (!first) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      // Only while the cards are on screen: not behind a closed panel or another tab.
      const box = root.current;
      if (event.defaultPrevented || typing(event.target) || !box || box.offsetParent === null || box.closest('[inert]'))
        return;
      event.preventDefault();
      decideApproval(first, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [first]);
  if (!conversationId || !waiting.length) return null;
  const asker = coworkerById(agentId)?.name;
  return (
    <div ref={root} className="pending-approvals">
      {steps.length > 1 && (
        <div className="approve-all" role="group" aria-label="Decide on every step that is waiting">
          <div className="approve-all-text">
            <strong>{steps.length} steps are waiting for your OK</strong>
            <small>{riskSummary(risks)}</small>
          </div>
          <div className="approve-all-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={IconClose}
              onClick={() => steps.forEach((request) => decideApproval(request, false))}
            >
              Reject all
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={IconCheck}
              title="Approve each step once, as if you had approved them one by one"
              onClick={() => steps.forEach((request) => decideApproval(request, true))}
            >
              Approve all ({steps.length})
            </Button>
          </div>
        </div>
      )}
      {waiting.map((request) =>
        request.question ? (
          <QuestionCard
            key={request.id}
            request={request}
            askerName={asker}
            onAnswer={(answer) => answerQuestion(request, answer)}
            onSkip={() => answerQuestion(request, '')}
          />
        ) : (
          <ApprovalCard
            key={request.id}
            request={request}
            onDecision={(approved, grant) => decideApproval(request, approved, grant)}
          />
        )
      )}
    </div>
  );
}
