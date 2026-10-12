import type { Message } from '../shared/types';
import { attachmentIdsIn, userBlocks, writtenByYou } from '../shared/rewrite';
import { visibleUserText } from '../shared/user-text';
import { withMentions } from '../shared/mentions';
import { COWORKERS } from '../shared/coworkers';

/** A retry or an edit: where a conversation is cut back to before it carries on. */
export interface Rewrite {
  /** The message the cut is made at. */
  fromId: string;
  /** It goes too (an edit: the message is replaced) or it stays (a retry: only its replies go). */
  inclusive: boolean;
  /** Attachments the new turn still carries, kept even though the message that brought them is replaced. */
  keepAttachmentIds: string[];
}

/** What a rewrite runs with: the words as the run sees them, and the whole stored message (words + blocks). */
export interface RewritePlan {
  rewrite: Rewrite;
  input: string;
  content: string;
}

/** Retry: the last message you sent stays, its replies go, and the coworker answers it again. */
export function planRetry(messages: readonly Message[]): RewritePlan {
  const at = messages.findLastIndex((m) => m.role === 'user');
  if (at < 0) throw new Error("There's nothing to ask again yet.");
  const user = messages[at];
  if (!writtenByYou(user))
    throw new Error('That message came from a teammate, so it is not asked again here.');
  if (!messages.slice(at + 1).some((m) => m.role === 'assistant'))
    throw new Error("There's no reply to replace yet.");
  return {
    rewrite: { fromId: user.id, inclusive: false, keepAttachmentIds: [] },
    input: visibleUserText(user.content),
    content: user.content
  };
}

/**
 * Edit: your message is replaced by the same message with new words, and everything after it goes.
 * Its attachment and file blocks are kept exactly as they were, with the attachments they name.
 */
export function planEdit(messages: readonly Message[], messageId: string, words: string, agentId = ''): RewritePlan {
  const original = messages.find((m) => m.id === messageId);
  if (!original) throw new Error('That message is no longer in this conversation.');
  if (!writtenByYou(original)) throw new Error('Only messages you wrote yourself can be edited.');
  const blocks = userBlocks(original.content).replace(/\n\n<mentioned-colleagues>[\s\S]*?<\/mentioned-colleagues>/g, '');
  const content = withMentions(words, COWORKERS, agentId) + blocks;
  return {
    rewrite: { fromId: original.id, inclusive: true, keepAttachmentIds: attachmentIdsIn(original.content) },
    input: words,
    content
  };
}

/** How many saved messages a rewritten run starts from: those before the cut, and the message itself when it stays. */
export function keptCount(messages: readonly Message[], rewrite: Rewrite): number {
  const at = messages.findIndex((m) => m.id === rewrite.fromId);
  if (at < 0) throw new Error('That message is no longer in this conversation.');
  return at + (rewrite.inclusive ? 0 : 1);
}
