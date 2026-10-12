import { ACTIVE_RUN_STATUSES, type AgentRun, type RunStatus } from '../../../../shared/runtime';
import type { TaskItem } from '../../../../shared/types';
import type { AgentStatus } from './data/officeAgents';
import { APPROVAL } from './tasks';
import type { Visit } from './visits';

/**
 * What the office shows about each person at a glance: their status (the pose, the strip on their
 * desk screens, the tint of their name tag) and the badge or bubble over their head. Worked out from
 * the runs, the task records and the approvals waiting for you. Pure, so it can be tested without a
 * scene.
 */

/** How long a finished task keeps the green strip and the celebrating pose's status. */
export const DONE_FOR_MS = 20_000;
/** How long the tick burst shows over someone who just finished. */
export const TICK_FOR_MS = 3_000;
/** How long the red badge shows over someone whose task failed (they stay marked red on the tag). */
export const FAILED_BADGE_FOR_MS = 8_000;
/** A stopped-early or interrupted task asks for you for this long, then stops calling out from across the room. */
export const NEEDS_YOU_FOR_MS = 12 * 3_600_000;
/** Most badges and bubbles drawn at once; the quietest (working dots) go first. */
export const MAX_MARKERS = 40;

/** Waiting for you: an approval, an answer, a Start. */
const NEEDS_YOU = new Set<RunStatus>(['waiting_for_user', 'waiting_for_approval']);
/** Ended without a clean finish, and waiting for you to look. */
const NEEDS_A_LOOK = new Set<RunStatus>(['blocked', 'interrupted']);

/** Badges that stay on the person after the status is worked out. */
export type Beacon = 'needs' | 'done' | 'failed';

export interface PresenceInput {
  /** Everyone in the office. */
  agentIds: readonly string[];
  runs: readonly AgentRun[];
  tasks: readonly TaskItem[];
  conversations: readonly { id: string; agentId?: string }[];
  /** Approvals waiting for you (only their conversations matter). */
  approvals: readonly { conversationId: string }[];
  now: number;
}

export interface Presence {
  /** Everyone not listed is idle. */
  statuses: Record<string, AgentStatus>;
  beacons: Record<string, Beacon>;
  /** When a badge or the done status next runs out by itself, or null: the moment to work this out again. */
  nextChange: number | null;
}

/**
 * Whether this run is a colleague answering someone's question (`ask_colleague`): it has the asker's
 * run as its parent, in the same conversation. The answerer works while it runs, but answering is
 * not a task of their own to celebrate (or to fail).
 */
function isConsult(run: AgentRun, byId: ReadonlyMap<string, AgentRun>): boolean {
  if (!run.parentRunId || run.taskId) return false;
  const parent = byId.get(run.parentRunId);
  return !!parent && parent.conversationId === run.conversationId && parent.agentId !== run.agentId;
}

const newest = (a: AgentRun, b: AgentRun) => b.updatedAt - a.updatedAt;

