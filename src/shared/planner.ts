import type { TaskItem } from './types';

/**
 * The planner's calendar sense, shared by the receptionist's tools, the planner, the morning
 * briefing and the Today board. Dates are the user's local wall-clock time: 'YYYY-MM-DD', or
 * 'YYYY-MM-DDTHH:mm' with a time. Pure, so it is tested with a fixed clock.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];
/** A reminder or due date without a time falls at the start of the working day. */
const DEFAULT_HOUR = 9;
/** How long finished items stay in the planner's Done group. */
const DONE_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, '0');

export interface LocalTime {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:mm', when the value had a time. */
  time?: string;
  /** Epoch ms of that local moment (09:00 when there is no time). */
  at: number;
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** Reads a local date or date and time; anything else, or a date that doesn't exist, is null. */
export function parseLocal(value: string): LocalTime | null {
  const match = PATTERN.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const timed = match[4] !== undefined;
  const hour = timed ? Number(match[4]) : DEFAULT_HOUR;
  const minute = timed ? Number(match[5]) : 0;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return null;
  const moment = new Date(year, month - 1, day, hour, minute);
  if (moment.getFullYear() !== year || moment.getMonth() !== month - 1 || moment.getDate() !== day)
    return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return timed
    ? { date, time: `${match[4]}:${match[5]}`, at: moment.getTime() }
    : { date, at: moment.getTime() };
}

/** The local calendar day of a moment, as 'YYYY-MM-DD'. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  // Noon keeps daylight-saving changes from moving the day.
  return dayKey(new Date(year, month - 1, day + days, 12));
}

/** 'HH:mm' for a moment in local time. */
export function clockTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 'Today', 'Tomorrow', 'Fri 25 Sep', or 'Fri 1 Jan 2027' in another year. */
export function dayLabel(key: string, now: Date): string {
  const today = dayKey(now);
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return shortDate(key, now);
}

/** 'Mon 21 Sep', with the year when it isn't this year's. */
export function shortDate(key: string, now: Date): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  const text = `${WEEKDAYS[date.getDay()].slice(0, 3)} ${day} ${MONTHS[month - 1].slice(0, 3)}`;
  return year === now.getFullYear() ? text : `${text} ${year}`;
}

/** A reminder's moment: 'Today 10:00', 'Tomorrow 09:00', 'Fri 25 Sep 10:00'. */
export function momentLabel(at: number, now: Date): string {
  return `${dayLabel(dayKey(new Date(at)), now)} ${clockTime(at)}`;
}

const dueOf = (task: TaskItem) => (task.due ? parseLocal(task.due) : null);
const isOpenTodo = (task: TaskItem) => task.kind === 'todo' && task.status !== 'done';

/** An open to-do whose day has gone by. */
export function isOverdue(task: TaskItem, now: Date): boolean {
  const due = dueOf(task);
  return isOpenTodo(task) && !!due && due.date < dayKey(now);
}

/** When a to-do is due, as the planner shows it: 'Today 10:00', 'Tomorrow', 'Overdue · Tue 22 Sep'. */
export function dueLabel(task: TaskItem, now: Date): string {
  const due = dueOf(task);
  if (!due) return task.due ?? '';
  const time = due.time ? ` ${due.time}` : '';
  if (isOverdue(task, now)) return `Overdue · ${shortDate(due.date, now)}${time}`;
  return `${dayLabel(due.date, now)}${time}`;
}

/** Soonest first; on the same day, timed items by time and then the untimed ones. */
function bySchedule(a: TaskItem, b: TaskItem): number {
  const da = dueOf(a);
  const db = dueOf(b);
  if (!da || !db) return da ? -1 : db ? 1 : a.createdAt - b.createdAt;
  if (da.date !== db.date) return da.date < db.date ? -1 : 1;
  if (!!da.time !== !!db.time) return da.time ? -1 : 1;
  if (da.at !== db.at) return da.at - db.at;
  return a.createdAt - b.createdAt;
}

