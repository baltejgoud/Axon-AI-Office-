import { useApp } from '../../../state';
import { useState } from 'react';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { decideApproval } from '../../../chat/PendingApprovals';
import { diffStats } from '../workspace/work';
import type { ToolApprovalRequest } from '../../../../../shared/types';

export function ApprovalOverlay() {
  const pending = useApp((s) => s.pendingApprovals);
  const conversations = useApp((s) => s.data?.conversations);
  const fullscreen = useOfficeStore((s) => s.workFullscreen);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const requests = Object.values(pending);
  const current = requests.find((r) => r.id === selectedRequest) ?? requests[0];
  if (fullscreen) return null;
  if (!requests.length) return null;
  const review = (request: ToolApprovalRequest) => {
    const thread = conversations?.find((c) => c.id === request.conversationId);
    if (!thread?.agentId) return;
    const office = useOfficeStore.getState();
    office.focusOn({ agentId: thread.agentId, conversationId: thread.id });
    office.closeConversation();
    office.focusWork(thread.id, request.toolCallId);
  };
  return (
    <section
      className="approval-overlay"
      data-office-obstacle
      aria-label="Pending approvals"
      aria-live="polite"
    >
      {requests.length > 1 && (
        <div className="approval-queue">
          <strong>{requests.length} requests need you</strong>
          <select
            aria-label="Choose approval request"
            value={current.id}
            onChange={(e) => setSelectedRequest(e.target.value)}
          >
            {requests.map((request, index) => (
              <option key={request.id} value={request.id}>
                {index + 1}. {request.toolName} —{' '}
                {conversations?.find((c) => c.id === request.conversationId)?.title ?? 'Coworker'}
              </option>
            ))}
          </select>
        </div>
      )}
      {[current].map((request) => {
        const thread = conversations?.find((c) => c.id === request.conversationId);
        const agent = OFFICE_AGENTS.find((a) => a.id === thread?.agentId);
        const stats = request.preview?.type === 'diff' ? diffStats(request.preview.content) : null;
        return (
          <article key={request.id} className="office-approval-card">
            <header>
              <strong>{agent?.name ?? thread?.title ?? 'Coworker'} needs you</strong>
              <span>{request.toolName}</span>
            </header>
            <p title={request.preview?.path ?? String(request.arguments.path ?? '')}>
              {request.preview?.path ??
                String(request.arguments.path ?? request.arguments.command ?? request.toolName)}
            </p>
            {stats && (
              <div className="approval-change-stats">
                <span>+{stats.added}</span>
                <span>−{stats.removed}</span>
              </div>
            )}
            {request.preview?.type === 'command' && <pre>{request.preview.content}</pre>}
            <div className="office-approval-actions">
              <button disabled={!agent} onClick={() => review(request)}>
                {stats ? 'Review diff' : 'Review work'}
              </button>
              <button onClick={() => decideApproval(request, false)}>Reject</button>
              <button onClick={() => decideApproval(request, true)}>Approve</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
