import type { Message } from '../../../shared/types';
import { visibleUserText } from './MessageView';

/** Every saved message of a conversation, oldest first: all history pages, not only what is on screen. */
export async function wholeConversation(conversationId: string): Promise<Message[]> {
  const pages: Message[][] = [];
  let before: number | undefined;
  // A page is 100 messages; 200 pages is far past any real thread, and stops a loop that never ends.
  for (let i = 0; i < 200; i++) {
    const page = await window.axon.chatHistoryPage(conversationId, before);
    pages.unshift(page.messages);
    if (page.nextBefore === undefined || page.nextBefore === before) break;
    before = page.nextBefore;
  }
  return [...new Map(pages.flat().map((m) => [m.id, m])).values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** What was said, as Markdown: your messages and their replies, without tool traffic or empty steps. */
export function transcriptMarkdown(
  messages: readonly Message[],
  { title, agentName }: { title?: string; agentName: string }
): string {
  const when = (at: number) =>
    new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const said = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .map((m) => {
      const who = m.role === 'user' ? (m.from ?? 'You') : agentName;
      const body = m.role === 'user' ? visibleUserText(m.content) : m.content;
      return `### ${who} · ${when(m.createdAt)}\n\n${body.trim()}`;
    });
  return [title ? `# ${title}` : '', ...said].filter(Boolean).join('\n\n---\n\n') + '\n';
}

/** A file name for a reply: its first heading or line, without Markdown marks. */
export function replyFileName(content: string, fallback: string): string {
  const first = content
    .split('\n')
    .map((line) => line.replace(/^#+\s*|[*_`>#]/g, '').trim())
    .find(Boolean);
  return (first ?? fallback).slice(0, 70);
}
