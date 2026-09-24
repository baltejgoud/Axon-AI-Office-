import { RECEPTIONIST_ID, coworkerById } from '../../../../shared/coworkers';
import {
  addDays,
  dayKey,
  dueLabel,
  momentLabel,
  nextUp,
  parseLocal,
  shortDate
} from '../../../../shared/planner';
import type { TaskItem, ToolCall } from '../../../../shared/types';
import type { AgentStatus } from './data/officeAgents';

/**
 * The office's view of the task records: whose board a task goes on, what each board shows, how
 * people look while they work, and which colleagues are over helping someone. Pure, so it can be
 * tested without a scene.
 */

/** A board's team: a department, or one of the core team's rooms. */
export type Team = string;

const CORE_TEAMS: Readonly<Record<string, Team>> = {
  'research-analyst': 'Library',
  writer: 'Library',
  'knowledge-librarian': 'Library',
  'product-coach': 'Planning',
  designer: 'Planning',
  'ops-coordinator': 'Planning',
  'marketing-strategist': 'Lounge',
  'files-agent': 'Files room'
};
const APPROVAL = 'Waiting for your approval';

export function teamOf(coworkerId: string | undefined): Team | null {
  if (!coworkerId || coworkerId === RECEPTIONIST_ID) return null;
  if (CORE_TEAMS[coworkerId]) return CORE_TEAMS[coworkerId];
  const coworker = coworkerById(coworkerId);
  return coworker && !coworker.core ? coworker.department : null;
}

const onTeam = (tasks: readonly TaskItem[], team: Team) =>
  tasks.filter((task) => (task.kind === 'work' || task.kind === 'help') && teamOf(task.coworkerId) === team);
const newest = (a: TaskItem, b: TaskItem) => b.updatedAt - a.updatedAt;

/** What a board shows: the most recent work and help, anything needing attention first. */
export function boardCards(tasks: readonly TaskItem[], team: Team, limit = 4): TaskItem[] {
  const mine = onTeam(tasks, team).sort(newest);
  return [
    ...mine.filter((task) => task.status === 'attention'),
    ...mine.filter((task) => task.status !== 'attention')
  ].slice(0, limit);
}

/** A team's whole list, newest first in each group. */
export function teamList(
  tasks: readonly TaskItem[],
  team: Team
): { attention: TaskItem[]; working: TaskItem[]; done: TaskItem[] } {
  const mine = onTeam(tasks, team).sort(newest);
  return {
    attention: mine.filter((task) => task.status === 'attention'),
    working: mine.filter((task) => task.status === 'working'),
    done: mine.filter((task) => task.status === 'done')
  };
}

/** How each coworker with a task looks: from their newest work record. */
export function statusesFromTasks(tasks: readonly TaskItem[]): Record<string, AgentStatus> {
  const latest = new Map<string, TaskItem>();
  for (const task of tasks) {
    if (task.kind !== 'work' || !task.coworkerId) continue;
    const seen = latest.get(task.coworkerId);
    if (!seen || task.updatedAt > seen.updatedAt) latest.set(task.coworkerId, task);
  }
  const statuses: Record<string, AgentStatus> = {};
  for (const [id, task] of latest)
    statuses[id] =
      task.status === 'working'
        ? 'working'
        : task.status === 'attention'
          ? task.note === APPROVAL
            ? 'waiting'
            : 'error'
          : 'completed';
  return statuses;
}

/**
 * Colleagues who should be at someone's desk: while their answer is being written, and for the rest
 * of the run that asked.
 */
export function activeHelp(tasks: readonly TaskItem[]): { helper: string; host: string }[] {
  const pairs = new Map<string, { helper: string; host: string }>();
  for (const help of tasks) {
    if (help.kind !== 'help' || !help.coworkerId || !help.forCoworkerId) continue;
    const work = tasks.find((task) => task.kind === 'work' && task.conversationId === help.conversationId);
    const runGoing =
      !!work &&
      (work.status === 'working' || work.status === 'attention') &&
      (work.runStartedAt ?? 0) <= help.createdAt;
    if (help.status === 'working' || runGoing)
      pairs.set(`${help.coworkerId}>${help.forCoworkerId}`, {
        helper: help.coworkerId,
        host: help.forCoworkerId
      });
  }
  return [...pairs.values()];
}

