import { COWORKERS, RECEPTIONIST_ID, coworkerById } from '../../shared/coworkers';
import { scoreCoworkers } from '../../shared/coworkerSearch';
import { ROOMS, pickRoom, roomName, roomNamed, theRoom, type MeetingRoomId } from '../../shared/rooms';
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
      need: {
        type: 'string',
        description: 'The skill or work, e.g. "payment webhooks" or "accessibility review"'
      }
    },
    required: ['need']
  }
};

export const CALL_TEAM_MEETING: ToolDefinition = {
  name: 'call_team_meeting',
  description:
    'Gather a team for work that needs more than one specialty. They meet in a meeting room (a free six-seater, or the boardroom for more than five), each says how they would approach their part, and you then turn that into a plan the user approves before anyone starts; then each does their part from that room and you report back. Pick 2-12 people by name (use find_people first). A question you can answer alone needs no meeting.',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: `What the team is to achieve, with the context they need (under ${GOAL_LIMIT.toLocaleString('en-US')} characters)`
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Their names, e.g. ["Backend Developer", "QA Engineer"]'
      },
      room: {
        type: 'string',
        description: `Only when the user names a room: ${ROOMS.map((r) => r.name).join(', ')}. Otherwise leave it out and a free room that fits is picked.`
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
            profile: {
              type: 'string',
              enum: ['fast', 'standard', 'deep', 'coding'],
              description: 'Optional execution profile, used only if configured by the user'
            },
            title: { type: 'string', description: 'The task in a few words' },
            brief: {
              type: 'string',
              description: 'What to do, in enough detail to start without the meeting'
            },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Ids of tasks that must finish first'
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Project paths this task creates or changes'
            }
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

/** Words a need is phrased with that say nothing about the work. */
const FILLER = new Set(
  'a an the and or for to of with in on at by from me my our we us you your who whom can could would someone some people person team help up do does that this these is are it be our their them get find finding'.split(
    ' '
  )
);
/** A word's stem for matching: "leads" finds Lead, "strategy" Strategist, "following" Follow-up. */
const stem = (word: string) => {
  const singular = word.length > 3 ? word.replace(/s$/, '') : word;
  return singular.length > 7 ? singular.slice(0, 7) : singular;
};
const sameWord = (word: string, wanted: string) =>
  word.startsWith(wanted) || (word.length >= 4 && wanted.startsWith(word));
const wordsIn = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

type Fields = [words: string[], weight: number][];
/** Where a coworker's words are, strongest first: name, department, what they do, their profile. */
const fieldsOf = (c: (typeof COWORKERS)[number]): Fields => [
  [wordsIn(c.name), 6],
  [wordsIn(`${c.department} ${c.role}`), 3],
  [wordsIn(`${c.capabilities.join(' ')} ${c.description}`), 2],
  [wordsIn(c.systemPrompt), 1]
];
/** The strongest place a word is found; 0 when it isn't. */
const weightOf = (fields: Fields, wanted: string) =>
  Math.max(
    0,
    ...fields.map(([words, weight]) => (words.some((word) => sameWord(word, wanted)) ? weight : 0))
  );

/**
 * The coworkers who best fit a need described in words ("finding leads and following up"): each
 * word counts where it is found, most in the name, least in the long profile, and words that fit
 * half the office ("product", "manager") count for little. A name that matches the whole phrase
 * still ranks first.
 */
function rankForNeed(need: string, pool: readonly (typeof COWORKERS)[number][]) {
  const wanted = [
    ...new Set(
      wordsIn(need)
        .filter((w) => !FILLER.has(w))
        .map(stem)
    )
  ];
  const fields = pool.map(fieldsOf);
  const rarity = wanted.map((w) => {
    const holders = fields.filter((f) =>
      f.slice(0, 3).some(([words]) => words.some((word) => sameWord(word, w)))
    ).length;
    return Math.log((pool.length + 1) / (holders + 1));
  });
  const byName = new Map(
    scoreCoworkers(need, pool, (c) => ({ name: c.name, area: '', about: '', prompt: '' })).map((e) => [
      e.item.id,
      e.score
    ])
  );
  return pool.map((item, i) => ({
    item,
    score:
      (byName.get(item.id) ?? 0) + wanted.reduce((sum, w, j) => sum + weightOf(fields[i], w) * rarity[j], 0)
  }));
}

/** The coworkers who best fit a need, one per line; never the lead or the receptionist. */
export function findPeople(need: string, leadId: string, limit = 8): string {
  const pool = COWORKERS.filter((c) => c.id !== leadId && c.id !== RECEPTIONIST_ID);
  const ranked = rankForNeed(need, pool)
    .filter((entry) => entry.score > 1)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .slice(0, limit);
  if (!ranked.length)
    return `Nobody matches "${need}". Try a broader phrase, such as "frontend" or "security".`;
  return ranked
    .map(
      ({ item: c }) =>
        `- ${c.name} (${c.department}): ${c.capabilities.slice(0, 4).join(', ')}. ${c.description}`
    )
    .join('\n');
}

/**
 * Everyone a lead can gather, by department, in a few lines: with it a lead names people at once
 * instead of calling find_people five times, one model step each, before answering.
 */
export function rosterBlock(leadId: string): string {
  const departments = new Map<string, string[]>();
  for (const c of COWORKERS) {
    if (c.id === leadId || c.id === RECEPTIONIST_ID) continue;
    const department = c.core ? 'Core team' : c.department;
    departments.set(department, [...(departments.get(department) ?? []), c.name]);
  }
  return [
    'Who works here, by department. Name people exactly as written here; find_people ranks them for a need when you are unsure.',
    ...[...departments].map(([department, names]) => `- ${department}: ${names.join(', ')}`)
  ].join('\n');
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
  if (ids.length < MIN_ATTENDEES)
    return { error: `A team meeting needs at least ${MIN_ATTENDEES} people besides you.` };
  if (ids.length > MAX_ATTENDEES)
    return { error: `At most ${MAX_ATTENDEES} people fit the boardroom; pick the ones the goal needs most.` };
  return { ids };
}

/**
 * The room a team of `people` (the lead included) gets: the one the lead named when it fits and is
 * free, with a word for the lead when it was not. `busy` holds the rooms of the other open teams.
 */
export function resolveRoom(
  asked: unknown,
  people: number,
  busy: readonly MeetingRoomId[]
): { room: MeetingRoomId; note?: string } {
  const text = typeof asked === 'string' ? asked.trim() : '';
  const wanted = text ? roomNamed(text) : null;
  const room = pickRoom(people, busy, wanted);
  if (!text || room === wanted) return { room };
  const seats = ROOMS.find((r) => r.id === wanted)?.seats ?? 0;
  const why = !wanted
    ? `There is no room called "${text}" (the rooms are ${ROOMS.map((r) => r.name).join(', ')})`
    : people > seats
      ? `${roomName(wanted)} seats ${seats}, too few for ${people}`
      : `${roomName(wanted)} has another team in it`;
  return { room, note: `${why}, so they meet in ${theRoom(room)}.` };
}
