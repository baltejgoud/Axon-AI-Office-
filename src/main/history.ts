import type { ChatRequestMessage, Message } from '../shared/types';

/** What a call gets when the run ended before it ran: every call needs a result, or providers refuse the history. */
export const NOT_RUN = 'Not run: the turn ended before this call finished.';

/**
 * The saved conversation as a provider will accept it. Every tool call is followed by exactly one
 * result (failed results included, missing ones answered as not run), results without their call
 * are dropped, and failed answers that said nothing are skipped.
 */
export function requestHistory(messages: readonly Message[]): ChatRequestMessage[] {
  const out: ChatRequestMessage[] = [];
  for (const [index, m] of messages.entries()) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content, sourceMessageId: m.id });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'assistant', content: m.content, sourceMessageId: m.id, toolCalls: m.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args })) });
      const following: Message[] = [];
      for (let i = index + 1; i < messages.length && messages[i].role === 'tool'; i++) following.push(messages[i]);
      for (const call of m.toolCalls) {
        const result = following.find(message => message.toolCallId === call.id);
        out.push({ role: 'tool', sourceMessageId: result?.id, toolCallId: call.id, name: call.name, content: result?.content || NOT_RUN });
      }
    } else if (m.role === 'assistant' && m.content) out.push({ role: 'assistant', content: m.content, sourceMessageId: m.id });
  }
  return out;
}

/** Legacy cost estimation input; never used for context admission. */
export const requestSize = (messages: readonly ChatRequestMessage[]) => JSON.stringify(messages).length;
