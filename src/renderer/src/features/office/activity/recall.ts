import type { Message } from '../../../../../shared/types';
import { visibleUserText } from '../../../../../shared/user-text';

/**
 * What you sent in a conversation, oldest first, as the chat shows it: your own messages with the
 * attachment and file blocks left out. Messages a lead or a teammate sent (they carry `from`) are
 * skipped, and so is anything that is only files.
 */
export function sentTexts(messages: readonly Pick<Message, 'role' | 'content' | 'from'>[]): string[] {
  return messages
    .filter((m) => m.role === 'user' && !m.from)
    .map((m) => visibleUserText(m.content))
    .filter((text) => text.trim() !== '');
}

/**
 * One step through `history` (oldest first) for the Up and Down keys. `index` counts the steps back
 * from the newest message: -1 is none, the box as you left it. Up goes one further back and stays on
 * the oldest; Down comes one step forward, and the step past the newest is -1 with an empty box.
 */
export function recallStep(
  history: readonly string[],
  index: number,
  direction: 'up' | 'down'
): { index: number; text: string } {
  if (!history.length) return { index: -1, text: '' };
  if (direction === 'up') {
    const next = Math.min(Math.max(index, -1) + 1, history.length - 1);
    return { index: next, text: history[history.length - 1 - next] };
  }
  const next = Math.min(index, history.length - 1) - 1;
  if (next < 0) return { index: -1, text: '' };
  return { index: next, text: history[history.length - 1 - next] };
}
