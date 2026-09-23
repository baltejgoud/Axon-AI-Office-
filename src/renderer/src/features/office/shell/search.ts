import { districtById } from '../campus/districts';
import type { OfficeAgent } from '../data/officeAgents';

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

function score(agent: OfficeAgent, query: string): number {
  const q = normal(query);
  if (!q) return 0;
  const name = normal(agent.name);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  const nameWords = wordsOf(agent.name);
  if (nameWords.some((word) => word.startsWith(q))) return 60;
  const queryWords = wordsOf(query);
  if (queryWords.length > 1 && queryWords.every((w) => nameWords.some((word) => word.startsWith(w))))
    return 58;
  if (name.includes(q)) return 55;
  const area = normal(`${agent.department} ${agent.role} ${districtById(agent.district).name}`);
  if (area.includes(q)) return 40;
  if (normal(`${agent.capabilities.join(' ')} ${agent.description}`).includes(q)) return 20;
  if (normal(agent.systemPrompt).includes(q)) return 10;
  return 0;
}

/**
 * Coworkers matching a name or a specialty, best first. "front-end", "frontend" and "front end" are
 * the same query; common short forms (SRE, BA, PM, QA…) are understood.
 */
export function searchCoworkers(query: string, agents: readonly OfficeAgent[], limit = 8): OfficeAgent[] {
  const trimmed = query.trim();
  if (!normal(trimmed)) return [];
  const expanded = SYNONYMS[normal(trimmed)];
  return agents
    .map((agent) => ({
      agent,
      score: Math.max(score(agent, trimmed), expanded ? score(agent, expanded) - 1 : 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.agent.name.length - b.agent.name.length)
    .slice(0, limit)
    .map((entry) => entry.agent);
}
