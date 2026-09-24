import { coworkerById } from '../../shared/coworkers';
import {
  dueLabel,
  groupPlanner,
  isOverdue,
  momentLabel,
  parseLocal,
  type LocalTime
} from '../../shared/planner';
import type { TaskItem, ToolDefinition } from '../../shared/types';
import type { TaskStore } from './store';

/**
 * The receptionist's planner tools. She records to-dos, reminders and dates through these rather
 * than in her replies, so the planner, the Today board and the reminders all see the same list.
 * Every problem comes back as a sentence she can act on.
 */

const DATE_HELP = 'Use "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" with a time.';
export const PAST_REMINDER = 'That time has passed; ask the user.';
const TITLE_MAX = 120;
const NOTES_MAX = 2000;

const dateField = (what: string) => ({
  type: 'string',
  description: `${what}: local "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" with a time`
});

export const PLANNER_TOOLS: ToolDefinition[] = [
  {
    name: 'add_task',
    description:
      "Add a to-do to the user's planner, with a due date and a reminder if they gave one. " +
      'A reminder is a Windows notification; one with no time is at 09:00, and it must be in the future.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, e.g. "Prep the investor deck"' },
        due: dateField('When it is due'),
        remind_at: dateField('When to remind the user'),
        notes: { type: 'string', description: 'Details worth keeping' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_tasks',
    description:
      "The planner: the user's to-dos and what coworkers are working on, with ids. " +
      'Call it before answering anything about the plan.',
    parameters: {
      type: 'object',
      properties: {
        range: {
          type: 'string',
          enum: ['today', 'week', 'later', 'overdue', 'done', 'all'],
          description: 'Which part; everything still open when left out'
        }
      }
    }
  },
  {
    name: 'update_task',
    description:
      'Change a to-do by id: its title, due date, reminder or notes. Pass an empty string to clear a date, reminder or notes.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        due: dateField('New due date'),
        remind_at: dateField('New reminder'),
        notes: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a to-do as done, by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
];

export const PLANNER_TOOL_NAMES: ReadonlySet<string> = new Set(PLANNER_TOOLS.map((tool) => tool.name));

type Editable = Partial<Pick<TaskItem, 'title' | 'due' | 'remindAt' | 'notes'>>;

const clears = (value: unknown) => value === null || value === '';
const normal = (time: LocalTime) => (time.time ? `${time.date}T${time.time}` : time.date);

/**
 * Checks what the receptionist (or the planner) wants to write. Reminders arrive as a local date
 * string from her tools and as epoch ms from the planner. With `partial`, only the fields given are
 * checked, and null or an empty string clears one (the value comes back as undefined).
 */
export function validateTaskInput(
  input: { title?: unknown; due?: unknown; remindAt?: unknown; notes?: unknown },
  now: Date,
  partial: boolean
): { ok: true; value: Editable } | { ok: false; error: string } {
  const value: Editable = {};
  if (!partial || input.title !== undefined) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > TITLE_MAX)
      return { ok: false, error: `Give the to-do a title of up to ${TITLE_MAX} characters.` };
    value.title = title;
  }
  if (input.due !== undefined) {
    if (clears(input.due)) {
      if (partial) value.due = undefined;
    } else {
      const due = typeof input.due === 'string' ? parseLocal(input.due) : null;
      if (!due)
        return { ok: false, error: `Couldn't read the due date ${JSON.stringify(input.due)}. ${DATE_HELP}` };
      value.due = normal(due);
    }
  }
  if (input.remindAt !== undefined) {
    if (clears(input.remindAt)) {
      if (partial) value.remindAt = undefined;
    } else {
      const at =
        typeof input.remindAt === 'number'
          ? Number.isFinite(input.remindAt)
            ? input.remindAt
            : null
          : typeof input.remindAt === 'string'
            ? (parseLocal(input.remindAt)?.at ?? null)
            : null;
      if (at === null)
        return {
          ok: false,
          error: `Couldn't read the reminder ${JSON.stringify(input.remindAt)}. ${DATE_HELP}`
        };
      if (at <= now.getTime()) return { ok: false, error: PAST_REMINDER };
      value.remindAt = at;
    }
  }
  if (input.notes !== undefined) {
    if (clears(input.notes)) {
      if (partial) value.notes = undefined;
    } else {
      if (typeof input.notes !== 'string' || input.notes.length > NOTES_MAX)
        return { ok: false, error: `Notes can be up to ${NOTES_MAX} characters.` };
      value.notes = input.notes.trim();
    }
  }
  return { ok: true, value };
}

