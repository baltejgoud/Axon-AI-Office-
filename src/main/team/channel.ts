import { coworkerById } from '../../shared/coworkers';
import type { Team, TeamAssignment, TeamPost } from '../../shared/types';
import { EXCERPT_LIMIT } from './plan';

/** Posts a team keeps; the oldest go first. */
export const CHANNEL_LIMIT = 200;
/** The longest single message. */
export const POST_LIMIT = 4000;
/** Messages one run may send; enough to ask and answer, not enough to chatter. */
export const MAX_POSTS = 10;
/** Posts a task brief carries, and how much of each. */
const BRIEF_POSTS = 10;
const BRIEF_POST_LIMIT = 1500;
/** Follow-up runs a task gets for messages that arrived as it was finishing. */
export const MAX_FOLLOW_UPS = 3;
/** What a message on the bus says it was sent to when the whole team got it. */
export const TEAM_AUDIENCE = 'the whole team';

/** A way of saying "the whole team" in the place of a name. */
const EVERYONE = /^(all|everyone|everybody|team|the team|the whole team|whole team)$/i;

const nameOf = (id: string) => coworkerById(id)?.name ?? id;
const norm =(name: string) => name.replace(/\s*\([^()]*\)\s*$/, '').trim().toLowerCase();
const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
const names = (ids: string[]) => ids.map(nameOf).join(', ');

/** Teams from before the chat get an empty one; a saved chat is held to its limits. True when something changed. */
export function migrateChannels(teams: Team[]): boolean {
  let changed = false;
  for (const team of teams) {
    const saved: unknown = team.channel;
    if (!Array.isArray(saved)) {
      team.channel = [];
      changed = true;
      continue;
    }
    const valid = (saved as TeamPost[]).filter(
      (p) => p && typeof p.id === 'string' && typeof p.fromId === 'string' && typeof p.text === 'string'
    );
    const kept = valid.slice(-CHANNEL_LIMIT).map((p) => (p.text.length > POST_LIMIT ? { ...p, text: p.text.slice(0, POST_LIMIT) } : p));
    if (kept.length !== saved.length || kept.some((p, i) => p !== saved[i])) {
      team.channel = kept;
      changed = true;
    }
  }
  return changed;
}

/** Where a conversation sits in a team's work: the owner of a task under way, or the lead while the team works. */
export interface TeamSeat {
  team: Team;
  /** Who is speaking. */
  selfId: string;
  /** The task they are on, when they are an owner. */
  assignment?: TeamAssignment;
}

export function seatOf(teams: readonly Team[], conversationId: string): TeamSeat | null {
  for (const team of teams) {
    if (team.status !== 'working') continue;
    const mine = team.plan?.assignments.find((a) => a.status === 'working' && a.conversationId === conversationId);
    if (mine) return { team, selfId: mine.ownerId, assignment: mine };
    if (team.conversationId === conversationId) return { team, selfId: team.leadId };
  }
  return null;
}

/** Everyone on a team: the lead first. */
const peopleOf = (team: Team): string[] => [...new Set([team.leadId, ...team.attendees])];

/** A teammate as the sender sees them: their name, and what they are on. */
function described(team: Team, id: string): string {
  if (id === team.leadId) return `${nameOf(id)} (the lead)`;
  const tasks = (team.plan?.assignments ?? []).filter((a) => a.ownerId === id).map((a) => a.title);
  return tasks.length ? `${nameOf(id)} (${tasks.join(', ')})` : nameOf(id);
}

/** The teammate a name means: an id, a full name, or part of a name or role that fits only one. */
export function resolveTeammate(team: Team, name: unknown, selfId: string): { id: string } | { error: string } {
  const raw = typeof name === 'string' ? name.trim() : '';
  const wanted = norm(raw);
  const others = peopleOf(team).filter((id) => id !== selfId);
  const teammates = `Your teammates: ${others.map((id) => described(team, id)).join(', ')}.`;
  if (!wanted) return { error: `Say which teammate it is for, or leave "to" out to tell everyone. ${teammates}` };
  if (wanted === selfId || wanted === norm(nameOf(selfId))) return { error: `That is you. ${teammates}` };
  const exact = others.find((id) => id === wanted || norm(nameOf(id)) === wanted);
  if (exact) return { id: exact };
  const near = others.filter((id) => `${norm(nameOf(id))} ${(coworkerById(id)?.role ?? '').toLowerCase()}`.includes(wanted));
  if (near.length === 1) return { id: near[0] };
  if (near.length > 1) return { error: `More than one teammate fits "${raw}": ${names(near)}. Use a full name.` };
  return { error: `Nobody on this team is called "${raw}". ${teammates}` };
}

