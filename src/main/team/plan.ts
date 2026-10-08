import type { Team, TeamAssignment, TeamPlan, TeamStatus } from '../../shared/types';

/** A team that is still going: it has a meeting, a plan waiting for you, or work under way. */
export const OPEN_TEAM: ReadonlySet<TeamStatus> = new Set(['meeting', 'planned', 'working', 'reporting']);
/** Statuses that need something running; after a restart nothing is. */
const RUNNING: ReadonlySet<TeamStatus> = new Set(['meeting', 'working', 'reporting']);

export const MAX_ASSIGNMENTS = 20;
/** Tasks running at once. */
export const MAX_PARALLEL = 3;
/** How much of an owner's final answer is handed on. */
export const RESULT_LIMIT = 4000;

/** After a restart: teams that were running are stopped, so Retry can carry them on. */
export function interruptTeams(teams: Team[], now: number): boolean {
  let changed = false;
  for (const team of teams) {
    if (!RUNNING.has(team.status)) continue;
    team.status = 'stopped';
    team.note = 'Axon closed while the team was working. Retry to carry on.';
    team.updatedAt = now;
    for (const a of team.plan?.assignments ?? [])
      if (a.status === 'working')
        Object.assign(a, { status: 'stopped', note: 'Axon closed while this was running' });
    changed = true;
  }
  return changed;
}

/** A project path as listings show it: slashes, no leading ./ or /. */
export function normalPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
    : [];

/** Every task each task waits for, directly or through others. A task in a loop waits for itself. */
function prerequisites(assignments: { id: string; dependsOn: string[] }[]): Map<string, Set<string>> {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  const all = new Map<string, Set<string>>();
  for (const start of assignments) {
    const seen = new Set<string>();
    const stack = [...start.dependsOn];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(byId.get(id)?.dependsOn ?? []));
    }
    all.set(start.id, seen);
  }
  return all;
}

/** Checks the lead's proposed plan against who is in the meeting, and makes it the team's plan. */
export function validatePlan(
  input: { summary?: unknown; assignments?: unknown },
  attendees: { id: string; name: string }[]
): { ok: true; plan: TeamPlan } | { ok: false; errors: string[] } {
  const raw = Array.isArray(input.assignments) ? (input.assignments as Record<string, unknown>[]) : [];
  if (!raw.length) return { ok: false, errors: ['The plan needs at least one task.'] };
  if (raw.length > MAX_ASSIGNMENTS)
    return { ok: false, errors: [`A plan has at most ${MAX_ASSIGNMENTS} tasks; merge some.`] };
  const errors: string[] = [];
  const ownerOf = (name: string) =>
    attendees.find((p) => p.id === name.toLowerCase() || p.name.toLowerCase() === name.toLowerCase())?.id ??
    null;
  const ids = new Set<string>();
  const assignments: TeamAssignment[] = raw.map((item, index) => {
    const id = text(item?.id) || `t${index + 1}`;
    if (ids.has(id)) errors.push(`The id ${id} is used twice; give every task its own.`);
    ids.add(id);
    const owner = text(item?.owner);
    const ownerId = ownerOf(owner);
    if (!ownerId)
      errors.push(
        `${id}: "${owner}" is not in this meeting. Owners must be attendees: ${attendees.map((p) => p.name).join(', ')}.`
      );
    const title = text(item?.title);
    const brief = text(item?.brief);
    if (!title || !brief) errors.push(`${id}: every task needs a title and a brief.`);
    return {
      id,
      ownerId: ownerId ?? owner,
      title,
      brief,
      dependsOn: [...new Set(strings(item?.depends_on))],
      files: [...new Set(strings(item?.files).map(normalPath))],
      ...(['fast', 'standard', 'deep', 'coding'].includes(String(item.profile))
        ? { profile: item.profile as TeamAssignment['profile'] }
        : {}),
      status: 'waiting' as const
    };
  });
  for (const a of assignments)
    for (const dep of a.dependsOn) {
      if (dep === a.id) errors.push(`${a.id} depends on itself.`);
      else if (!ids.has(dep)) errors.push(`${a.id} depends on ${dep}, which is not in the plan.`);
    }
  const before = prerequisites(assignments);
  for (const a of assignments)
    if (!a.dependsOn.includes(a.id) && before.get(a.id)?.has(a.id))
      errors.push(`${a.id} is in a dependency loop; tasks cannot wait for each other.`);
  // Two tasks that may run at the same time may not own the same file.
  for (let i = 0; i < assignments.length; i++)
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i];
      const b = assignments[j];
      if (before.get(a.id)?.has(b.id) || before.get(b.id)?.has(a.id)) continue;
      for (const file of a.files.filter((f) => b.files.includes(f)))
        errors.push(
          `${a.id} and ${b.id} both own ${file} but could run at the same time; make one wait for the other, or give the file to one of them.`
        );
    }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, plan: { summary: text(input.summary), assignments } };
}

/** Tasks that may start now: waiting, with every task they wait for done. */
export function readyAssignments<T extends Pick<TeamAssignment, 'id' | 'status' | 'dependsOn'>>(
  assignments: T[]
): T[] {
  const done = new Set(assignments.filter((a) => a.status === 'done').map((a) => a.id));
  return assignments.filter((a) => a.status === 'waiting' && a.dependsOn.every((d) => done.has(d)));
}

/** Waiting tasks that can never start, because something they wait for failed, stopped or is blocked. */
export function blockDependants(
  assignments: Pick<TeamAssignment, 'id' | 'status' | 'dependsOn' | 'note'>[]
): boolean {
  let changed = false;
  let again = true;
  while (again) {
    again = false;
    const dead = new Set(
      assignments
        .filter((a) => a.status === 'failed' || a.status === 'stopped' || a.status === 'blocked')
        .map((a) => a.id)
    );
    for (const a of assignments)
      if (a.status === 'waiting' && a.dependsOn.some((d) => dead.has(d))) {
        a.status = 'blocked';
        a.note = `Waiting for ${a.dependsOn.filter((d) => dead.has(d)).join(', ')}, which did not finish`;
        changed = again = true;
      }
  }
  return changed;
}

/** Where the work stands: all done, still going (running or able to start), or stuck on failures. */
export function progress(
  assignments: Pick<TeamAssignment, 'id' | 'status' | 'dependsOn'>[]
): 'done' | 'working' | 'stuck' {
  if (assignments.every((a) => a.status === 'done')) return 'done';
  if (assignments.some((a) => a.status === 'working') || readyAssignments(assignments).length)
    return 'working';
  return 'stuck';
}

/** Retry: what failed, stopped or was blocked goes back to waiting. */
export function resetForRetry(assignments: Pick<TeamAssignment, 'status' | 'note' | 'retryNote'>[]): number {
  let count = 0;
  for (const a of assignments)
    if (a.status === 'failed' || a.status === 'stopped' || a.status === 'blocked') {
      a.status = 'waiting';
      a.retryNote = a.note;
      a.note = undefined;
      count++;
    }
  return count;
}
