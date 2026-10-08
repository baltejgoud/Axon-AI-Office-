import type { ModelSpec } from '../shared/types';

// Exact IDs only. Verified 2026-10-08 against OpenAI's model documentation:
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models
// https://developers.openai.com/api/docs/models/gpt-6-sol
// Account-specific catalog limits take precedence over these published defaults.
export function publishedOpenAILimits(id: string): Partial<ModelSpec> {
  return ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'].includes(id)
    ? { contextWindow: 1_050_000, maxOutputTokens: 128_000 }
    : {};
}

/** Ignore malformed catalog fields; do not derive capacity from a model's name. */
export function catalogModelLimits(item: Record<string, any>): Partial<ModelSpec> {
  const valid = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 100_000_000;
  const first = (...values: unknown[]) => values.find(valid) as number | undefined;
  const contextWindow = first(item.context_length, item.context_window, item.inputTokenLimit);
  const maxOutputTokens = first(item.top_provider?.max_completion_tokens, item.max_output_tokens, item.outputTokenLimit);
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {})
  };
}
