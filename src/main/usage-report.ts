import type { ChatUsage, Conversation, Message, ProviderConfig } from '../shared/types';
import type { UsageReport, UsageRow, UsageTotals } from '../shared/platform';
import { costOf, hasPrice, modelOf, reportedUsage } from '../shared/cost';
import { addDays, dayKey } from '../shared/planner';

/** Rows the Usage page gets: the newest days, and the most recently used conversations. */
export const DAYS_LISTED = 30;
export const CONVERSATIONS_LISTED = 50;

const blank = (): UsageTotals => ({ promptTokens: 0, completionTokens: 0, cost: null, turns: 0, unpricedTurns: 0 });

function add(totals: UsageTotals, usage: ChatUsage, cost: number | null): void {
  totals.turns++;
  totals.promptTokens += usage.promptTokens ?? 0;
  totals.completionTokens += usage.completionTokens ?? 0;
  if (cost === null) totals.unpricedTurns++;
  else totals.cost = (totals.cost ?? 0) + cost;
}

/** Most spent first; rows without a price by their tokens. */
const bySpend = (a: UsageRow, b: UsageRow) =>
  (b.totals.cost ?? -1) - (a.totals.cost ?? -1) ||
  b.totals.promptTokens + b.totals.completionTokens - (a.totals.promptTokens + a.totals.completionTokens);

/** The row for `key`, made on first use. */
function rowIn<R extends UsageRow>(rows: Map<string, R>, key: string, make: () => Omit<R, 'totals'>): R {
  let row = rows.get(key);
  if (!row) rows.set(key, (row = { ...make(), totals: blank() } as R));
  return row;
}

/**
 * Settings → Usage, from the replies themselves: each assistant message keeps the usage its provider
 * reported, with its provider and model, so nothing is kept apart and nothing drifts. Replies still
 * generating are left out until they finish.
 */
export function buildUsageReport(
  state: { messages: readonly Message[]; providers: readonly ProviderConfig[]; conversations: readonly Conversation[] },
  now: Date
): UsageReport {
  const todayKey = dayKey(now), weekStart = addDays(todayKey, -6);
  const today = blank(), week = blank(), allTime = blank();
  let unreportedTurns = 0;
  const days = new Map<string, UsageRow>();
  const providers = new Map<string, UsageRow>();
  const models = new Map<string, UsageRow & { priced: boolean }>();
  const chats = new Map<string, UsageRow & { lastUsedAt: number }>();

  for (const m of state.messages) {
    if (m.role !== 'assistant' || m.streaming) continue;
    if (!reportedUsage(m.usage)) {
      if (m.content || m.toolCalls?.length) unreportedTurns++;
      continue;
    }
    const model = modelOf(state.providers, m.providerId, m.modelId);
    const cost = costOf(m.usage, model);
    const day = dayKey(new Date(m.createdAt));
    const providerName = state.providers.find((p) => p.id === m.providerId)?.name ?? 'Removed provider';
    const chat = rowIn(chats, m.conversationId, () => ({
      key: m.conversationId,
      label: state.conversations.find((c) => c.id === m.conversationId)?.title ?? 'Deleted conversation',
      lastUsedAt: 0
    }));
    chat.lastUsedAt = Math.max(chat.lastUsedAt, m.createdAt);
    const buckets = [
      allTime,
      ...(day >= weekStart ? [week] : []),
      ...(day === todayKey ? [today] : []),
      rowIn(days, day, () => ({ key: day, label: day })).totals,
      rowIn(providers, m.providerId ?? '', () => ({ key: m.providerId ?? '', label: providerName })).totals,
      rowIn(models, `${m.providerId}::${m.modelId}`, () => ({
        key: `${m.providerId}::${m.modelId}`,
        label: model?.displayName || m.modelId || 'Unknown model',
        detail: providerName,
        priced: hasPrice(model)
      })).totals,
      chat.totals
    ];
    for (const totals of buckets) add(totals, m.usage, cost);
  }

  return {
    today,
    week,
    allTime,
    byDay: [...days.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, DAYS_LISTED),
    byProvider: [...providers.values()].sort(bySpend),
    byModel: [...models.values()].sort(bySpend),
    conversations: [...chats.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, CONVERSATIONS_LISTED),
    unreportedTurns
  };
}
