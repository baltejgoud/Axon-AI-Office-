import { rankCoworkers } from '../../../../../shared/coworkerSearch';
import { districtById } from '../campus/districts';
import type { OfficeAgent } from '../data/officeAgents';

/**
 * Coworkers matching a name or a specialty, best first. "front-end", "frontend" and "front end" are
 * the same query; common short forms (SRE, BA, PM, QA…) are understood.
 */
export function searchCoworkers(query: string, agents: readonly OfficeAgent[], limit = 8): OfficeAgent[] {
  return rankCoworkers(
    query,
    agents,
    (agent) => ({
      name: agent.name,
      area: `${agent.department} ${agent.role} ${districtById(agent.district).name}`,
      about: `${agent.capabilities.join(' ')} ${agent.description}`,
      prompt: agent.systemPrompt
    }),
    limit
  );
}
