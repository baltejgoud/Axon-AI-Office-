import { coworkerById } from '../../../../shared/coworkers';
import type { AgentRun } from '../../../../shared/runtime';
import { connectorOf, toolRisk } from '../../../../shared/toolRisk';
import type { TaskItem, Team, ToolApprovalRequest } from '../../../../shared/types';
import { APPROVAL } from './tasks';

/**
 * What the bell lists: the things that want you or are worth knowing, worked out from the state the
 * window already has (steps and questions waiting, tasks that ended, teams' plans and reports). Pure,
 * so it can be tested without the window. Which of them you have seen is kept by the caller.
 */

export type NoticeKind = 'approval' | 'question' | 'plan' | 'finished' | 'stopped' | 'failed' | 'report';

export interface Notice {
  /** Stable while the thing it tells about stays the same, so "read" survives a reload. */
  id: string;
  kind: NoticeKind;
  agentId: string;
  conversationId?: string;
  /** Whose it is: "Backend Developer". */
  who: string;
  /** What happened, in a few words: "Finished a task", "Has a question". */
  title: string;
  /** What it is about: the task, the question, the plan's goal. */
  what: string;
  at: number;
}

/** Finished and stopped work is news for this long; a step or question waiting stays until it is answered. */
export const NOTICE_AGE_MS = 3 * 24 * 3_600_000;
/** The most rows the bell shows. */
export const MAX_NOTICES = 40;

/** Waiting for you: they stay unread until you look, whenever they began. */
const LIVE = new Set<NoticeKind>(['approval', 'question', 'plan']);

export interface NoticeInput {
  approvals: readonly ToolApprovalRequest[];
  tasks: readonly TaskItem[];
  teams: readonly Team[];
  runs: readonly Pick<AgentRun, 'conversationId' | 'status' | 'startedAt'>[];
  conversations: readonly { id: string; agentId?: string; title?: string }[];
  /** Connected apps, to say which one a step uses. */
  servers?: readonly { name: string; tools?: readonly { axonName: string }[] }[];
  now: number;
}

const nameOf = (agentId: string | undefined) => coworkerById(agentId)?.name ?? 'A coworker';
const oneLine = (text: string, max = 140) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** What a step is about: the file or the command, when it has one. */
function stepTarget(request: ToolApprovalRequest): string {
  const args = request.arguments ?? {};
  const target = request.preview?.path ?? args.path ?? args.command ?? args.directory ?? '';
  return typeof target === 'string' ? oneLine(target, 80) : '';
}

/** Everything the bell lists, newest first. */
export function deriveNotices(input: NoticeInput): Notice[] {
  const { approvals, tasks, teams, runs, conversations, servers, now } = input;
  const notices: Notice[] = [];
  const agentOf = new Map(conversations.map((c) => [c.id, c.agentId]));

  for (const request of approvals) {
    // A conversation with nobody in the office can't be opened from here.
    const agentId = agentOf.get(request.conversationId);
    if (!agentId) continue;
    const base = {
      id: `${request.question ? 'question' : 'approval'}:${request.id}`,
      agentId,
      conversationId: request.conversationId,
      who: nameOf(agentId),
      at: request.createdAt ?? now
    };
    if (request.question)
      notices.push({ ...base, kind: 'question', title: 'Has a question for you', what: oneLine(request.question.text) });
    else {
      const risk = toolRisk(request.toolName, connectorOf(request.toolName, servers));
      const target = stepTarget(request);
      notices.push({ ...base, kind: 'approval', title: 'Needs your OK', what: target ? `${risk.label}: ${target}` : risk.label });
    }
  }

  for (const task of tasks) {
    if (task.kind !== 'work' || !task.coworkerId || !task.conversationId) continue;
    const base = { agentId: task.coworkerId, conversationId: task.conversationId, who: nameOf(task.coworkerId), what: oneLine(task.title) };
    if (task.status === 'done' && task.doneAt && task.note !== 'Stopped') {
      // You stopped it yourself: nothing to tell you.
      if (now - task.doneAt < NOTICE_AGE_MS)
        notices.push({ ...base, id: `finished:${task.id}:${task.doneAt}`, kind: 'finished', title: 'Finished a task', at: task.doneAt });
    } else if (task.status === 'attention' && task.note !== APPROVAL && now - task.updatedAt < NOTICE_AGE_MS) {
      // Its run failed, or it ended without the answer it owes.
      const latest = runs
        .filter((run) => run.conversationId === task.conversationId)
        .reduce<(typeof runs)[number] | undefined>((a, b) => (!a || b.startedAt > a.startedAt ? b : a), undefined);
      const failed = latest?.status === 'failed';
      notices.push({
        ...base,
        id: `attention:${task.id}:${task.updatedAt}`,
        kind: failed ? 'failed' : 'stopped',
        title: failed ? 'Couldn’t finish a task' : 'Stopped early',
        at: task.updatedAt
      });
    }
  }

  for (const team of teams) {
    const base = { agentId: team.leadId, conversationId: team.conversationId, who: nameOf(team.leadId), what: oneLine(team.goal), at: team.updatedAt };
    if (team.status === 'planned') notices.push({ ...base, id: `team:${team.id}:planned`, kind: 'plan', title: 'A team plan is ready for your OK' });
    else if (now - team.updatedAt >= NOTICE_AGE_MS) continue;
    else if (team.status === 'done' && team.report) notices.push({ ...base, id: `team:${team.id}:done`, kind: 'report', title: 'The team’s report is ready' });
    else if (team.status === 'failed') notices.push({ ...base, id: `team:${team.id}:failed`, kind: 'failed', title: 'A team needs a look' });
  }

  return notices.sort((a, b) => b.at - a.at).slice(0, MAX_NOTICES);
}

