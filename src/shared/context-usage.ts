/** Compiled working context. Character fields are retained only for old IPC clients. */
export interface ContextUsage {
  state?: 'healthy' | 'optimizing' | 'compacting' | 'near-limit' | 'recovery-required';
  outputReserve?: number;
  safetyMargin?: number;
  archivedTokens?: number;
  sections?: Record<string, number>;
  usedChars: number;
  budgetChars: number;
  /** The fuller of usedChars / budgetChars and, when known, usedTokens / windowTokens; within [0, 1]. */
  pct: number;
  /** Estimated compiled input tokens, against the selected model window. */
  tokenBasis?: { usedTokens: number; windowTokens: number };
  /** True when tokenBasis is absent (character proxy only). */
  estimated: boolean;
}

/** Smaller than any chat model's window: a context window below this is a typo (0, or 128 meant as 128K). */
export const MIN_CONTEXT_WINDOW = 1024;

const ratio = (used: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, used / total)) : 0);
/** A count that can be trusted: finite and above zero, else 0. */
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

export function contextUsage(input: { inputTokens: number; contextWindow: number; outputReserve?: number; safetyMargin?: number; archivedTokens?: number; sections?: Record<string, number> }): ContextUsage {
  const windowTokens = count(input.contextWindow);
  const usedTokens = count(input.inputTokens);
  return { usedChars: 0, budgetChars: 0, pct: ratio(usedTokens, windowTokens), estimated: true,
    tokenBasis: { usedTokens, windowTokens }, outputReserve: count(input.outputReserve),
    safetyMargin: count(input.safetyMargin), archivedTokens: count(input.archivedTokens), sections: input.sections };
}

/** How the meter looks: fine, getting full, or full (older turns are going, or about to). */
export const meterTone = (pct: number): 'ok' | 'high' | 'full' => (pct >= 0.9 ? 'full' : pct >= 0.75 ? 'high' : 'ok');