/** How a message reaches one teammate. */
type Reach =
  | { how: 'now'; conversationId: string }
  /** Their task has not begun (or is being set up): it will be in their brief. */
  | { how: 'later' }
  /** The lead, between conversations: they see it on their next turn. */
  | { how: 'idle' }
  /** Writing up their hand-off: too late to act on. */
  | { how: 'closing' }
  | { how: 'done'; title: string; excerpt: string }
  /** An attendee the plan gave nothing to do. */
  | { how: 'none' };

export interface ChannelDeps {
  id: () => string;
  now: () => number;
  /** An owner's task conversation: `running` while it reads messages, `closing` once it is writing up. */
  phase: (conversationId: string) => 'running' | 'closing' | undefined;
  /** The lead's conversation has a run going. */
  leadRunning: (conversationId: string) => boolean;
  /** Puts a message in a running conversation's mailbox, from `from`. */
  deliver: (conversationId: string, text: string, from: string) => void;
}

function reach(team: Team, id: string, deps: ChannelDeps): Reach {
  if (id === team.leadId)
    return deps.leadRunning(team.conversationId) ? { how: 'now', conversationId: team.conversationId } : { how: 'idle' };
  const tasks = (team.plan?.assignments ?? []).filter((a) => a.ownerId === id);
  if (!tasks.length) return { how: 'none' };
  const working = tasks.find((a) => a.status === 'working');
  if (working) {
    const phase = working.conversationId ? deps.phase(working.conversationId) : undefined;
    if (phase === 'running') return { how: 'now', conversationId: working.conversationId! };
    return phase === 'closing' ? { how: 'closing' } : { how: 'later' };
  }
  if (tasks.some((a) => a.status !== 'done')) return { how: 'later' };
  const last = tasks.filter((a) => a.result).at(-1) ?? tasks.at(-1)!;
  return { how: 'done', title: last.title, excerpt: clip(last.result ?? '', EXCERPT_LIMIT) };
}

/** What a running teammate reads: who it is from, and that a reply goes through message_team. */
export const framed = (fromId: string, text: string, direct: boolean) =>
  `Message from ${nameOf(fromId)} on your team${direct ? '' : ' (to everyone)'}: ${text}\n\nReply with message_team if they need an answer.`;

export interface PostInput {
  text?: unknown;
  to?: unknown;
}

/**
 * A teammate speaking to the team: checked, kept in the team's chat, and handed to whoever is
 * working on it now. Nobody who is not already working is started; a teammate who has not begun
 * finds it in their brief. What the sender is told says who has it and who will.
 */
