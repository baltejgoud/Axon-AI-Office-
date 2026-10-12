import { coworkerById } from './coworkers';
export function checkedPreferences(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid coworker preferences.');
  const result: Record<string, string> = {};
  for (const [id, text] of Object.entries(value)) {
    if (!coworkerById(id) || typeof text !== 'string' || text.length > 4000) throw new Error('Preferences must name a coworker and use up to 4,000 characters.');
    if (text.trim()) result[id] = text.trim();
  }
  return result;
}
export function preferenceBlock(text: string | undefined): string {
  return text ? `User-saved preferences for this coworker (the current request takes priority):\n${JSON.stringify(text)}` : '';
}
