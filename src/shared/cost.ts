import type { ChatUsage, Message, ModelSpec, ProviderConfig } from './types';

/** The rough size of a token in English text and code. For estimates only, never for billed amounts. */
export const CHARS_PER_TOKEN = 4;
export const estimateTokens = (chars: number): number => Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);

/** A price as typed: a finite number, zero or more (a local model can cost nothing). */
export const validPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

type Priced = ModelSpec & { pricePerMillionInputTokens: number; pricePerMillionOutputTokens: number };
/** Both prices set: only then is a dollar figure shown. */
export const hasPrice = (model: ModelSpec | undefined): model is Priced =>
  !!model && validPrice(model.pricePerMillionInputTokens) && validPrice(model.pricePerMillionOutputTokens);

/** The provider said how many tokens the turn used. Some protocols and models never do. */
export const reportedUsage = (usage: ChatUsage | undefined): usage is ChatUsage =>
  typeof usage?.promptTokens === 'number' || typeof usage?.completionTokens === 'number';

export const modelOf = (providers: readonly ProviderConfig[], providerId?: string, modelId?: string): ModelSpec | undefined =>
  providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId);

const dollars = (tokens: number, perMillion: number) => (tokens * perMillion) / 1_000_000;

/** Dollars for a turn's reported usage; null when the model has no price or the turn reported nothing. */
export function costOf(usage: ChatUsage | undefined, model: ModelSpec | undefined): number | null {
  if (!hasPrice(model) || !reportedUsage(usage)) return null;
  return dollars(usage.promptTokens ?? 0, model.pricePerMillionInputTokens) + dollars(usage.completionTokens ?? 0, model.pricePerMillionOutputTokens);
}

/** Before a call goes out: what its input should cost, and the most its answer can. Estimates. */
export interface RunEstimate {
  inputTokens: number;
  maxOutputTokens: number;
  inputCost: number;
  maxOutputCost: number;
}

/** The estimate for a call carrying `requestChars` of system prompt and history; none without a price. */
export function runEstimate(model: ModelSpec | undefined, requestChars: number, maxOutputTokens: number): RunEstimate | undefined {
  return runEstimateTokens(model, estimateTokens(requestChars), maxOutputTokens);
}

/** Estimate from the actual compiled working-set token budget, including tool schemas. */
export function runEstimateTokens(model: ModelSpec | undefined, inputTokens: number, maxOutputTokens: number): RunEstimate | undefined {
  if (!hasPrice(model)) return undefined;
  return {
    inputTokens,
    maxOutputTokens,
    inputCost: dollars(inputTokens, model.pricePerMillionInputTokens),
    maxOutputCost: dollars(maxOutputTokens, model.pricePerMillionOutputTokens)
  };
}

/** A conversation's running total, as its header shows it. */
export interface ConversationCost {
  /** Dollars from reported usage on priced replies. */
  actual: number;
  /** Dollars estimated for replies still generating: their call's input estimate plus output so far. */
  estimating: number;
  promptTokens: number;
  completionTokens: number;
  /** Replies that reported usage on a model without a price. */
  unpriced: number;
  /** Replies that finished without reporting usage. */
  unreported: number;
  /** At least one reply is on a priced model, so a dollar figure means something. */
  priced: boolean;
}

export function conversationCost(
  messages: readonly Message[],
  providers: readonly ProviderConfig[],
  estimates: Readonly<Record<string, RunEstimate>> = {}
): ConversationCost {
  const total: ConversationCost = { actual: 0, estimating: 0, promptTokens: 0, completionTokens: 0, unpriced: 0, unreported: 0, priced: false };
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const model = modelOf(providers, m.providerId, m.modelId);
    if (reportedUsage(m.usage)) {
      total.promptTokens += m.usage.promptTokens ?? 0;
      total.completionTokens += m.usage.completionTokens ?? 0;
      const cost = costOf(m.usage, model);
      if (cost === null) total.unpriced++;
      else {
        total.actual += cost;
        total.priced = true;
      }
    } else if (m.streaming) {
      if (!hasPrice(model)) continue;
      total.priced = true;
      // Thinking is billed as output too.
      const written = estimateTokens(m.content.length + (m.thought?.length ?? 0));
      total.estimating += (estimates[m.id]?.inputCost ?? 0) + dollars(written, model.pricePerMillionOutputTokens);
    } else if (m.content || m.toolCalls?.length) total.unreported++;
  }
  return total;
}

/** "$0.00", "<$0.0001", "$0.0042", "$0.42", "$12.30". */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.0001) return '<$0.0001';
  return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
}

/** "950", "12.3K", "2M". */
export function formatTokens(count: number): string {
  const short = (value: number, unit: string) => `${value.toFixed(1).replace(/\.0$/, '')}${unit}`;
  return count >= 1e6 ? short(count / 1e6, 'M') : count >= 1e3 ? short(count / 1e3, 'K') : String(Math.round(count));
}
