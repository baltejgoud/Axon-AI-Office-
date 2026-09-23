import { useApp } from '../state';
import { ApprovalCard } from '../ui/ApprovalCard';

/** Tool calls in this conversation that are waiting for the user's decision. */
export function PendingApprovals({ conversationId }: { conversationId: string | null }) {
  const pendingApprovals = useApp((s) => s.pendingApprovals);
  if (!conversationId) return null;
  return (
    <>
      {Object.values(pendingApprovals)
        .filter((request) => request.conversationId === conversationId)
        .map((request) => (
          <ApprovalCard
            key={request.id}
            request={request}
            onDecision={(approved, alwaysAllowSession) => {
              const next = { ...useApp.getState().pendingApprovals };
              delete next[request.id];
              useApp.getState().patch({ pendingApprovals: next });
              void window.axon.toolApprove({ requestId: request.id, approved, alwaysAllowSession });
            }}
          />
        ))}
    </>
  );
}
