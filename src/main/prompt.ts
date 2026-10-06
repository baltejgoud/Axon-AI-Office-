import type { Role } from '../shared/types';

export function dedupe(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

export function rolesBlock(roles: Role[]): string {
  if (!roles.length) return '';
  return [
    '<roles>',
    `You are working as: ${roles.map((r) => r.name).join(', ')}.`,
    'Apply every role below. Where they disagree, say so and give each perspective rather than silently picking one.',
    ...roles.map((r) => `## ${r.name}\n${r.profile}`),
    '</roles>'
  ].join('\n\n').replace('<roles>\n\n', '<roles>\n');
}

export function skillsBlock(skills: { name: string; source: string; body: string }[]): string {
  if (!skills.length) return '';
  const block = [
    '<skills>',
    'The user selected these skills. Follow their instructions. Scripts, tool servers, and files they reference are not available here — do the equivalent manually or say what you can\'t do.',
    ...skills.map((s) => `## Skill: ${s.name} (${s.source})\n${s.body}`),
    '</skills>'
  ].join('\n\n');
  return block;
}

/**
 * How every office coworker answers. Free models wrote essays to yes-or-no questions and searched
 * the code to answer questions about people; these keep simple things quick.
 */
export const HOUSE_RULES = `How you work with the user:
- Fit the length to the question. A simple question gets a direct answer in one to three sentences: no preamble, no headings, no restating the question. Write more only when the user asks for detail, a document or a plan.
- Use a tool only when the answer needs it, and stop as soon as you can answer. Never run the same lookup twice. Don't search or read files to answer questions about people, the office or general knowledge.
- When the user asks you to do something, do it with your tools now instead of explaining how it could be done or asking whether they want it; then say in a line what you did.`;
