/** Offers in the closing prose only; no model calls, code, lists or invented next actions. */
export function followUps(reply: string): string[] {
  const prose = reply
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, '')
    .split('\n')
    .filter((line) => !/^\s*(?:[-*+>]\s|\d+[.)]\s|#{1,6}\s|\|)/.test(line))
    .join('\n')
    .slice(-1200);
  const result: string[] = [],
    seen = new Set<string>();
  for (const match of prose.matchAll(/(?:Would you like me to|Should I|I can also)\s+([^.!?\n]+)[.!?]?/gi)) {
    const action = match[1].trim().replace(/\s+/g, ' ');
    if (!action || action.length > 55 || /[`<>]|https?:\/\//i.test(action)) continue;
    const text = /^I can also/i.test(match[0])
      ? action[0].toUpperCase() + action.slice(1)
      : `Yes, ${action[0].toLowerCase()}${action.slice(1)}`;
    if (text.length > 60 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    result.push(text);
    if (result.length === 3) break;
  }
  return result;
}
