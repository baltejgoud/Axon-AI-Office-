/** A suggestion in an empty chat: what the chip says, and what it puts in the message box. */
export interface Starter {
  label: string;
  prompt: string;
}

/** The most suggestions shown, and the longest a chip's text can be before it is left out. */
const MAX_STARTERS = 3;
const MAX_LABEL = 36;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "Daily planning" → "daily planning"; an acronym ("GTM strategy", "UX") keeps its capitals. */
const inSentence = (text: string) =>
  /^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);

/**
 * What a specialist owns reads "the area — a, b, c, and d." Everything after the dash is a list;
 * the last item may itself be two ("a and b").
 */
function itemsOf(description: string): string[] {
  const list = description.includes(' — ') ? description.slice(description.indexOf(' — ') + 3) : description;
  const parts = list
    .replace(/\.\s*$/, '')
    .split(',')
    .map((part) => part.trim().replace(/^and\s+/, ''))
    .filter(Boolean);
  const last = parts.pop();
  if (last) parts.push(...last.split(/\s+and\s+/, 2).map((part) => part.trim()));
  return parts;
}

/** For a coworker whose description has too few short items to suggest from. */
const GENERAL: Starter = { label: 'What can you help me with?', prompt: 'What can you help me with?' };

/**
 * Things to ask this coworker, from what they actually do: the core team's own capabilities, a
 * specialist's list of what they own. Items too long for a chip are skipped, never cut off; a
 * coworker with fewer than two of their own is offered the general question as well.
 */
export function starters(person: { description: string; capabilities: string[]; core?: boolean }): Starter[] {
  const items = person.core ? person.capabilities : itemsOf(person.description);
  const seen = new Set<string>();
  const result: Starter[] = [];
  for (const item of items) {
    const label = capitalise(item.trim());
    if (label.length < 3 || label.length > MAX_LABEL || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    result.push({ label, prompt: `Help me with ${inSentence(label)}` });
    if (result.length === MAX_STARTERS) break;
  }
  return result.length < 2 ? [...result, GENERAL] : result;
}
