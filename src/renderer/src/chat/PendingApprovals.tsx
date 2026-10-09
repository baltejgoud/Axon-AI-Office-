import { useEffect, useRef } from 'react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { useApp } from '../state';
import { ApprovalCard } from '../ui/ApprovalCard';

/**
 * Answers a tool's request, from its card in the thread or from the office's work surface. `grant`
 * lets the tool run again without asking: for this task (the conversation's current run) or for the
 * session (until Axon restarts).
 */
export function decideApproval(request: ToolApprovalRequest, approved: boolean, grant?: 'task' | 'session') {
  const next = { ...useApp.getState().pendingApprovals };
  delete next[request.id];
  useApp.getState().patch({ pendingApprovals: next });
  void window.axon.toolApprove({
    requestId: request.id,
    approved,
    ...(approved && grant === 'session' ? { alwaysAllowSession: true } : {}),
    ...(approved && grant === 'task' ? { allowForTask: true } : {})
  });
}

/** Typing in a field keeps Ctrl+Enter for itself. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Tool calls in this conversation that are waiting for the user's decision. While they show,
 * Ctrl+Enter approves the first one (unless you are typing somewhere).
 */
export function PendingApprovals({ conversationId }: { conversationId: string | null }) {
  const pendingApprovals = useApp((s) => s.pendingApprovals);
  const root = useRef<HTMLDivElement>(null);
  const waiting = Object.values(pendingApprovals).filter((request) => request.conversationId === conversationId);
  const first = waiting[0];
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
  return (
    <div ref={root} className="pending-approvals">
      {waiting.map((request) => (
        <ApprovalCard
          key={request.id}
          request={request}
          onDecision={(approved, grant) => decideApproval(request, approved, grant)}
        />
      ))}
    </div>
  );
}
