/**
 * Choosing models for a new provider from the list its key can use, so a pasted key is all it
 * takes: the service's own suggestions when the key has them, else the newest model of each family
 * the service is known for, else whatever chat models it offers.
 */
export interface ModelPreference {
  /** Exact IDs, first choice when the key has them. */
  exact: readonly string[];
  /** Families, one model each (the newest), in order: flagship, balanced, fast. */
  families: readonly RegExp[];
}

export const PREFERENCES: Readonly<Record<string, ModelPreference>> = {
  OpenAI: { exact: [], families: [/^gpt-[\d.]+$/, /^gpt-[\d.]+-mini$/, /^gpt-4o$/] },
  Anthropic: { exact: [], families: [/^claude-opus/, /^claude-sonnet/, /^claude-haiku/] },
  Gemini: { exact: [], families: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/] },
  DeepSeek: { exact: ['deepseek-chat', 'deepseek-reasoner'], families: [] },
  Kimi: { exact: ['kimi-k3', 'kimi-k2.6'], families: [/^kimi-k[\d.]+$/] },
  Qwen: {
    exact: ['qwen3.8-max', 'qwen-plus'],
    families: [/^qwen[\d.]*-max$/, /^qwen[\d.]*-plus$/, /^qwen[\d.]*-flash$/]
  },
  OpenRouter: {
    exact: ['moonshotai/kimi-k3', 'qwen/qwen3.8-max-0902'],
    families: [/^moonshotai\/kimi-k[\d.]+$/, /^qwen\/qwen[\d.]*-max/, /^deepseek\/deepseek-chat/]
  },
  Ollama: { exact: [], families: [] },
  'Union Alpha': { exact: [], families: [] },
  Custom: { exact: [], families: [] }
};

/** Models that do not chat: embeddings, speech, images, moderation, rerankers. */
const NOT_CHAT =
  /embed|tts|whisper|audio|speech|transcri|dall-e|image|imagen|moderation|rerank|asr|paraformer|sambert|cosyvoice|wanx|flux|diffusion|ocr|realtime|veo|lyria|aqa/i;
const MAX_CHOSEN = 3;

/** Keys whose prefix names their service. Plain `sk-` keys (OpenAI, DeepSeek, Kimi, Qwen) do not. */
export function serviceFromKey(key: string): string | null {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'Anthropic';
  if (k.startsWith('sk-or-')) return 'OpenRouter';
  if (k.startsWith('AIza')) return 'Gemini';
  return null;
}

/** The first number in an ID (its version), dates left out: gpt-5.1 → 5.1, claude-opus-4-1-20250805 → 4. */
function version(id: string): number {
  const match = id.replace(/\d{6,8}/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

/** The newest of these: highest version, then the plainest name (no snapshot or preview suffix). */
function newest(ids: string[]): string | undefined {
  return [...ids].sort((a, b) => version(b) - version(a) || a.length - b.length || a.localeCompare(b))[0];
}

/**
 * The models to use: those already listed that the key has (the user's or the preset's), else the
 * preference, else the first chat models offered.
 */
export function chooseModels(
  available: readonly string[],
  current: readonly string[],
  preference: ModelPreference = PREFERENCES.Custom
): string[] {
  const offered = new Set(available);
  const kept = current.filter((id) => offered.has(id));
  if (kept.length) return kept;
  const chat = available.filter((id) => !NOT_CHAT.test(id));
  const chosen: string[] = [];
  for (const id of preference.exact) if (offered.has(id) && chosen.length < MAX_CHOSEN) chosen.push(id);
  for (const family of preference.families) {
    if (chosen.length >= MAX_CHOSEN || chosen.some((id) => family.test(id))) continue;
    const pick = newest(chat.filter((id) => family.test(id)));
    if (pick) chosen.push(pick);
  }
  if (!chosen.length) chosen.push(...chat.slice(0, MAX_CHOSEN));
  return chosen;
}
