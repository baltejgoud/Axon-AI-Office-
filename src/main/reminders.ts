import { RECEPTIONIST_ID } from '../shared/coworkers';
import { dueLabel } from '../shared/planner';
import type { FocusTarget, TaskItem } from '../shared/types';
import type { TaskStore } from './tasks/store';

/** A Windows notification, and where clicking it should take the user. */
export interface Notice {
  title: string;
  body: string;
  target: FocusTarget;
}

/** The scheduler's tick; a reminder due sooner than the next tick gets a timer of its own. */
export const TICK_MS = 30_000;
/** More missed reminders than this arrive as one summary. */
const SUMMARY_OVER = 3;
const PLANNER: FocusTarget = { agentId: RECEPTIONIST_ID, planner: true };

/** Open to-dos whose reminder time has come and that haven't reminded yet, earliest first. */
export function dueReminders(tasks: readonly TaskItem[], now: number): TaskItem[] {
  return tasks
    .filter(
      (task) =>
        task.kind === 'todo' &&
        task.status !== 'done' &&
        task.remindAt !== undefined &&
        task.remindAt <= now &&
        !task.remindedAt
    )
    .sort((a, b) => a.remindAt! - b.remindAt!);
}

export interface ReminderOptions {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
  /** Saves the records once reminders are marked, so none repeats after a restart. */
  persist?: () => void;
}

/**
 * Fires each reminder once, as a notification that opens the receptionist's planner. Reminders
 * missed while Axon wasn't running arrive at start-up, rolled into one when there are many.
 * Nothing fires before `startup()`, so no reminder is used up before there is a way to show it.
 */
export class Reminders {
  private timer: unknown = null;
  private started = false;
  private readonly now: () => number;
  private readonly schedule: NonNullable<ReminderOptions['schedule']>;
  private readonly cancel: NonNullable<ReminderOptions['cancel']>;
  private readonly persist: () => void;

  constructor(
    private readonly store: TaskStore,
    private readonly notify: (notice: Notice) => void,
    options: ReminderOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms).unref());
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
    this.persist = options.persist ?? (() => {});
  }

  startup(): void {
    this.started = true;
    const missed = dueReminders(this.store.list(), this.now());
    if (missed.length > SUMMARY_OVER) {
      this.notify({ title: 'Reminders', body: `${missed.length} reminders you missed`, target: PLANNER });
      this.mark(missed);
    } else this.fire(missed);
    this.arm();
  }

  /** Fires whatever is due, then sets a timer for the next reminder if it comes before the next tick. */
  tick(): void {
    if (!this.started) return;
    this.fire(dueReminders(this.store.list(), this.now()));
    this.arm();
  }

  /** The task records changed: a reminder may have been added or moved. */
  changed(): void {
    if (this.started) this.arm();
  }

  stop(): void {
    this.started = false;
    this.clear();
  }

  private fire(tasks: TaskItem[]): void {
    const now = new Date(this.now());
    for (const task of tasks) {
      this.notify({
        title: 'Reminder',
        body: task.due ? `${task.title} — ${dueLabel(task, now)}` : task.title,
        target: PLANNER
      });
    }
    this.mark(tasks);
  }

  private mark(tasks: TaskItem[]): void {
    if (!tasks.length) return;
    const at = this.now();
    for (const task of tasks) this.store.update(task.id, { remindedAt: at });
    this.persist();
  }

  private arm(): void {
    this.clear();
    const now = this.now();
    let next = Infinity;
    for (const task of this.store.list())
      if (
        task.kind === 'todo' &&
        task.status !== 'done' &&
        task.remindAt &&
        !task.remindedAt &&
        task.remindAt > now
      )
        next = Math.min(next, task.remindAt);
    if (next - now > TICK_MS) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.tick();
    }, next - now);
  }

  private clear(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}
