import type { Conversation, Message } from '../shared/types';
import { attachmentIdsIn } from '../shared/rewrite';

/**
 * Takes a conversation's own bookkeeping off the messages that were just cut away, so nothing in it
 * points at a message that is gone: the saved memory (its source ids, hashes and facts) and the
 * attachments the model may read (only those a remaining message still carries, plus `keep`).
 *
 * Undo records, stored tool outputs and the activity log are keyed by tool call, not by message, and
 * stay as they are: a file a removed reply changed is still changed, and can still be put back.
 */
export function pruneReferences(
  chat: Conversation,
  removed: readonly Message[],
  remaining: readonly Message[],
  keep: readonly string[] = []
): void {
  const gone = new Set(removed.map((message) => message.id));
  if (!gone.size) return;
  const memory = chat.memory;
  if (memory) {
    const facts = memory.facts.filter((fact) => !fact.sourceMessageId || !gone.has(fact.sourceMessageId));
    const sourceMessageIds = memory.sourceMessageIds.filter((id) => !gone.has(id));
    const sourceHashes = memory.sourceHashes
      ? Object.fromEntries(Object.entries(memory.sourceHashes).filter(([id]) => !gone.has(id)))
      : undefined;
    const changed =
      facts.length !== memory.facts.length ||
      sourceMessageIds.length !== memory.sourceMessageIds.length ||
      (sourceHashes !== undefined && Object.keys(sourceHashes).length !== Object.keys(memory.sourceHashes ?? {}).length);
    if (changed) {
      chat.memory = { ...memory, facts, sourceMessageIds, ...(sourceHashes ? { sourceHashes } : {}) };
      // What is left is read again soon, so memory only ever describes the conversation as it is.
      chat.memoryNeedsCheckpoint = true;
    }
  }
  if (chat.attachmentRefs?.length) {
    const carried = new Set([...keep, ...remaining.flatMap((message) => (message.role === 'user' ? attachmentIdsIn(message.content) : []))]);
    const refs = chat.attachmentRefs.filter((ref) => carried.has(ref.id));
    if (refs.length !== chat.attachmentRefs.length) chat.attachmentRefs = refs;
  }
}
