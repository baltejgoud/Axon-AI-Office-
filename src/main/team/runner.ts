import type { MeetingRoomId } from '../../shared/rooms';
import type { Team, TeamAssignment, TeamPlan } from '../../shared/types';
import { MAX_PARALLEL, OPEN_TEAM, RESULT_LIMIT, blockDependants, progress, readyAssignments, resetForRetry } from './plan';

/** Attendees answering at once in a meeting. */
const MEETING_PARALLEL = 4;

/** How an owner's run ended, and what they said last. */
export interface WorkOutcome {
  outcome: 'done' | 'failed' | 'stopped';
  answer: string;
  error?: string;
}

/** What the runner needs from Axon: the saved teams, the model calls, and owners' runs. */
export interface TeamRunnerDeps {
  teams: () => Team[];
  id: () => string;
  now?: () => number;
  /** After any change: save, and tell the window. */
  changed: () => void;
  /** One attendee's input to the meeting. */
  contribute: (team: Team, attendeeId: string, signal: AbortSignal) => Promise<string>;
  /** The lead's plan from the minutes, or why there is none. */
  plan: (team: Team, signal: AbortSignal) => Promise<{ plan: TeamPlan } | { errors: string[] }>;
  /** One task, run in a new conversation for its owner; `started` names that conversation as soon as it exists. */
  work: (team: Team, assignment: TeamAssignment, started: (conversationId: string) => void) => Promise<WorkOutcome>;
  /** Stops an owner's run. */
  stopWork: (conversationId: string) => void;
  /** The lead's report once everything is done. */
  report: (team: Team, signal: AbortSignal) => Promise<string>;
  /** The team is done (for a notification). */
  finished?: (team: Team) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs teams: the meeting, the plan waiting for you, the work in dependency order (at most three
 * at once), and the report. Stop and Retry work at any point. Every change goes through `changed`.
 */
export class TeamRunner {
  /** The meeting's or report's calls, so Stop can end them. */
  private readonly calls = new Map<string, AbortController>();
  /** Each team's tasks running now. */
  private readonly running = new Map<string, Set<string>>();
  /** Everything still in flight for a team. */
  private readonly busy = new Map<string, Set<Promise<unknown>>>();

  constructor(private readonly deps: TeamRunnerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private get(id: string): Team {
    const team = this.deps.teams().find((t) => t.id === id);
    if (!team) throw new Error('Team not found.');
    return team;
  }

  private touch(team: Team): void {
    team.updatedAt = this.now();
    this.deps.changed();
  }

  private track<T>(teamId: string, promise: Promise<T>): Promise<T> {
    const set = this.busy.get(teamId) ?? new Set<Promise<unknown>>();
    this.busy.set(teamId, set);
    set.add(promise);
    void promise.finally(() => set.delete(promise)).catch(() => {});
    return promise;
  }

  /** Resolves once nothing of this team is in flight. */
  async idle(teamId: string): Promise<void> {
    for (let set = this.busy.get(teamId); set?.size; set = this.busy.get(teamId)) await Promise.allSettled([...set]);
  }

  create(input: { leadId: string; conversationId: string; goal: string; attendees: string[]; providerId: string; modelId: string; room?: MeetingRoomId }): Team {
    const now = this.now();
    const team: Team = { id: this.deps.id(), ...input, status: 'meeting', minutes: [], createdAt: now, updatedAt: now };
    this.deps.teams().push(team);
    this.touch(team);
    return team;
  }

  /** Holds the meeting: everyone's input, then the lead's plan, which then waits for you. */
  meet(teamId: string): Promise<void> {
    return this.track(teamId, this.runMeeting(teamId));
  }

  private async runMeeting(teamId: string): Promise<void> {
    const team = this.get(teamId);
    const controller = new AbortController();
    this.calls.set(teamId, controller);
    const { signal } = controller;
    try {
      const queue = [...team.attendees];
      const attend = async () => {
        for (let who = queue.shift(); who !== undefined && !signal.aborted; who = queue.shift()) {
          try {
            const text = (await this.deps.contribute(team, who, signal)).trim();
            if (signal.aborted) return;
            team.minutes.push({ coworkerId: who, text, at: this.now() });
          } catch (error) {
            if (signal.aborted) return;
            team.minutes.push({ coworkerId: who, text: '', at: this.now(), error: message(error) });
          }
          this.touch(team);
        }
      };
      await Promise.all(Array.from({ length: Math.min(MEETING_PARALLEL, queue.length) }, attend));
      if (signal.aborted) return;
      // The minutes in the order people sit, whoever finished first.
      team.minutes.sort((a, b) => team.attendees.indexOf(a.coworkerId) - team.attendees.indexOf(b.coworkerId));
      if (!team.minutes.some((m) => !m.error))
        return this.fail(team, `Nobody in the meeting could answer: ${team.minutes[0]?.error ?? 'no answer'}`);
      const drafted = await this.deps.plan(team, signal);
      if (signal.aborted) return;
      if ('errors' in drafted) return this.fail(team, `The plan did not hold together: ${drafted.errors.join(' ')}`);
      team.plan = drafted.plan;
      team.status = 'planned';
      this.touch(team);
    } catch (error) {
      if (!signal.aborted) this.fail(team, message(error));
    } finally {
      if (this.calls.get(teamId) === controller) this.calls.delete(teamId);
    }
  }

  private fail(team: Team, note: string): void {
    team.status = 'failed';
    team.note = note;
    this.touch(team);
  }

  /** You approved the plan: the work begins. */
  start(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'planned' || !team.plan) throw new Error('That team is not waiting for a start.');
    team.status = 'working';
    team.note = undefined;
    this.touch(team);
    this.schedule(team);
  }

