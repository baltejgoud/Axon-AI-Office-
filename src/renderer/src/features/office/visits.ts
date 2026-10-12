import type { TaskItem } from '../../../../shared/types';

/**
 * Who walks over to whom while a colleague is asked a question. Pure, so the pairing can be tested
 * without a scene.
 *
 * `ask_colleague` records a help task for the colleague who is being asked: `coworkerId` is the one
 * answering, `forCoworkerId` the one who asked. The asker is waiting on the answer, so the asker is
 * the visitor: they get up, walk to the answerer's desk, and walk back when the answer is in.
 */
export interface Visit {
  /** The one who asked, and walks over. */
  visitor: string;
  /** The one who is asked, and answers from their desk. */
  host: string;
}

/**
 * A question takes seconds to minutes. A help record still "working" after this long is a leftover
 * (a crash mid-answer), not someone waiting at a desk.
 */
export const CONSULT_STALE_MS = 15 * 60_000;

/**
 * The visits going on now: one for each asker whose colleague is still writing the answer. A visit
 * ends the moment that answer is in (the help record is done), not when the asker's whole run is.
 * Someone asking two colleagues at once visits the one they asked first.
 */
export function consultVisits(tasks: readonly TaskItem[], now: number): Visit[] {
  const asks = tasks
    .filter(
      (task) =>
        task.kind === 'help' &&
        task.status === 'working' &&
        !!task.coworkerId &&
        !!task.forCoworkerId &&
        task.coworkerId !== task.forCoworkerId &&
        now - task.updatedAt < CONSULT_STALE_MS
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  const seen = new Set<string>();
  const visits: Visit[] = [];
  for (const ask of asks) {
    const visitor = ask.forCoworkerId!;
    if (seen.has(visitor)) continue;
    seen.add(visitor);
    visits.push({ visitor, host: ask.coworkerId! });
  }
  return visits;
}

/** What the director needs from the office: the scene's own `startHelp` and `endHelp`. */
export interface VisitWorld {
  /** Sends the visitor to the host's desk; false when they can't go yet (see the simulation). */
  startHelp(visitor: string, host: string): boolean;
  endHelp(visitor: string): void;
  /** False when nobody walks (reduced motion): the pairing is only shown, never retried. */
  readonly walks: boolean;
}

/**
 * Keeps the office's visits in step with the task records. A visit that can't start yet (the
 * desk's visiting spot is taken, the host is in a team's room) is not forgotten: `retry` asks
 * again until it does start or the question is answered.
 */
export class VisitDirector {
  private readonly current = new Map<string, { host: string; walking: boolean }>();

  constructor(private readonly world: VisitWorld) {}

  /** The visits that should be going now: end those that are over or changed, start new ones. */
  sync(visits: readonly Visit[]): void {
    const wanted = new Map(visits.map((visit) => [visit.visitor, visit.host]));
    for (const [visitor, entry] of [...this.current]) {
      if (wanted.get(visitor) === entry.host) continue;
      this.world.endHelp(visitor);
      this.current.delete(visitor);
    }
    for (const [visitor, host] of wanted) {
      if (this.current.has(visitor)) continue;
      // The first ask also marks the pair in the scene (the link between the two), walking or not.
      this.current.set(visitor, { host, walking: this.world.startHelp(visitor, host) });
    }
    this.retry();
  }

  /** Tries again for every visit that hasn't started walking. Cheap when there is nothing to do. */
  retry(): void {
    if (!this.world.walks) return;
    for (const [visitor, entry] of this.current)
      if (!entry.walking) entry.walking = this.world.startHelp(visitor, entry.host);
  }

  /** Visits going now, walking or not. */
  visits(): Visit[] {
    return [...this.current].map(([visitor, entry]) => ({ visitor, host: entry.host }));
  }

  /** Visits that asked to walk and haven't been able to yet. */
  waiting(): Visit[] {
    return this.world.walks
      ? [...this.current]
          .filter(([, entry]) => !entry.walking)
          .map(([visitor, entry]) => ({ visitor, host: entry.host }))
      : [];
  }
}