export interface PlannerGroups {
  today: TaskItem[];
  week: TaskItem[];
  later: TaskItem[];
  done: TaskItem[];
}

/**
 * The planner's groups. Today: overdue and today's to-dos, then what coworkers are working on or
 * need help with. This week: the seven days after today. Later: further out, or no date. Done: the
 * last two weeks. Help records are the colleagues' business and stay off the planner.
 */
export function groupPlanner(tasks: readonly TaskItem[], now: Date): PlannerGroups {
  const today = dayKey(now);
  const weekEnd = addDays(today, 7);
  const doneSince = now.getTime() - DONE_DAYS * DAY;
  const groups: PlannerGroups = { today: [], week: [], later: [], done: [] };
  const work: TaskItem[] = [];
  for (const task of tasks) {
    if (task.kind === 'help') continue;
    if (task.status === 'done') {
      if ((task.doneAt ?? task.updatedAt) >= doneSince) groups.done.push(task);
      continue;
    }
    if (task.kind === 'work') {
      if (task.status === 'working' || task.status === 'attention') work.push(task);
      continue;
    }
    const due = dueOf(task);
    if (!due) groups.later.push(task);
    else if (due.date <= today) groups.today.push(task);
    else if (due.date <= weekEnd) groups.week.push(task);
    else groups.later.push(task);
  }
  groups.today.sort(bySchedule);
  groups.today.push(...work.sort((a, b) => b.updatedAt - a.updatedAt));
  groups.week.sort(bySchedule);
  groups.later.sort(bySchedule);
  groups.done.sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt));
  return groups;
}

export interface Briefing {
  greeting: string;
  /** Today's to-dos: '10:00 — Prep the investor deck', or just the title. */
  today: string[];
  /** 'Call the bank (due Mon 21 Sep)' */
  overdue: string[];
  /** '2 coworkers working, 1 needs attention', or null when nobody is busy. */
  coworkers: string | null;
  empty: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The morning briefing: built from the planner, with no model involved. */
export function briefing(tasks: readonly TaskItem[], now: Date): Briefing {
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayKey = dayKey(now);
  const groups = groupPlanner(tasks, now);
  const todos = groups.today.filter((task) => task.kind === 'todo');
  const today = todos
    .filter((task) => dueOf(task)?.date === todayKey)
    .map((task) => {
      const time = dueOf(task)?.time;
      return time ? `${time} — ${task.title}` : task.title;
    });
  const overdue = todos
    .filter((task) => isOverdue(task, now))
    .map((task) => `${task.title} (due ${shortDate(dueOf(task)!.date, now)})`);
  const working = groups.today.filter((task) => task.kind === 'work' && task.status === 'working').length;
  const attention = groups.today.filter((task) => task.kind === 'work' && task.status === 'attention').length;
  const needs = (n: number) => `${n === 1 ? 'needs' : 'need'} attention`;
  const coworkers =
    working && attention
      ? `${plural(working, 'coworker')} working, ${attention} ${needs(attention)}`
      : working
        ? `${plural(working, 'coworker')} working`
        : attention
          ? `${plural(attention, 'coworker')} ${needs(attention)}`
          : null;
  return { greeting, today, overdue, coworkers, empty: !today.length && !overdue.length && !coworkers };
}

/** What the Today board lists: open to-dos with a date, overdue first, soonest next. */
export function nextUp(tasks: readonly TaskItem[], limit = 5): TaskItem[] {
  return tasks
    .filter((task) => isOpenTodo(task) && dueOf(task))
    .sort(bySchedule)
    .slice(0, limit);
}

/** The receptionist's sense of time, added to her instructions on every message. */
export function plannerNow(now: Date): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const zone = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const date = `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  return `Now: ${date}, ${clockTime(now.getTime())} (${zone}). Today is ${dayKey(now)}.`;
}
