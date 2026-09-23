import type { Conversation } from '../../../../../shared/types';

type Thread = Pick<Conversation, 'id' | 'agentId' | 'updatedAt'>;

/** Every conversation with this coworker, newest first. */
export function agentThreads<T extends Thread>(conversations: readonly T[], agentId: string): T[] {
  return conversations
    .filter((conversation) => conversation.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The conversation the side panel shows: the one the office is tracking for this coworker if it
 * still exists, otherwise their newest. Nothing when the user asked for a fresh thread.
 */
export function activeThread<T extends Thread>(
  conversations: readonly T[],
  agentId: string,
  runtime?: { conversationId?: string; fresh?: boolean }
): T | undefined {
  if (runtime?.fresh) return undefined;
  const tracked = conversations.find((c) => c.id === runtime?.conversationId);
  return tracked ?? agentThreads(conversations, agentId)[0];
}