/** How long ago, in a few words: "just now", "2 min ago", "3 hours ago", "yesterday", "4 days ago". */
export function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return days <= 1 ? 'yesterday' : `${days} days ago`;
}

// ------------------------------------------------------------------------------- read or not

/** What is kept between sessions: when the bell started listing, and what you have looked at. */
export interface NoticeMemory {
  since: number;
  /** Notice id to when it was read. */
  read: Record<string, number>;
}

export const NOTICE_KEY = 'axon.notices.v1';
/** The most "read" marks kept; the oldest go first. */
const KEPT = 300;

/** The saved memory. A first start begins now, so work from before the bell isn't all news. Storage that is blocked starts fresh. */
export function loadMemory(storage: Pick<Storage, 'getItem'> | null | undefined, now: number): NoticeMemory {
  try {
    const saved = JSON.parse(storage?.getItem(NOTICE_KEY) ?? 'null');
    if (saved && typeof saved === 'object' && Number.isFinite(saved.since)) {
      const read: Record<string, number> = {};
      if (saved.read && typeof saved.read === 'object')
        for (const [id, when] of Object.entries(saved.read)) if (typeof when === 'number') read[id] = when;
      return { since: saved.since, read };
    }
  } catch {
    // Unreadable or blocked: start fresh.
  }
  return { since: now, read: {} };
}

/** Keeps the memory; the oldest marks are dropped past a few hundred. Blocked storage keeps it for this session only. */
export function saveMemory(storage: Pick<Storage, 'setItem'> | null | undefined, memory: NoticeMemory): NoticeMemory {
  const ids = Object.entries(memory.read).sort((a, b) => b[1] - a[1]).slice(0, KEPT);
  const kept = { since: memory.since, read: Object.fromEntries(ids) };
  try {
    storage?.setItem(NOTICE_KEY, JSON.stringify(kept));
  } catch {
    // Kept for this session only.
  }
  return kept;
}

/** Whether you have seen it: marked read, or older than the bell (for news; what waits for you is always new). */
export function isRead(notice: Notice, memory: NoticeMemory): boolean {
  if (memory.read[notice.id] !== undefined) return true;
  return !LIVE.has(notice.kind) && notice.at < memory.since;
}

/** Marks these read now. */
export function markRead(memory: NoticeMemory, ids: readonly string[], now: number): NoticeMemory {
  const read = { ...memory.read };
  for (const id of ids) read[id] = now;
  return { ...memory, read };
}

export const unreadCount = (notices: readonly Notice[], memory: NoticeMemory): number =>
  notices.filter((notice) => !isRead(notice, memory)).length;
