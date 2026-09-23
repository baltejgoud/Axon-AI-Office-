import roles from '../../../../../roles/roles.json';

// Use the actual bundled role catalog, so the office and Skills & roles cannot drift.
export const SPECIALIST_ROLES = [
  ...roles,
  {
    id: 'business-analyst',
    name: 'Business Analyst',
    group: 'Strategy & Innovation',
    profile:
      'Owns: business requirements, process mapping, stakeholder interviews, user stories and acceptance criteria.\nOptimises for: measurable outcomes and requirements that engineers can implement and test.\nPushes back on: ambiguous scope and solutions without a validated business problem.\nCommunicates: in process maps, requirements, decision logs and clear recommendations.'
  }
];

export const SPECIALIST_GROUPS = [...new Set(SPECIALIST_ROLES.map((role) => role.group))];
export const HQ_SPECIALISTS = [
  'frontend-developer',
  'backend-developer',
  'business-analyst',
  'business-development-manager',
  'devops-engineer',
  'qa-engineer',
  'ui-ux-designer',
  'data-engineer'
];
export const GROUP_COLORS = ['#3867f6', '#0c8b83', '#9564c5', '#ca7636', '#bf527e', '#4d7b55'];

export function specialistColor(group: string): string {
  return GROUP_COLORS[SPECIALIST_GROUPS.indexOf(group) % GROUP_COLORS.length] ?? GROUP_COLORS[0];
}
