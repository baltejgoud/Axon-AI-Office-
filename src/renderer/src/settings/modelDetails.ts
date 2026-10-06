import type { ModelSpec } from '../../../shared/types';

/** A model's optional details as typed: kept as text, so a field can be empty or mid-edit. */
export interface ModelDetailsInput {
  contextWindow: string;
  tokenizer?: ModelSpec['tokenizer'] | '';
  maxOutputTokens?: string;
  recommendedOutputReserve?: string;
  contextSafetyMargin?: string;
  recentContextTurns?: string;
  inputPrice: string;
  outputPrice: string;
}

export const blankDetails = (): ModelDetailsInput => ({ contextWindow: '', tokenizer: '', maxOutputTokens: '', recommendedOutputReserve: '', contextSafetyMargin: '', recentContextTurns: '', inputPrice: '', outputPrice: '' });

/** The saved models' details, as the fields show them, by model id. */
export function detailsOf(models: readonly ModelSpec[]): Record<string, ModelDetailsInput> {
  return Object.fromEntries(
    models.map((m) => [
      m.id,
      {
        contextWindow: m.contextWindow?.toString() ?? '',
        tokenizer: m.tokenizer ?? '',
        maxOutputTokens: m.maxOutputTokens?.toString() ?? '',
        recommendedOutputReserve: m.recommendedOutputReserve?.toString() ?? '',
        contextSafetyMargin: m.contextSafetyMargin?.toString() ?? '',
        recentContextTurns: m.recentContextTurns?.toString() ?? '',
        inputPrice: m.pricePerMillionInputTokens?.toString() ?? '',
        outputPrice: m.pricePerMillionOutputTokens?.toString() ?? ''
      }
    ])
  );
}

/**
 * The models to save: each id with the details typed for it. Empty fields are left out; one that
 * isn't a sensible number is an error naming the model and what to type.
 */
export function withDetails(
  ids: readonly string[],
  details: Readonly<Record<string, ModelDetailsInput>>
): { models: ModelSpec[] } | { error: string } {
  const models: ModelSpec[] = [];
  for (const id of ids) {
    const typed = details[id] ?? blankDetails();
    const spec: ModelSpec = { id, displayName: id };
    if (typed.tokenizer) spec.tokenizer = typed.tokenizer;
    const window = typed.contextWindow.trim().replace(/[,_\s]/g, '');
    if (window) {
      const tokens = Number(window);
      if (!Number.isInteger(tokens) || tokens <= 0)
        return { error: `Context window for ${id} must be a whole number of tokens, like 128000.` };
      spec.contextWindow = tokens;
    }
    for (const field of ['maxOutputTokens', 'recommendedOutputReserve', 'contextSafetyMargin', 'recentContextTurns'] as const) {
      const raw = (typed[field] ?? '').trim().replace(/[,_\s]/g, '');
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) return { error: `${field} for ${id} must be a positive whole number of tokens.` };
      spec[field] = value;
    }
    if (spec.contextWindow && (spec.recommendedOutputReserve ?? 4096) + (spec.contextSafetyMargin ?? 1024) >= spec.contextWindow)
      return { error: `Output reserve and safety margin must leave room for input for ${id}.` };
    const prices = [
      ['Input price', typed.inputPrice, 'pricePerMillionInputTokens'],
      ['Output price', typed.outputPrice, 'pricePerMillionOutputTokens']
    ] as const;
    for (const [label, text, field] of prices) {
      const raw = text.trim().replace(/^\$/, '');
      if (!raw) continue;
      const price = Number(raw);
      if (!Number.isFinite(price) || price < 0)
        return { error: `${label} for ${id} must be a dollar amount per million tokens, like 3 or 0.25.` };
      spec[field] = price;
    }
    models.push(spec);
  }
  return { models };
}
