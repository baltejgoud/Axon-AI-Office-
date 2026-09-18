import type { Role } from '../shared/types';

export const SKILL_BUDGET = 80_000;

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
  if (block.length > SKILL_BUDGET)
    throw new Error(`Selected skills exceed the budget (${block.length.toLocaleString('en-US')} of 80,000 characters). Remove a skill.`);
  return block;
}
