import type { Message, Team } from './types';
import { visibleUserText } from './user-text';

/**
 * What a stored message of yours carries after the words you typed: the attachment and file blocks
 * sent along for the model. An edit changes the words and keeps these exactly as they were.
 */
export function userBlocks(content: string): string {
  return content.slice(visibleUserText(content).length);
}

/** The attachments a stored message carries, by id (each block is `<attachment name=".." attachmentId="..">`). */
export function attachmentIdsIn(content: string): string[] {
  const ids: string[] = [];
  for (const match of userBlocks(content).matchAll(/<attachment [^>]*?\battachmentId=("(?:[^"\\]|\\.)*")/g)) {
    try {
      const id: unknown = JSON.parse(match[1]);
      if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    } catch {
      /* Not a block Axon wrote: it names nothing. */
    }
  }
  return ids;
}

/** A message you wrote yourself: not a lead's brief to a teammate, and not a teammate's message. */
export const writtenByYou = (message: Pick<Message, 'role' | 'from'>): boolean =>
  message.role === 'user' && !message.from;

/** A team member's task conversation: the lead owns its messages, so they are not rewritten here. */
export const isTeamTask = (teams: readonly Pick<Team, 'plan'>[], conversationId: string): boolean =>
  teams.some((team) => team.plan?.assignments.some((a) => a.conversationId === conversationId));

/** How many file changes in the messages from `from` on are still in place (not undone). */
export function filesChangedAfter(messages: readonly Message[], from: number): number {
  let changed = 0;
  for (const message of messages.slice(Math.max(0, from)))
    for (const call of message.toolCalls ?? []) if (call.change && !call.change.revertedAt) changed++;
  return changed;
}
