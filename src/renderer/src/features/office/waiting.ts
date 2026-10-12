import type { RunStatus } from '../../../../shared/runtime';
import type { ToolApprovalRequest } from '../../../../shared/types';

/**
 * The status a conversation shows while something waits on you: "reply to coworker" for a question,
 * "review request" for a step to approve; undefined when nothing waits.
 */
export function waitingStatus(
  requests: Iterable<ToolApprovalRequest>,
  conversationId: string | undefined
): RunStatus | undefined {
  let waiting: RunStatus | undefined;
  for (const request of requests) {
    if (request.conversationId !== conversationId) continue;
    if (request.question) return 'waiting_for_user';
    waiting = 'waiting_for_approval';
  }
  return waiting;
}