export interface ColleagueCall {
  /** The name asked for, or the colleague's id once they answered. */
  colleague: string;
  question: string;
  name?: string;
  answer?: string;
  error?: string;
  pending: boolean;
}

/** An `ask_colleague` tool call, read for its card. */
export function parseColleagueCall(call: ToolCall): ColleagueCall {
  let args: { colleague?: unknown; question?: unknown } = {};
  try {
    args = JSON.parse(call.arguments);
  } catch {
    // Arguments still streaming in, or mangled: show what we can.
  }
  const asked = { colleague: String(args.colleague ?? ''), question: String(args.question ?? '') };
  if (call.error) return { ...asked, error: call.error, pending: false };
  if (!call.result) return { ...asked, pending: true };
  try {
    const reply = JSON.parse(call.result) as { colleague?: string; name?: string; answer?: string };
    return {
      ...asked,
      colleague: reply.colleague ?? asked.colleague,
      name: reply.name,
      answer: reply.answer ?? '',
      pending: false
    };
  } catch {
    return { ...asked, answer: call.result, pending: false };
  }
}

/** One line on the Today board: when, and what. */
export interface TodayLine {
  label: string;
  title: string;
  overdue: boolean;
}

/** What the Today board behind the front desk lists: the next few dated to-dos. */
export function todayLines(tasks: readonly TaskItem[], now: Date): TodayLine[] {
  const today = dayKey(now);
  return nextUp(tasks).map((task) => {
    const due = parseLocal(task.due ?? '')!;
    const overdue = due.date < today;
    const label = overdue
      ? 'Overdue'
      : due.date === today
        ? (due.time ?? 'Today')
        : due.date === addDays(today, 1)
          ? 'Tomorrow'
          : due.date <= addDays(today, 6)
            ? shortDate(due.date, now).split(' ')[0]
            : shortDate(due.date, now).split(' ').slice(1).join(' ');
    return { label, title: task.title, overdue };
  });
}

export interface PlannerCall {
  /** 'Added', 'Updated', 'Done', 'Checked the plan'. */
  verb: string;
  title: string;
  /** 'due Tomorrow 10:00 · reminder Tomorrow 09:30' */
  detail: string;
  error?: string;
  pending: boolean;
}

const PLANNER_VERBS: Record<string, [done: string, pending: string, failed: string]> = {
  add_task: ['Added', 'Adding…', 'Couldn’t add'],
  update_task: ['Updated', 'Updating…', 'Couldn’t update'],
  complete_task: ['Done', 'Marking done…', 'Couldn’t mark done'],
  list_tasks: ['Checked the plan', 'Checking the plan…', 'Couldn’t check the plan']
};

export const isPlannerCall = (call: ToolCall): boolean => call.name in PLANNER_VERBS;

/** One of the receptionist's planner tool calls, read for its card. Dates are labelled as of `now`. */
export function parsePlannerCall(call: ToolCall, now: Date): PlannerCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments);
  } catch {
    // Still streaming in.
  }
  const [done, working, failed] = PLANNER_VERBS[call.name] ?? ['Planner', 'Working…', 'Planner'];
  const quoted = /"(.+?)"/.exec(call.result ?? '')?.[1];
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : (quoted ?? '');
  const parts: string[] = [];
  if (call.name === 'add_task' || call.name === 'update_task') {
    if (typeof args.due === 'string')
      parts.push(
        args.due && parseLocal(args.due)
          ? `due ${dueLabel({ id: '', kind: 'todo', title, status: 'open', due: args.due, createdAt: 0, updatedAt: 0 }, now)}`
          : 'no due date'
      );
    if (typeof args.remind_at === 'string' || args.remind_at === null) {
      const at = typeof args.remind_at === 'string' ? parseLocal(args.remind_at)?.at : undefined;
      parts.push(at ? `reminder ${momentLabel(at, now)}` : 'no reminder');
    }
  }
  if (call.error) return { verb: failed, title, detail: '', error: call.error, pending: false };
  return {
    verb: call.result === undefined ? working : done,
    title,
    detail: parts.join(' · '),
    pending: call.result === undefined
  };
}
