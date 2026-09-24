import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, CalendarDays, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { TaskItem } from '../../../../../shared/types';
import { dayKey, dueLabel, groupPlanner, isOverdue, parseLocal } from '../../../../../shared/planner';
import { useApp } from '../../../state';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { shortName } from '../shell/framing';
import { useOfficeStore } from '../store/officeStore';

const EMPTY: TaskItem[] = [];
const STATUS_LABEL: Partial<Record<TaskItem['status'], string>> = {
  working: 'Working',
  attention: 'Needs attention',
  done: 'Done'
};

/** The time, refreshed each minute, so 'Today' and 'Overdue' stay true while the planner is open. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** An IPC error as the user should read it. */
const readable = (error: unknown) =>
  (error instanceof Error ? error.message : 'Something went wrong.')
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace('; ask the user.', '.');

/**
 * The receptionist's planner, above her conversation: your to-dos by day, and what the team is
 * working on today. Tick, rename, reschedule or delete a to-do right here, or ask her.
 */
export function Planner() {
  const tasks = useApp((s) => s.data?.tasks ?? EMPTY);
  const open = useOfficeStore((s) => s.plannerOpen);
  const setOpen = useOfficeStore((s) => s.setPlannerOpen);
  const [doneOpen, setDoneOpen] = useState(false);
  const [error, setError] = useState('');
  const now = useMinute();
  const groups = groupPlanner(tasks, now);
  const todayCount = groups.today.filter((task) => task.kind === 'todo').length;

  /** Runs a planner change; the new list arrives by itself from the main process. */
  const run = async (change: () => Promise<unknown>): Promise<boolean> => {
    try {
      await change();
      setError('');
      return true;
    } catch (failure) {
      setError(readable(failure));
      return false;
    }
  };

  const empty = !groups.today.length && !groups.week.length && !groups.later.length && !groups.done.length;
  return (
    <section className={`planner${open ? ' open' : ''}`} aria-label="Planner">
      <button className="planner-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CalendarDays size={15} />
        <h4>Planner</h4>
        <span className="planner-count">
          {todayCount
            ? `${todayCount} today`
            : groups.week.length
              ? `${groups.week.length} this week`
              : 'Nothing today'}
        </span>
        <ChevronDown size={15} className="planner-chevron" />
      </button>
      {open && (
        <div className="planner-body">
          <AddRow onAdd={(input) => run(() => window.axon.taskAdd(input))} />
          {error && (
            <p className="planner-error" role="alert">
              {error}
            </p>
          )}
          {empty && <p className="planner-empty">Nothing planned. Add a to-do, or ask the receptionist.</p>}
          <Group title="Today" tasks={groups.today} now={now} run={run} />
          <Group title="This week" tasks={groups.week} now={now} run={run} />
          <Group title="Later" tasks={groups.later} now={now} run={run} />
          {groups.done.length > 0 && (
            <section className="planner-group">
              <button
                className="planner-group-toggle"
                aria-expanded={doneOpen}
                onClick={() => setDoneOpen(!doneOpen)}
              >
                Done <span>{groups.done.length}</span>
                <ChevronDown size={13} className="planner-chevron" />
              </button>
              {doneOpen && (
                <ul>
                  {groups.done.map((task) => (
                    <Row key={task.id} task={task} now={now} run={run} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function AddRow({ onAdd }: { onAdd: (input: { title: string; due?: string }) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (await onAdd({ title: title.trim(), ...(date ? { due: date } : {}) })) {
      setTitle('');
      setDate('');
    }
  };
  return (
    <form className="planner-add" onSubmit={(event) => void submit(event)}>
      <Plus size={14} aria-hidden="true" />
      <input
        className="planner-add-title"
        placeholder="Add a to-do…"
        aria-label="New to-do"
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
      />
      <input
        className="planner-add-date"
        type="date"
        aria-label="Due date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <button type="submit" disabled={!title.trim()}>
        Add
      </button>
    </form>
  );
}

type Run = (change: () => Promise<unknown>) => Promise<boolean>;

function Group({ title, tasks, now, run }: { title: string; tasks: TaskItem[]; now: Date; run: Run }) {
  if (!tasks.length) return null;
  return (
    <section className="planner-group">
      <h5>
        {title} <span>{tasks.length}</span>
      </h5>
      <ul>
        {tasks.map((task) =>
          task.kind === 'todo' ? (
            <Row key={task.id} task={task} now={now} run={run} />
          ) : (
            <WorkRow key={task.id} task={task} />
          )
        )}
      </ul>
    </section>
  );
}

/** One of your to-dos. */
function Row({ task, now, run }: { task: TaskItem; now: Date; run: Run }) {
  /** The title while it is being edited. */
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (task.kind !== 'todo') return <WorkRow task={task} />;
  const done = task.status === 'done';
  const reminding = !!task.remindAt && !task.remindedAt && !done;

  /** Leaving the field saves (Enter blurs it); Esc leaves without saving. */
  const rename = async (value: string) => {
    setDraft(null);
    if (cancelled.current) return void (cancelled.current = false);
    const next = value.trim();
    if (next && next !== task.title) await run(() => window.axon.taskUpdate(task.id, { title: next }));
  };

  return (
    <li className={`planner-row${done ? ' done' : ''}${isOverdue(task, now) ? ' overdue' : ''}`}>
      <div className="planner-line">
        <input
          type="checkbox"
          checked={done}
          aria-label={done ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`}
          onChange={() => void run(() => window.axon.taskUpdate(task.id, { status: done ? 'open' : 'done' }))}
        />
        {draft !== null ? (
          <input
            className="planner-title-input"
            aria-label="To-do title"
            value={draft}
            maxLength={120}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => void rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                event.stopPropagation();
                cancelled.current = true;
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <button className="planner-title" title="Rename" onClick={() => setDraft(task.title)}>
            {task.title}
          </button>
        )}
        <button
          className={`planner-due${task.due ? '' : ' unset'}`}
          aria-label={task.due ? `Due ${dueLabel(task, now)}; change` : 'Add a date'}
          aria-expanded={dueOpen}
          onClick={() => setDueOpen(!dueOpen)}
        >
          {reminding && <Bell size={11} aria-label="Reminder set" />}
          {task.due ? dueLabel(task, now) : 'Add date'}
        </button>
        {confirming ? (
          <span className="planner-confirm">
            Delete?
            <button onClick={() => void run(() => window.axon.taskDelete(task.id))}>Yes</button>
            <button onClick={() => setConfirming(false)}>No</button>
          </span>
        ) : (
          <button
            className="planner-delete"
            aria-label={`Delete “${task.title}”`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {dueOpen && <DueEditor task={task} run={run} onClose={() => setDueOpen(false)} />}
    </li>
  );
}

/** Date, time and a reminder for one to-do. A reminder without a time is at 09:00. */
function DueEditor({ task, run, onClose }: { task: TaskItem; run: Run; onClose: () => void }) {
  const current = task.due ? parseLocal(task.due) : null;
  const [date, setDate] = useState(current?.date ?? dayKey(new Date()));
  const [time, setTime] = useState(current?.time ?? '');
  const [remind, setRemind] = useState(!!task.remindAt && !task.remindedAt);

  const save = async () => {
    const due = date ? (time ? `${date}T${time}` : date) : null;
    const patch: { due: string | null; remindAt?: number | null } = { due };
    const at = due && remind ? parseLocal(due)?.at : undefined;
    // Only send the reminder when it changes, so an untouched past one isn't refused.
    if (at !== undefined) {
      if (at !== task.remindAt || task.remindedAt) patch.remindAt = at;
    } else if (task.remindAt) patch.remindAt = null;
    if (await run(() => window.axon.taskUpdate(task.id, patch))) onClose();
  };
  const clear = async () => {
    if (await run(() => window.axon.taskUpdate(task.id, { due: null, remindAt: null }))) onClose();
  };

  return (
    <div
      className="planner-due-editor"
      onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), onClose())}
    >
      <label>
        Date
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </label>
      <label>
        Time
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      </label>
      <label className="planner-remind">
        <input
          type="checkbox"
          checked={remind}
          disabled={!date}
          onChange={(event) => setRemind(event.target.checked)}
        />
        Remind me{remind && !time ? ' at 09:00' : ''}
      </label>
      <div className="planner-due-actions">
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
        {(task.due || task.remindAt) && <button onClick={() => void clear()}>Clear</button>}
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/** A coworker's task on today's list: who is on it, and a way into their conversation. */
function WorkRow({ task }: { task: TaskItem }) {
  const person = OFFICE_AGENTS.find((agent) => agent.id === task.coworkerId);
  const open = () => {
    if (!person) return;
    const store = useOfficeStore.getState();
    store.flyToAgent(person.id);
    if (task.conversationId) store.setAgentConversation(person.id, task.conversationId);
  };
  return (
    <li className={`planner-row work status-${task.status}`}>
      <div className="planner-line">
        <span className="planner-work-dot" style={{ background: person?.accentColor }} aria-hidden="true" />
        <span className="planner-work-title">{task.title}</span>
        <button className="planner-person" onClick={open} disabled={!person}>
          {shortName(person?.name ?? 'A coworker')} · {STATUS_LABEL[task.status] ?? 'To do'}
        </button>
      </div>
    </li>
  );
}
