import { COWORKERS, RECEPTIONIST_ID, coworkerById } from '../../shared/coworkers';
import { scoreCoworkers } from '../../shared/coworkerSearch';
import type { ToolDefinition } from '../../shared/types';
import { resolveColleague } from '../colleagues';

/** Who may gather a team. */
export const TEAM_LEADS: ReadonlySet<string> = new Set(['chief-of-staff', 'ops-coordinator']);
export const MIN_ATTENDEES = 2;
/** The boardroom's seats, besides the lead's. */
export const MAX_ATTENDEES = 12;
/** A goal's length: it goes to every attendee, so it carries the context, but a plan's briefs carry the detail. */
export const GOAL_LIMIT = 12000;

export const FIND_PEOPLE: ToolDefinition = {
  name: 'find_people',
  description:
    'Find the coworkers best suited to a need, ranked, with what each is good at. Use it before calling a team meeting, to pick the right people.',
  parameters: {
    type: 'object',
    properties: {
      need: { type: 'string', description: 'The skill or work, e.g. "payment webhooks" or "accessibility review"' }
    },
    required: ['need']
  }
};

export const CALL_TEAM_MEETING: ToolDefinition = {
  name: 'call_team_meeting',
  description:
    'Gather a team for work that needs more than one specialty. They meet in the boardroom, each says how they would approach their part, and you then turn that into a plan the user approves before anyone starts; then each does their part and you report back. Pick 2-12 people by name (use find_people first). A question you can answer alone needs no meeting.',
  parameters: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: `What the team is to achieve, with the context they need (under ${GOAL_LIMIT.toLocaleString('en-US')} characters)` },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Their names, e.g. ["Backend Developer", "QA Engineer"]'
      }
    },
    required: ['goal', 'attendees']
  }
};

/** Offered only to the lead drafting the plan after the meeting; never in a conversation. */
export const PROPOSE_PLAN: ToolDefinition = {
  name: 'propose_plan',
  description: "Propose the team's plan: who does what, in what order, and which files each task owns.",
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'The approach in two or three sentences' },
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 't1, t2, …' },
            owner: { type: 'string', description: 'An attendee, by name' },
            title: { type: 'string', description: 'The task in a few words' },
            brief: { type: 'string', description: 'What to do, in enough detail to start without the meeting' },
            depends_on: { type: 'array', items: { type: 'string' }, description: 'Ids of tasks that must finish first' },
            files: { type: 'array', items: { type: 'string' }, description: 'Project paths this task creates or changes' }
          },
          required: ['id', 'owner', 'title', 'brief']
        }
      }
    },
    required: ['summary', 'assignments']
  }
};

/** A lead's tools in a conversation. */
export const TEAM_TOOLS: ToolDefinition[] = [FIND_PEOPLE, CALL_TEAM_MEETING];
export const TEAM_TOOL_NAMES: ReadonlySet<string> = new Set(TEAM_TOOLS.map((tool) => tool.name));

/** The coworkers who best fit a need, one per line; never the lead or the receptionist. */
export function findPeople(need: string, leadId: string, limit = 8): string {
  const pool = COWORKERS.filter((c) => c.id !== leadId && c.id !== RECEPTIONIST_ID);
  const ranked = scoreCoworkers(need, pool, (c) => ({
    name: c.name,
    area: `${c.department} ${c.role}`,
    about: `${c.capabilities.join(' ')} ${c.description}`,
    prompt: c.systemPrompt
  }))
    .filter((entry) => entry.score > 0)
    .slice(0, limit);
  if (!ranked.length) return `Nobody matches "${need}". Try a broader phrase, such as "frontend" or "security".`;
  return ranked
    .map(({ item: c }) => `- ${c.name} (${c.department}): ${c.capabilities.slice(0, 4).join(', ')}. ${c.description}`)
    .join('\n');
}

/** The attendees a lead named, as coworker ids: the lead and repeats left out; any vague name refuses the lot. */
export function resolveAttendees(names: unknown, leadId: string): { ids: string[] } | { error: string } {
  if (!Array.isArray(names))
    return { error: 'attendees must be a list of names, e.g. ["Backend Developer", "QA Engineer"].' };
  const lead = coworkerById(leadId);
  const ids: string[] = [];
  const problems: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name || name === leadId || name.toLowerCase() === lead?.name.toLowerCase()) continue;
    const found = resolveColleague(name, leadId);
    if ('error' in found) problems.push(found.error);
    else if (!ids.includes(found.coworker.id)) ids.push(found.coworker.id);
  }
  if (problems.length) return { error: `${problems.join(' ')} Use find_people, then name them exactly.` };
  if (ids.length < MIN_ATTENDEES) return { error: `A team meeting needs at least ${MIN_ATTENDEES} people besides you.` };
  if (ids.length > MAX_ATTENDEES)
    return { error: `At most ${MAX_ATTENDEES} people fit the boardroom; pick the ones the goal needs most.` };
  return { ids };
}
