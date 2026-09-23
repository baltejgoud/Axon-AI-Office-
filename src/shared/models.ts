/** Longest short name a model chip shows. */
const MAX_LENGTH = 16;
/** Words that say who made a model or how it is served, not which model it is. */
const NOISE = new Set([
  'claude',
  'anthropic',
  'openai',
  'google',
  'models',
  'latest',
  'preview',
  'exp',
  'experimental',
  'instruct',
  'chat'
]);

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function styled(token: string): string {
  if (token === 'mini' || token === 'nano') return token;
  if (token === 'deepseek') return 'DeepSeek';
  if (/^o\d/.test(token) || /^\d/.test(token)) return token;
  return capitalise(token);
}

/**
 * A short name for a model chip: "Sonnet 4.5", "GPT-4o mini", "Gemini 2.5 Pro". A display name
 * that is already short is used as it is; otherwise the vendor, dates and serving words are
 * dropped, version digits are joined and the result is cut at 16 characters.
 */
export function shortModelName(id: string, displayName?: string): string {
  const name = displayName?.trim();
  if (name && name.length <= MAX_LENGTH) return name;
  const source = (name || id).toLowerCase();
  const base = source.slice(source.lastIndexOf('/') + 1).replace(/[()]/g, ' ');
  const tokens = base.split(/[-_\s:]+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\d{8}$/.test(token)) continue;
    // A year and the month and day after it: 2024-08-06.
    if (/^20\d{2}$/.test(token)) {
      while (/^\d{2}$/.test(tokens[i + 1] ?? '')) i++;
      continue;
    }
    // A bare month-day: preview-05-20.
    if (/^\d{2}$/.test(token) && (/^\d{2}$/.test(tokens[i + 1] ?? '') || /^\d{2}$/.test(tokens[i - 1] ?? '')))
      continue;
    if (NOISE.has(token)) continue;
    // Version digits split by dashes join back up: 4-5 is 4.5.
    const previous = kept[kept.length - 1];
    if (/^\d$/.test(token) && previous && /^\d(\.\d)*$/.test(previous)) kept[kept.length - 1] = `${previous}.${token}`;
    else kept.push(token);
  }
  const words: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    if (kept[i] === 'gpt' && kept[i + 1]) words.push(`GPT-${kept[++i]}`);
    else words.push(styled(kept[i]));
  }
  const short = words.join(' ') || id;
  return short.length > MAX_LENGTH ? `${short.slice(0, MAX_LENGTH - 1)}…` : short;
}
