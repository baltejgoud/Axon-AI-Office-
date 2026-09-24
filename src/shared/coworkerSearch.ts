/** The text a coworker is found by, strongest match first. */
export interface SearchFields {
  name: string;
  /** Department, role and district: what they work in. */
  area: string;
  /** Capabilities and description: what they do. */
  about: string;
  prompt: string;
}

const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Short forms people type, expanded to what the catalog says. */
const SYNONYMS: Readonly<Record<string, string>> = {
  sre: 'site reliability',
  ba: 'business analyst',
  pm: 'product manager',
  fe: 'frontend',
  be: 'backend',
  ml: 'machine learning',
  hr: 'human resources',
  ceo: 'chief executive',
  cto: 'chief technology',
  cfo: 'chief financial',
  coo: 'chief operating',
  cmo: 'chief marketing',
  qa: 'qa engineer',
  ux: 'ui/ux designer',
  ui: 'ui developer',
  dba: 'database administrator',
  devrel: 'developer advocate'
};

function score(fields: SearchFields, query: string): number {
  const q = normal(query);
  if (!q) return 0;
  const name = normal(fields.name);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  const nameWords = wordsOf(fields.name);
  if (nameWords.some((word) => word.startsWith(q))) return 60;
  const queryWords = wordsOf(query);
  if (queryWords.length > 1 && queryWords.every((w) => nameWords.some((word) => word.startsWith(w))))
    return 58;
  if (name.includes(q)) return 55;
  if (normal(fields.area).includes(q)) return 40;
  if (normal(fields.about).includes(q)) return 20;
  if (normal(fields.prompt).includes(q)) return 10;
  return 0;
}

/**
 * Every item matching a name or a specialty, with its score, best first. "front-end", "frontend"
 * and "front end" are the same query; common short forms (SRE, BA, PM, QA…) are understood.
 */
export function scoreCoworkers<T>(
  query: string,
  items: readonly T[],
  fields: (item: T) => SearchFields
): { item: T; score: number }[] {
  const trimmed = query.trim();
  if (!normal(trimmed)) return [];
  const expanded = SYNONYMS[normal(trimmed)];
  return items
    .map((item) => {
      const f = fields(item);
      return {
        item,
        name: f.name,
        score: Math.max(score(f, trimmed), expanded ? score(f, expanded) - 1 : 0)
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .map(({ item, score: value }) => ({ item, score: value }));
}

/** The best matches for a name or a specialty. */
export function rankCoworkers<T>(
  query: string,
  items: readonly T[],
  fields: (item: T) => SearchFields,
  limit = 8
): T[] {
  return scoreCoworkers(query, items, fields)
    .slice(0, limit)
    .map((entry) => entry.item);
}
