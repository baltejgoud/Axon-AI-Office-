import type { Attachment, ChatRequestMessage, Message, RequestImage } from '../shared/types';
import { PICTURE_TOKENS, countable } from './tokenizers';

/** What a call gets when the run ended before it ran: every call needs a result, or providers refuse the history. */
export const NOT_RUN = 'Not run: the turn ended before this call finished.';

/**
 * The saved conversation as a provider will accept it. Every tool call is followed by exactly one
 * result (failed results included, missing ones answered as not run), results without their call
 * are dropped, and failed answers that said nothing are skipped. Your pictures go with your
 * messages as `picture` gives them; with no `picture`, or one it has no data for, they are left out.
 */
export function requestHistory(messages: readonly Message[], picture?: (a: Attachment) => RequestImage | undefined): ChatRequestMessage[] {
  const out: ChatRequestMessage[] = [];
  for (const [index, m] of messages.entries()) {
    if (m.role === 'user') {
      const images = picture ? (m.attachments ?? []).filter(a => a.kind === 'image').map(picture).filter((p): p is RequestImage => Boolean(p)) : [];
      out.push({ role: 'user', content: m.content, sourceMessageId: m.id, ...(images.length ? { images } : {}) });
    }
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

/** Legacy cost estimation input; never used for context admission. Pictures count by number (four characters a token), not by their bytes. */
export const requestSize = (messages: readonly ChatRequestMessage[]) => {
  const { text, pictures } = countable(messages);
  return text.length + pictures * PICTURE_TOKENS * 4;
};