/** Everyone's status and badge as of `now`. */
export function derivePresence(input: PresenceInput): Presence {
  const { agentIds, runs, tasks, conversations, approvals, now } = input;
  const statuses: Record<string, AgentStatus> = {};
  const beacons: Record<string, Beacon> = {};
  let nextChange = Infinity;
  const soon = (at: number) => {
    if (at > now && at < nextChange) nextChange = at;
  };

  const known = new Set(agentIds);
  const byId = new Map(runs.map((run) => [run.runId, run]));
  const mine = new Map<string, AgentRun[]>();
  for (const run of runs) {
    if (!known.has(run.agentId)) continue;
    const list = mine.get(run.agentId);
    if (list) list.push(run);
    else mine.set(run.agentId, [run]);
  }

  // Whose conversation has an approval waiting.
  const owner = new Map(conversations.map((conversation) => [conversation.id, conversation.agentId]));
  const asked = new Set<string>();
  for (const approval of approvals) {
    const agentId =
      owner.get(approval.conversationId) ??
      runs.find((run) => run.conversationId === approval.conversationId && !isConsult(run, byId))?.agentId;
    if (agentId && known.has(agentId)) asked.add(agentId);
  }

  const workOf = (conversationId: string) =>
    tasks.find((task) => task.kind === 'work' && task.conversationId === conversationId);
  /** A work record that ended needing a look: stopped early, or interrupted by a restart. */
  const needsALook = (task: TaskItem | undefined) =>
    !!task &&
    task.status === 'attention' &&
    task.note !== APPROVAL &&
    now - task.updatedAt < NEEDS_YOU_FOR_MS;

  for (const id of agentIds) {
    const runsOfMine = mine.get(id) ?? [];
    const active = runsOfMine.filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
    if (asked.has(id) || active.some((run) => NEEDS_YOU.has(run.status))) {
      statuses[id] = 'waiting';
      beacons[id] = 'needs';
      continue;
    }
    // Waiting on a colleague's answer or in the queue is still working: nothing is needed from you.
    if (active.length) {
      statuses[id] = 'working';
      continue;
    }

    const last = runsOfMine.filter((run) => !isConsult(run, byId)).sort(newest)[0];
    if (!last) {
      // No run on record (it was a long time ago, or before a restart): the task records still know.
      const record = tasks
        .filter((task) => task.kind === 'work' && task.coworkerId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (needsALook(record)) {
        statuses[id] = 'waiting';
        beacons[id] = 'needs';
      }
      continue;
    }
    const ended = last.completedAt ?? last.updatedAt;
    if (last.status === 'failed') {
      statuses[id] = 'error';
      if (now - ended < FAILED_BADGE_FOR_MS) {
        beacons[id] = 'failed';
        soon(ended + FAILED_BADGE_FOR_MS);
      }
    } else if (
      NEEDS_A_LOOK.has(last.status) ||
      (last.status === 'completed' && needsALook(workOf(last.conversationId)))
    ) {
      if (now - last.updatedAt < NEEDS_YOU_FOR_MS) {
        statuses[id] = 'waiting';
        beacons[id] = 'needs';
      }
    } else if (last.status === 'completed' && now - ended < DONE_FOR_MS) {
      statuses[id] = 'completed';
      if (now - ended < TICK_FOR_MS) {
        beacons[id] = 'done';
        soon(ended + TICK_FOR_MS);
      }
      soon(ended + DONE_FOR_MS);
    }
  }
  return { statuses, beacons, nextChange: Number.isFinite(nextChange) ? nextChange : null };
}

// ---------------------------------------------------------------- what is drawn over each head

export type MarkerKind = 'needs' | 'done' | 'failed' | 'asking' | 'answering' | 'working';

export interface Marker {
  kind: MarkerKind;
  /** The words in a bubble. */
  text?: string;
}

/**
 * Whether a marker is one half of a question: the asker's or the answerer's. Their words go on their
 * name tags while those are up; a bubble is drawn only for a person whose tag is not.
 */
export const isTalk = (kind: string | undefined): boolean => kind === 'asking' || kind === 'answering';

export interface MarkerInput {
  statuses: Readonly<Record<string, AgentStatus>>;
  beacons: Readonly<Record<string, Beacon>>;
  visits: readonly Visit[];
  /** What to call a colleague who is being asked ("Backend Developer"). */
  nameOf: (id: string) => string | undefined;
}

/** Strongest first: the one thing worth reading over a head when several are true. */
const PRIORITY: Record<MarkerKind, number> = {
  needs: 0,
  asking: 1,
  answering: 1,
  failed: 2,
  done: 3,
  working: 4
};

/**
 * The badge or bubble over each person. Someone who needs you always shows it, then the two people
 * in a question being asked, then a failure, a finished task, and last the quiet dot over anyone
 * working. One per person, at most `MAX_MARKERS` in all.
 */
export function markersFor(input: MarkerInput): Record<string, Marker> {
  const { statuses, beacons, visits, nameOf } = input;
  const chosen = new Map<string, Marker>();
  const offer = (id: string, marker: Marker) => {
    const held = chosen.get(id);
    if (!held || PRIORITY[marker.kind] < PRIORITY[held.kind]) chosen.set(id, marker);
  };
  for (const [id, status] of Object.entries(statuses))
    if (status === 'working') offer(id, { kind: 'working' });
  for (const [id, beacon] of Object.entries(beacons)) offer(id, { kind: beacon });
  for (const [id, status] of Object.entries(statuses)) if (status === 'waiting') offer(id, { kind: 'needs' });
  for (const { visitor, host } of visits) {
    const name = nameOf(host);
    offer(visitor, { kind: 'asking', text: name ? `Asking ${name}…` : 'Asking a colleague…' });
    offer(host, { kind: 'answering', text: 'Answering…' });
  }
  return Object.fromEntries(
    [...chosen].sort((a, b) => PRIORITY[a[1].kind] - PRIORITY[b[1].kind]).slice(0, MAX_MARKERS)
  );
}
