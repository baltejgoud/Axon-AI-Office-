import type { Project } from '../project';
import type { Checkpoint } from './checkpoints';

/**
 * Undo for the changes that are more than a save: a file deleted, or moved. Each is reversed through
 * the project's own checked methods, so it can only touch the project the change was made in, and a
 * move is never put back over another file.
 */

const sameName = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** The tool a kept change came from, for the activity log. */
export const toolOfPoint = (point: Checkpoint): string =>
  point.kind === 'delete' ? 'delete_file' : point.kind === 'move' ? 'move_file' : 'write_file';

/** Why a move can't be put back (the file isn't there any more, or something else took its old place); null when it can. */
export async function blockedUndo(project: Project, point: Checkpoint): Promise<string | null> {
  if (point.kind !== 'move' || point.movedTo === undefined) return null;
  if (!(await project.exists(point.movedTo))) return `${point.movedTo} isn't there any more, so it can't be moved back.`;
  // On a disk that ignores letter case, the old name of a renamed file is the same file, not something else.
  if (!sameName(point.path, point.movedTo) && (await project.exists(point.path)))
    return `Something else is at ${point.path} now, so ${point.movedTo} can't be moved back there.`;
  return null;
}

/** Reverses one change. A save puts the earlier text back (or removes a file it created); a delete brings the file back; a move goes back. */
export async function undoOne(project: Project, point: Checkpoint): Promise<void> {
  if (point.kind === 'move') {
    const blocked = await blockedUndo(project, point);
    if (blocked) throw new Error(blocked);
    await project.move(point.movedTo!, point.path);
    return;
  }
  if (point.existed) {
    if (point.before === undefined) throw new Error("Axon couldn't keep this file's previous version.");
    await project.write(point.path, point.before);
  } else if (await project.exists(point.path)) await project.remove(point.path);
}

/**
 * Reverses a list of changes, newest first, so each file ends up where and as it was before the first
 * of them. One that can't be reversed is left and reported; the rest still are.
 */
export async function undoNewestFirst(
  project: Project,
  points: readonly Checkpoint[]
): Promise<{ done: Checkpoint[]; failed: { point: Checkpoint; error: Error }[] }> {
  const done: Checkpoint[] = [];
  const failed: { point: Checkpoint; error: Error }[] = [];
  for (const point of points) {
    try {
      await undoOne(project, point);
      done.push(point);
    } catch (error) {
      failed.push({ point, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return { done, failed };
}

/** One change in the confirmation's list. */
export function undoLine(point: Checkpoint): string {
  if (point.kind === 'delete') return `• ${point.path} (deleted: comes back)`;
  if (point.kind === 'move') return `• ${point.movedTo} (goes back to ${point.path})`;
  return `• ${point.path}${point.existed ? '' : ' (new file, deleted)'}`;
}