/** A new reminder time fires again, even if an earlier one already did. */
export function withReminderReset(value: Editable): Partial<TaskItem> {
  return 'remindAt' in value ? { ...value, remindedAt: undefined } : value;
}

/** ' — due Tomorrow 10:00, reminder Tomorrow 10:00' */
function when(task: TaskItem, now: Date): string {
  const parts = [
    task.due ? `due ${dueLabel(task, now)}` : '',
    task.remindAt && !task.remindedAt ? `reminder ${momentLabel(task.remindAt, now)}` : ''
  ].filter(Boolean);
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

const STATUS_WORDS: Record<TaskItem['status'], string> = {
  open: 'to do',
  working: 'working',
  attention: 'needs attention',
  done: 'done'
};

function line(task: TaskItem, now: Date): string {
  const parts = [`- [${task.id}] ${task.title}`];
  if (task.due) parts.push(dueLabel(task, now));
  if (task.remindAt && !task.remindedAt && task.status !== 'done')
    parts.push(`reminder ${momentLabel(task.remindAt, now)}`);
  parts.push(STATUS_WORDS[task.status] + (task.note && task.status === 'attention' ? ` (${task.note})` : ''));
  if (task.kind === 'work') parts.push(coworkerById(task.coworkerId)?.name ?? 'a coworker');
  return parts.join(' · ');
}

function listing(store: TaskStore, range: unknown, now: Date): string {
  const groups = groupPlanner(store.list(), now);
  const parts: Record<string, [title: string, tasks: TaskItem[]]> = {
    today: ['Today', groups.today],
    week: ['This week', groups.week],
    later: ['Later', groups.later],
    overdue: ['Overdue', groups.today.filter((task) => isOverdue(task, now))],
    done: ['Done', groups.done]
  };
  const open = [parts.today, parts.week, parts.later];
  const sections =
    range === 'all'
      ? [...open, parts.done]
      : typeof range === 'string' && parts[range]
        ? [parts[range]]
        : open;
  const filled = sections.filter(([, tasks]) => tasks.length);
  if (!filled.length) return 'Nothing on the list.';
  return filled
    .map(([title, tasks]) => `${title}:\n${tasks.map((task) => line(task, now)).join('\n')}`)
    .join('\n\n');
}

/** The to-do an id names, or the sentence explaining why there isn't one. */
function todo(store: TaskStore, id: unknown): TaskItem | string {
  const task = typeof id === 'string' ? store.find((item) => item.id === id) : undefined;
  if (!task) return `No task with id ${String(id)}; call list_tasks.`;
  if (task.kind !== 'todo') return "That is a coworker's task; only the user's to-dos can be changed.";
  return task;
}

/** Runs one of the receptionist's tools against the task records. */
export function runPlannerTool(
  name: string,
  args: Record<string, unknown>,
  store: TaskStore,
  now: Date
): { content: string; isError?: boolean } {
  const fail = (content: string) => ({ content, isError: true });
  switch (name) {
    case 'add_task': {
      const checked = validateTaskInput(
        { title: args.title, due: args.due, remindAt: args.remind_at, notes: args.notes },
        now,
        false
      );
      if (!checked.ok) return fail(checked.error);
      const fields = Object.fromEntries(Object.entries(checked.value).filter(([, v]) => v !== undefined));
      const task = store.add({ kind: 'todo', status: 'open', title: checked.value.title!, ...fields });
      return { content: `Added "${task.title}" (id ${task.id})${when(task, now)}.` };
    }
    case 'list_tasks':
      return { content: listing(store, args.range, now) };
    case 'update_task': {
      const task = todo(store, args.id);
      if (typeof task === 'string') return fail(task);
      const checked = validateTaskInput(
        { title: args.title, due: args.due, remindAt: args.remind_at, notes: args.notes },
        now,
        true
      );
      if (!checked.ok) return fail(checked.error);
      if (!Object.keys(checked.value).length)
        return fail('Nothing to change: give a title, due, remind_at or notes.');
      const updated = store.update(task.id, withReminderReset(checked.value));
      return { content: `Updated "${updated.title}"${when(updated, now)}.` };
    }
    case 'complete_task': {
      const task = todo(store, args.id);
      if (typeof task === 'string') return fail(task);
      if (task.status === 'done') return { content: `"${task.title}" was already done.` };
      store.update(task.id, { status: 'done', doneAt: now.getTime() });
      return { content: `Done: "${task.title}".` };
    }
    default:
      return fail(`Unknown tool: ${name}`);
  }
}
