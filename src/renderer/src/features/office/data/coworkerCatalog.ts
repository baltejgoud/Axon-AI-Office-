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