  /** Starts whatever may start, up to three running; reports when all is done, fails when stuck. */
  private schedule(team: Team): void {
    if (team.status !== 'working' || !team.plan) return;
    const assignments = team.plan.assignments;
    blockDependants(assignments);
    const running = this.running.get(team.id) ?? new Set<string>();
    this.running.set(team.id, running);
    for (const a of readyAssignments(assignments)) {
      if (running.size >= MAX_PARALLEL) break;
      running.add(a.id);
      a.status = 'working';
      a.note = undefined;
      void this.track(team.id, this.runAssignment(team, a, running));
    }
    this.touch(team);
    if (running.size) return;
    const where = progress(assignments);
    if (where === 'done') void this.track(team.id, this.finish(team));
    else if (where === 'stuck') this.fail(team, 'Some tasks failed or were stopped. Retry to carry on.');
  }

  private async runAssignment(team: Team, a: TeamAssignment, running: Set<string>): Promise<void> {
    try {
      const ended = await this.deps.work(team, a, (conversationId) => {
        a.conversationId = conversationId;
        this.touch(team);
        // Stopped while their conversation was being set up: stop it as it starts.
        if (team.status !== 'working') this.deps.stopWork(conversationId);
      });
      a.status = ended.outcome;
      a.result = ended.answer.trim().slice(0, RESULT_LIMIT) || undefined;
      a.note = ended.error;
    } catch (error) {
      a.status = 'failed';
      a.note = message(error);
    } finally {
      running.delete(a.id);
      this.touch(team);
      this.schedule(team);
    }
  }

  private async finish(team: Team): Promise<void> {
    team.status = 'reporting';
    this.touch(team);
    const controller = new AbortController();
    this.calls.set(team.id, controller);
    try {
      team.report = (await this.deps.report(team, controller.signal)) || undefined;
    } catch (error) {
      if (controller.signal.aborted) return;
      team.note = `The report could not be written: ${message(error)}`;
    } finally {
      if (this.calls.get(team.id) === controller) this.calls.delete(team.id);
    }
    if (team.status !== 'reporting') return;
    team.status = 'done';
    this.touch(team);
    this.deps.finished?.(team);
  }

  /** Stops the meeting, or every owner still working; nothing waiting starts. `note` says why. */
  stop(teamId: string, note = 'Stopped by you.'): void {
    const team = this.get(teamId);
    if (!OPEN_TEAM.has(team.status)) return;
    this.calls.get(teamId)?.abort();
    team.status = 'stopped';
    team.note = note;
    for (const a of team.plan?.assignments ?? []) {
      if (a.status === 'working' && a.conversationId) this.deps.stopWork(a.conversationId);
      else if (a.status === 'waiting') Object.assign(a, { status: 'stopped', note: 'The team was stopped' });
    }
    this.touch(team);
  }

  /** A plan you don't want. */
  discard(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'planned') throw new Error('Only a plan waiting for you can be discarded.');
    team.status = 'discarded';
    this.touch(team);
  }

  /** Carries a failed or stopped team on: the meeting again if it had no plan, otherwise what didn't finish. */
  retry(teamId: string): void {
    const team = this.get(teamId);
    if (team.status !== 'failed' && team.status !== 'stopped') throw new Error('Only a failed or stopped team can be retried.');
    team.note = undefined;
    if (!team.plan) {
      team.status = 'meeting';
      team.minutes = [];
      this.touch(team);
      void this.meet(teamId);
      return;
    }
    resetForRetry(team.plan.assignments);
    team.status = 'working';
    this.touch(team);
    this.schedule(team);
  }
}
