import type { AskedQuestion, ToolDefinition } from './types';

/**
 * A coworker asking you a question (the `ask_user` tool) instead of guessing or stopping. Pure, so the
 * main process (which waits for your answer) and the window (which shows the card) agree on the rules.
 */

export const ASK_USER = 'ask_user';

/** The longest question, choice and answer kept; anything past it is cut. */
export const MAX_QUESTION = 600;
export const MAX_OPTION = 80;
export const MAX_ANSWER = 2000;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export const ASK_USER_TOOL: ToolDefinition = {
  name: ASK_USER,
  description:
    'Ask one essential user decision; never re-ask task permission.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: {
        type: 'array',
        items: { type: 'string' }
      },
      allow_other: { type: 'boolean', default: true }
    },
    required: ['question']
  }
};

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The question a call carries, cleaned for the card: trimmed, the choices de-duplicated and kept to a
 * handful. One choice on its own is no choice, so it is left out. With no choices you can only type.
 */
export function readQuestion(args: Record<string, unknown>): { question: AskedQuestion } | { error: string } {
  const text = typeof args.question === 'string' ? args.question.replace(/\s+/g, ' ').trim() : '';
  if (!text) return { error: 'Say what you want to ask the user in the "question" field, then call ask_user again.' };
  const seen = new Set<string>();
  const options: string[] = [];
  for (const option of Array.isArray(args.options) ? args.options : []) {
    if (typeof option !== 'string') continue;
    const choice = clip(option.replace(/\s+/g, ' ').trim(), MAX_OPTION);
    if (!choice || seen.has(choice.toLowerCase())) continue;
    seen.add(choice.toLowerCase());
    options.push(choice);
  }
  const choices = options.length >= MIN_OPTIONS ? options.slice(0, MAX_OPTIONS) : [];
  return {
    question: {
      text: clip(text, MAX_QUESTION),
      options: choices,
      // Nothing to pick from means typing is the only way to answer.
      allowOther: choices.length === 0 || args.allow_other !== false
    }
  };
}

/** What a typed answer comes to: trimmed and kept to a sensible length. Empty when there is nothing in it. */
export const cleanAnswer = (answer: unknown): string =>
  typeof answer === 'string' ? clip(answer.trim(), MAX_ANSWER) : '';

/** What the coworker is told you said. A skipped question hands the decision back to them. */
export function answerResult(question: AskedQuestion, answer: string | undefined): string {
  const said = cleanAnswer(answer);
  if (!said) return 'The user chose not to answer. Decide for yourself, and tell them what you chose and why.';
  return question.options.includes(said) ? `${CHOSE}${said}` : `${ANSWERED}${said}`;
}

const CHOSE = 'The user chose: ';
const ANSWERED = 'The user answered: ';

/** What you said, read back from the result a call carries; `skipped` when you let them decide. */
export function answerFromResult(result: string | undefined): { answer?: string; skipped: boolean } {
  if (!result) return { skipped: false };
  if (result.startsWith(CHOSE)) return { answer: result.slice(CHOSE.length), skipped: false };
  if (result.startsWith(ANSWERED)) return { answer: result.slice(ANSWERED.length), skipped: false };
  return { skipped: true };
}

/** A call's question as it was asked, for showing in the thread; empty while its words are still arriving. */
export function questionOf(argumentsJson: string): string {
  try {
    const args = JSON.parse(argumentsJson || '{}');
    return typeof args?.question === 'string' ? args.question.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}