export function postToTeam(
  team: Team,
  seat: TeamSeat,
  input: PostInput,
  deps: ChannelDeps
): { content: string; isError?: boolean; post?: TeamPost } {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { content: 'Say what you want to tell them.', isError: true };
  if (text.length > POST_LIMIT)
    return {
      content: `That message is ${text.length.toLocaleString('en-US')} characters; keep it under ${POST_LIMIT.toLocaleString('en-US')} and send it again. Long material belongs in a file you name.`,
      isError: true
    };
  if (input.to !== undefined && input.to !== null && typeof input.to !== 'string')
    return { content: '"to" is one teammate by name; leave it out to tell the whole team.', isError: true };
  let toId: string | undefined;
  if (typeof input.to === 'string' && input.to.trim() && !EVERYONE.test(input.to.trim())) {
    const found = resolveTeammate(team, input.to, seat.selfId);
    if ('error' in found) return { content: found.error, isError: true };
    toId = found.id;
  }
  team.channel ??= [];
  if (team.channel.slice(-5).some((p) => p.fromId === seat.selfId && p.toId === toId && p.text === text))
    return { content: `You already sent that${toId ? ` to ${nameOf(toId)}` : ' to the team'}.`, isError: true };

  const reaches = (toId ? [toId] : peopleOf(team).filter((id) => id !== seat.selfId)).map((id) => ({
    id,
    reach: reach(team, id, deps)
  }));
  if (toId) {
    // Nothing would read it, and nothing is coming that would: said, not kept.
    const only = reaches[0].reach;
    if (only.how === 'done')
      return {
        content: `${nameOf(toId)} has already finished "${only.title}", so they will not read this.${only.excerpt ? ` Their hand-off: ${only.excerpt}` : ''}`
      };
    if (only.how === 'none')
      return { content: `${nameOf(toId)} has no task in this plan, so nobody is working to read this.` };
  }

  const post: TeamPost = {
    id: deps.id(),
    fromId: seat.selfId,
    ...(toId ? { toId } : {}),
    text,
    at: deps.now(),
    ...(seat.assignment ? { taskId: seat.assignment.id } : {})
  };
  team.channel.push(post);
  if (team.channel.length > CHANNEL_LIMIT) team.channel.splice(0, team.channel.length - CHANNEL_LIMIT);

  const heard: Record<'now' | 'later' | 'idle' | 'closing' | 'done', string[]> = { now: [], later: [], idle: [], closing: [], done: [] };
  for (const { id, reach: r } of reaches) {
    if (r.how === 'none') continue;
    heard[r.how].push(id);
    if (r.how === 'now') deps.deliver(r.conversationId, framed(seat.selfId, text, !!toId), nameOf(seat.selfId));
  }
  const are = (ids: string[], one: string, many: string) => (ids.length === 1 ? one : many);
  const parts = [
    heard.now.length && `${names(heard.now)} ${are(heard.now, 'is', 'are')} working and will read it at their next step`,
    heard.later.length && `${names(heard.later)} will find it in their brief when they start`,
    heard.idle.length && `${names(heard.idle)} will see it on their next turn`,
    heard.closing.length && `${names(heard.closing)} ${are(heard.closing, 'is', 'are')} writing up a hand-off, so it is only in the team chat`,
    heard.done.length && `${names(heard.done)} ${are(heard.done, 'has', 'have')} finished`
  ].filter(Boolean);
  return {
    content: `Sent to ${toId ? nameOf(toId) : 'the team'}: ${parts.join('; ') || 'it is in the team chat'}.${heard.now.length ? ' Carry on with your own work; a reply arrives here as a message.' : ''}`,
    post
  };
}

/** What a task's owner starts with: what was said to them, or to everyone, before they began. */
export function notesFor(team: Team, ownerId: string): string {
  const mine = (team.channel ?? []).filter((p) => p.fromId !== ownerId && (!p.toId || p.toId === ownerId));
  if (!mine.length) return '';
  const shown = mine.slice(-BRIEF_POSTS);
  return [
    `Notes from your team${shown.length < mine.length ? ` (the latest ${shown.length} of ${mine.length})` : ''}; reply with message_team if someone needs an answer:`,
    ...shown.map((p) => `- ${nameOf(p.fromId)}${p.toId ? ' to you' : ' to everyone'}: ${clip(p.text, BRIEF_POST_LIMIT)}`)
  ].join('\n');
}

/** The lead's view of the chat for their next turn: the latest few posts, until the team is finished. */
export function chatBlock(team: Team, limit = 5): string {
  const channel = team.channel ?? [];
  if (!channel.length || team.status === 'done' || team.status === 'discarded') return '';
  return [
    `Team chat (latest ${Math.min(limit, channel.length)} of ${channel.length}):`,
    ...channel
      .slice(-limit)
      .map((p) => `- ${nameOf(p.fromId)} to ${p.toId ? (p.toId === team.leadId ? 'you' : nameOf(p.toId)) : 'everyone'}: ${clip(p.text, 300)}`)
  ].join('\n');
}

/** A teammate who is working on this team's task right now, for a hint to the one asking them a question. */
export function workingTask(team: Team, colleagueId: string): TeamAssignment | undefined {
  return team.plan?.assignments.find((a) => a.ownerId === colleagueId && a.status === 'working');
}

/** Messages that reached a task as it was finishing, put to it as a follow-up. */
export function lateMessages(messages: string[]): string {
  return [
    'These messages reached you as you were finishing:',
    ...messages,
    'Take them into account, and reply with message_team if a teammate needs an answer. Then end again with your complete hand-off: what you did, where it is, and anything the next person must know.'
  ].join('\n\n');
}
