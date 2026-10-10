import type { Conversation, Message } from '../shared/types';
import type { ConversationHit } from '../shared/platform';
import { visibleUserText } from '../shared/user-text';

/** What search reads of a message: your messages and the replies, as people see them. */
export type SearchEntry = Pick<Message, 'id' | 'role' | 'content' | 'createdAt'>;

/** Your messages (without the files sent along) and the replies; tool output and system notes aren't searched. */
export function searchEntries(messages: readonly Message[]): SearchEntry[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.role === 'user' ? visibleUserText(m.content) : m.content,
      createdAt: m.createdAt
    }));
}

/** The query's words, lower-cased: a result has every one. */
const wordsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);

/** The text around the first word found, on one line, for the result's preview. */
export function snippet(text: string, words: readonly string[], room = 140): string {
  const flat = text.replace(/[#*_`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  const found = words.map((word) => lower.indexOf(word)).filter((at) => at >= 0);
  const at = found.length ? Math.min(...found) : 0;
  const start = at > 40 ? flat.lastIndexOf(' ', at - 30) + 1 : 0;
  const end = start + room;
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

/**
 * Past conversations whose title or one message has every word of the query: title matches first,
 * then the most recently active. Each names the newest message that matched, to open it there.
 */
export function searchConversations(
  conversations: readonly Conversation[],
  entriesOf: (id: string) => readonly SearchEntry[],
  query: string,
  limit = 12
): ConversationHit[] {
  const words = wordsOf(query);
  if (words.join('').length < 2) return [];
  const has = (text: string) => {
    const lower = text.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  const hits: ConversationHit[] = [];
  for (const chat of conversations) {
    const inTitle = has(chat.title);
    const entries = entriesOf(chat.id);
    let found: SearchEntry | undefined;
    for (let i = entries.length - 1; i >= 0 && !found; i--) if (has(entries[i].content)) found = entries[i];
    if (!inTitle && !found) continue;
    hits.push({
      conversationId: chat.id,
      agentId: chat.agentId,
      title: chat.title,
      updatedAt: chat.updatedAt,
      inTitle,
      ...(found && {
        messageId: found.id,
        fromYou: found.role === 'user',
        snippet: snippet(found.content, words)
      })
    });
  }
  return hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.updatedAt - a.updatedAt).slice(0, limit);
}
