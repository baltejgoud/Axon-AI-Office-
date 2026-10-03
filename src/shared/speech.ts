import type { ProviderConfig } from './types';

/** Voice typing: which service turns your speech into text, and the language you speak. */
export interface VoiceSettings {
  /** The provider whose key transcribes; null picks the first one that can. */
  providerId: string | null;
  /** Its transcription model; '' picks the provider's most accurate. */
  model: string;
  /** ISO-639-1 code, or '' to let the service detect it (less accurate on short clips). */
  language: string;
}

export const DEFAULT_VOICE: VoiceSettings = { providerId: null, model: '', language: 'en' };

/** A transcription model a service offers, most accurate first. */
export interface SpeechModel {
  id: string;
  label: string;
  /** Whisper models report each stretch's chance of being silence, so phantom lines can be dropped. */
  segments: boolean;
}

/** Services with an OpenAI-style /audio/transcriptions endpoint, matched by host. */
const SPEECH_SERVICES: readonly { host: RegExp; models: readonly SpeechModel[] }[] = [
  {
    host: /(^|\.)groq\.com$/i,
    models: [
      { id: 'whisper-large-v3', label: 'Whisper large v3 (most accurate)', segments: true },
      { id: 'whisper-large-v3-turbo', label: 'Whisper large v3 turbo (faster)', segments: true }
    ]
  },
  {
    host: /(^|\.)openai\.com$/i,
    models: [
      { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe (most accurate)', segments: false },
      { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe (cheaper)', segments: false },
      { id: 'whisper-1', label: 'Whisper', segments: true }
    ]
  }
];

/** One provider-and-model pair that can transcribe. */
export interface SpeechEngine {
  providerId: string;
  providerName: string;
  model: SpeechModel;
}

/** The transcription models a provider's endpoint offers; none for services without one. */
export function speechModels(provider: Pick<ProviderConfig, 'kind' | 'baseUrl'>): readonly SpeechModel[] {
  if (provider.kind !== 'openai-compatible' || !provider.baseUrl) return [];
  let host: string;
  try {
    host = new URL(provider.baseUrl).hostname;
  } catch {
    return [];
  }
  return SPEECH_SERVICES.find((service) => service.host.test(host))?.models ?? [];
}

/** Every engine your saved keys can use, the most accurate model of each provider first. */
export function speechEngines(providers: readonly ProviderConfig[]): SpeechEngine[] {
  return providers
    .filter((p) => p.hasApiKey)
    .flatMap((p) => speechModels(p).map((model) => ({ providerId: p.id, providerName: p.name, model })));
}

/** The engine voice typing uses: the one you chose while it still exists, else the first that can. */
export function chosenEngine(
  providers: readonly ProviderConfig[],
  voice: VoiceSettings | undefined
): SpeechEngine | null {
  const engines = speechEngines(providers);
  const mine = engines.filter((e) => e.providerId === voice?.providerId);
  return mine.find((e) => e.model.id === voice?.model) ?? mine[0] ?? engines[0] ?? null;
}

/** Languages offered in Settings; Whisper and GPT-4o Transcribe know many more. */
export const SPEECH_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: '', label: 'Detect automatically' },
  { code: 'hi', label: 'Hindi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' }
];

/** The longest hint sent: Whisper reads at most 224 tokens of it. */
export const PROMPT_MAX = 600;
/** The most terms the hint lists, newest first. */
const MAX_TERMS = 40;

/**
 * Words that ASR spells wrong without help: file names, code identifiers (camelCase, PascalCase,
 * snake_case) and acronyms, newest mention first, each once.
 */
export function distinctiveTerms(text: string): string[] {
  const pattern =
    /\b[\w-]+\.(?:tsx?|jsx?|cjs|mjs|json|css|html|md|py|rs|go|java|cs|cpp|yml|yaml|toml|sh|ps1)\b|\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[a-zA-Z]+(?:_[a-zA-Z0-9]+)+\b|\b[A-Z]{2,6}s?\b/g;
  const seen = new Set<string>();
  const found = [...text.matchAll(pattern)].map((m) => m[0]).reverse();
  return found.filter((term) => {
    const key = term.toLowerCase();
    if (term.length < 3 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The hint sent with a recording: the names you are likely to say, the terms in the conversation so
 * far, and the end of what is already in the box (the speech continues it). Bounded to PROMPT_MAX.
 */
export function speechPrompt(input: { names: readonly string[]; recent: string; draft: string }): string {
  const names = [...new Set(input.names.map((n) => n.trim()).filter(Boolean))];
  const terms = distinctiveTerms(input.recent)
    .filter((t) => !names.some((n) => n.toLowerCase() === t.toLowerCase()))
    .slice(0, MAX_TERMS);
  const draft = input.draft.replace(/\s+/g, ' ').trim();
  const tail = draft.length > 200 ? draft.slice(draft.indexOf(' ', draft.length - 200) + 1) : draft;
  let glossary = [...names, ...terms];
  const build = () => [glossary.length ? `Glossary: ${glossary.join(', ')}.` : '', tail].filter(Boolean).join(' ');
  while (glossary.length && build().length > PROMPT_MAX) glossary = glossary.slice(0, -1);
  return build().slice(-PROMPT_MAX);
}

/** Puts dictated text where the cursor was, with a space either side where the words would otherwise run together. */
export function insertDictation(
  box: string,
  spoken: string,
  start: number,
  end = start
): { text: string; caret: number } {
  const words = spoken.trim();
  if (!words) return { text: box, caret: end };
  const before = box.slice(0, start);
  const after = box.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
  const inserted = `${lead}${words}${trail}`;
  return { text: before + inserted + after, caret: before.length + lead.length + words.length };
}
