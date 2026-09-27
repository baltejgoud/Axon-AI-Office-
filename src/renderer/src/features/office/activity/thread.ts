import type { Conversation, Message } from '../../../../../shared/types';

type Thread = Pick<Conversation, 'id' | 'agentId' | 'updatedAt'>;

/**
 * A thread's messages as people read them: no system or tool messages, with each tool's outcome
 * shown on the call that asked for it.
 */
export function withOutcomes(thread: readonly Message[]): Message[] {
  const outcomes = new Map(thread.filter((m) => m.role === 'tool').map((m) => [m.toolCallId, m]));
  return thread
    .filter((m) => m.role !== 'system' && m.role !== 'tool')
    .map((m) =>
      m.toolCalls?.some((tc) => !tc.result && !tc.error && outcomes.has(tc.id))
        ? {
            ...m,
            toolCalls: m.toolCalls.map((tc) => {
              const outcome = outcomes.get(tc.id);
              if (tc.result || tc.error || !outcome) return tc;
              return outcome.error ? { ...tc, error: outcome.content } : { ...tc, result: outcome.content };
            })
          }
        : m
    );
}

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
