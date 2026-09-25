import type { ChatRequestMessage, Message } from '../shared/types';

/** What a call gets when the run ended before it ran: every call needs a result, or providers refuse the history. */
export const NOT_RUN = 'Not run: the turn ended before this call finished.';

/**
 * The saved conversation as a provider will accept it. Every tool call is followed by exactly one
 * result (failed results included, missing ones answered as not run), results without their call
 * are dropped, and failed answers that said nothing are skipped.
 */
export function requestHistory(messages: readonly Message[]): ChatRequestMessage[] {
  const results = new Map<string, Message>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) results.set(m.toolCallId, m);
  const out: ChatRequestMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'assistant', content: m.content, toolCalls: m.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })) });
      for (const call of m.toolCalls)
        out.push({ role: 'tool', toolCallId: call.id, name: call.name, content: results.get(call.id)?.content || NOT_RUN });
    } else if (m.role === 'assistant' && m.content) out.push({ role: 'assistant', content: m.content });
  }
  return out;
}

const size = (messages: readonly ChatRequestMessage[]) => JSON.stringify(messages).length;

/**
 * Keeps the most recent turns within `maxChars`. Whole turns go, oldest first, so the history still
 * starts with the user and no result loses its call. A last turn that is still too long keeps its
 * question, shortened.
 */
export function fitToBudget(requests: readonly ChatRequestMessage[], maxChars: number): ChatRequestMessage[] {
  let kept = [...requests];
  while (size(kept) > maxChars) {
    const next = kept.findIndex((m, i) => i > 0 && m.role === 'user');
    if (next < 0) break;
    kept = kept.slice(next);
  }
  const last = kept[kept.length - 1];
  if (size(kept) > maxChars && last?.role === 'user') {
    const room = Math.max(1000, maxChars - size(kept.slice(0, -1)) - 1000);
    if (last.content.length > room)
      kept[kept.length - 1] = { ...last, content: `${last.content.slice(0, room)}\n\n[Content truncated to fit local context budget]` };
  }
  return kept;
}
