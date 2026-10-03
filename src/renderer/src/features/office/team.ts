import type { AssignmentStatus, TaskItem, TaskStatus, Team, TeamStatus, ToolCall } from '../../../../shared/types';

/** A team's status in words, for its card. */
export const TEAM_WORDS: Record<TeamStatus, string> = {
  meeting: 'In the meeting',
  planned: 'Plan ready for you',
  working: 'Working',
  reporting: 'Writing the report',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Needs a look',
  discarded: 'Discarded'
};

/** A task's status in words. */
export const TASK_WORDS: Record<AssignmentStatus, string> = {
  waiting: 'Waiting',
  working: 'Working',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  blocked: 'Blocked'
};

/** A team that is still going. */
const OPEN: ReadonlySet<TeamStatus> = new Set(['meeting', 'planned', 'working', 'reporting']);

/** The team a call_team_meeting call started: its id is in the call's result. */
export function teamOfCall(call: Pick<ToolCall, 'result'>, teams: readonly Team[]): Team | undefined {
  try {
    const id = JSON.parse(call.result ?? '')?.team;
    return teams.find((t) => t.id === id);
  } catch {
    return undefined;
  }
}

/** Teams whose people should be in the boardroom: meeting, or gathered for the wrap-up. */
export function openMeetings(teams: readonly Team[]): { id: string; leadId: string; attendees: string[] }[] {
  return teams
    .filter((t) => t.status === 'meeting' || t.status === 'reporting')
    .map(({ id, leadId, attendees }) => ({ id, leadId, attendees }));
}

const TASK_TO_CARD: Record<AssignmentStatus, TaskStatus> = {
  waiting: 'open',
  working: 'working',
  done: 'done',
  failed: 'attention',
  stopped: 'attention',
  blocked: 'attention'
};

/**
 * The boardroom board's cards: the newest open team's goal (under its lead) while it meets, then
 * each task under its owner. The board shows who from the card's coworker.
 */
export function teamBoardCards(teams: readonly Team[]): TaskItem[] {
  const open = teams.filter((t) => OPEN.has(t.status)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!open) return [];
  const card = (id: string, title: string, coworkerId: string, status: TaskStatus): TaskItem => ({
    id: `${open.id}-${id}`,
    kind: 'work',
    title,
    coworkerId,
    status,
    createdAt: open.createdAt ?? 0,
    updatedAt: open.updatedAt
  });
  if (!open.plan) return [card('goal', open.goal, open.leadId, open.status === 'meeting' ? 'working' : 'open')];
  return open.plan.assignments.map((a) => card(a.id, a.title, a.ownerId, TASK_TO_CARD[a.status]));
}
