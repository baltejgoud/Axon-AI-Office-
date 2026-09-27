/**
 * How full a conversation's context is. The characters are what `fitToBudget` trims by (the system
 * prompt plus the untrimmed history, against the character budget), so a full meter is exactly the
 * point where older turns start to be left out. When the model has a context window and last
 * reported its prompt size, tokens are measured too, and the fuller of the two shows.
 */
export interface ContextUsage {
  usedChars: number;
  budgetChars: number;
  /** The fuller of usedChars / budgetChars and, when known, usedTokens / windowTokens; within [0, 1]. */
  pct: number;
  /** The provider's last reported prompt size, against the model's context window. */
  tokenBasis?: { usedTokens: number; windowTokens: number };
  /** True when tokenBasis is absent (character proxy only). */
  estimated: boolean;
}

/** Smaller than any chat model's window: a context window below this is a typo (0, or 128 meant as 128K). */
export const MIN_CONTEXT_WINDOW = 1024;

const ratio = (used: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, used / total)) : 0);
/** A count that can be trusted: finite and above zero, else 0. */
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

export function contextUsage(input: { usedChars: number; budgetChars: number; contextWindow?: number; promptTokens?: number }): ContextUsage {
  const usedChars = count(input.usedChars), budgetChars = count(input.budgetChars);
  const chars = ratio(usedChars, budgetChars);
  const windowTokens = count(input.contextWindow), usedTokens = count(input.promptTokens);
  if (windowTokens >= MIN_CONTEXT_WINDOW && usedTokens > 0)
    return { usedChars, budgetChars, pct: Math.max(chars, ratio(usedTokens, windowTokens)), tokenBasis: { usedTokens, windowTokens }, estimated: false };
  return { usedChars, budgetChars, pct: chars, estimated: true };
}

/** How the meter looks: fine, getting full, or full (older turns are going, or about to). */
export const meterTone = (pct: number): 'ok' | 'high' | 'full' => (pct >= 0.9 ? 'full' : pct >= 0.75 ? 'high' : 'ok');
