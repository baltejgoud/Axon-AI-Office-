import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, relative, sep } from 'node:path';
import type { Project } from '../project';

/**
 * Deleting and moving files for a coworker. Every check here runs before anyone is asked to approve
 * (the plan), and again when the call runs, so what you approve is exactly what happens.
 */

/** How much of a file the approval card shows. */
const PREVIEW_LINES = 12;
const PREVIEW_LINE_CHARS = 160;

/** The project's own words for what went wrong, in plain English for the model to pass on. */
function reason(error: unknown, path: string, doing: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return `${path} doesn't exist.`;
  if (code === 'ENOTDIR') return `${path} goes through something that isn't a folder.`;
  if (/outside project/i.test(message)) return `${path} is outside the project folder, so it can't be ${doing}.`;
  if (/Sensitive or unsupported/i.test(message))
    return `${path} is a kind of file Axon leaves alone (keys, passwords, pictures and similar), so it can't be ${doing}.`;
  if (/Symbolic links/i.test(message))
    return `${path} goes through a shortcut (a symbolic link or junction) that Axon won't follow, so it can't be ${doing}.`;
  if (/Choose a project/i.test(message)) return 'No project folder is open.';
  return `${path} can't be ${doing}: ${message}`;
}

const isGit = (part: string) => part.trim().toLowerCase() === '.git';
const gitRefusal = (doing: string) => `The .git folder holds the project's history, so nothing in it can be ${doing}.`;

/**
 * Whether a path goes through a .git folder however it is spelled: the project already turns away
 * ".git", but a disk that ignores letter case also answers to ".GIT", and Windows to "GIT~1". The real
 * path on disk (or, for a place that isn't there yet, its nearest folder that is) tells them all apart.
 */
async function throughGit(root: string, target: string): Promise<boolean> {
  let existing = target;
  const tail: string[] = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) break;
      tail.unshift(basename(existing));
      existing = parent;
    }
  }
  let real = root;
  try {
    real = await realpath(root);
  } catch {
    // Judged by the path as given, below.
  }
  const parts = [
    ...relative(real, existing).split(sep),
    ...tail,
    ...relative(root, target).split(sep)
  ];
  return parts.some(isGit);
}

/** The place a path names inside the project, or why these tools won't touch it. */
async function place(
  project: Project,
  raw: unknown,
  doing: string,
  create: boolean
): Promise<{ error: string } | { path: string; target: string }> {
  if (!project.root) return { error: 'No project folder is open.' };
  if (typeof raw !== 'string' || !raw.trim()) return { error: 'Give the path of the file as text.' };
  if (raw.split(/[\\/]/).some(isGit)) return { error: gitRefusal(doing) };
  let target: string;
  try {
    target = await project.safe(raw, create);
  } catch (error) {
    return { error: reason(error, raw, doing) };
  }
  if (await throughGit(project.root, target)) return { error: gitRefusal(doing) };
  return { path: raw, target };
}

/** A file's lines, counting a last line that has no newline after it. */
function lineCount(text: string): number {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface DeletePlan {
  path: string;
  /** The file's text, kept so Undo can put it back. */
  before: string;
  lines: number;
  bytes: number;
}

/** What deleting a file would do, or why it can't be done: files only, text Axon can keep a copy of. */
export async function planDelete(project: Project, raw: unknown): Promise<{ error: string } | DeletePlan> {
  const spot = await place(project, raw, 'deleted', false);
  if ('error' in spot) return spot;
  const { path, target } = spot;
  let bytes: number;
  try {
    const info = await lstat(target);
    if (info.isDirectory())
      return { error: `${path} is a folder. delete_file only removes single files, one at a time.` };
    if (!info.isFile()) return { error: `${path} isn't an ordinary file, so it can't be deleted.` };
    bytes = info.size;
  } catch (error) {
    return { error: reason(error, path, 'deleted') };
  }
  let before: string;
  try {
    before = await project.read(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/1 MB|Binary/i.test(message))
      return {
        error: `${path} is over 1 MB or isn't plain text, so Axon couldn't keep a copy to bring it back with Undo. It was not deleted. Tell the user, who can delete it themselves.`
      };
    return { error: reason(error, path, 'deleted') };
  }
  return { path, before, lines: lineCount(before), bytes };
}

/** The approval card's text: a headline, then the file's first lines so you can see what goes. */
export function deletePreview(plan: DeletePlan): string {
  const headline = `Delete ${plan.path} (${plan.lines === 0 ? 'empty' : `${plan.lines} ${plan.lines === 1 ? 'line' : 'lines'}`}, ${sizeOf(plan.bytes)})`;
  const shown = plan.before
    .replace(/\n$/, '')
    .split('\n')
    .slice(0, PREVIEW_LINES)
    .map((line) => (line.length > PREVIEW_LINE_CHARS ? `${line.slice(0, PREVIEW_LINE_CHARS - 1)}…` : line));
  const more = plan.lines - shown.length;
  return [headline, ...(plan.lines ? ['', ...shown] : []), ...(more > 0 ? [`… and ${more} more ${more === 1 ? 'line' : 'lines'}`] : [])].join('\n');
}

export interface MovePlan {
  from: string;
  to: string;
  /** The file stays in its folder and only its name changes. */
  rename: boolean;
  /** Folders on the way that don't exist yet and will be made. */
  makes: boolean;
}

const slashes = (path: string) => path.replace(/\\/g, '/');

/** What moving a file would do, or why it can't be done: a file to a place nothing is at yet, inside the project. */
export async function planMove(
  project: Project,
  rawFrom: unknown,
  rawTo: unknown
): Promise<{ error: string } | MovePlan> {
  const source = await place(project, rawFrom, 'moved', false);
  if ('error' in source) return source;
  const destination = await place(project, rawTo, 'moved', true);
  if ('error' in destination) return destination;
  try {
    const info = await lstat(source.target);
    if (info.isDirectory())
      return { error: `${source.path} is a folder. move_file only moves single files, one at a time.` };
    if (!info.isFile()) return { error: `${source.path} isn't an ordinary file, so it can't be moved.` };
  } catch (error) {
    return { error: reason(error, source.path, 'moved') };
  }
  if (source.target === destination.target)
    return { error: `${source.path} is already there. Give a different place or name.` };
  // A change of letter case only (Readme.md to README.md) is the same file by another name; the project checks it is.
  const caseOnly = source.target.toLowerCase() === destination.target.toLowerCase();
  const taken = await lstat(destination.target).then(
    () => true,
    () => false
  );
  if (taken && !caseOnly)
    return {
      error: `${destination.path} already exists, and moving ${source.path} there would replace it. Nothing was moved. Pick a name nothing is using.`
    };
  const parentThere = await lstat(dirname(destination.target)).then(
    () => true,
    () => false
  );
  return {
    from: source.path,
    to: destination.path,
    rename: dirname(slashes(source.path)) === dirname(slashes(destination.path)),
    makes: !parentThere
  };
}

/** The approval card's text: what moves where. */
export function movePreview(plan: MovePlan): string {
  return [
    `${plan.rename ? 'Rename' : 'Move'} ${slashes(plan.from)} → ${slashes(plan.to)}`,
    ...(plan.makes ? ['', `Makes the folder ${slashes(dirname(slashes(plan.to)))}/ first.`] : [])
  ].join('\n');
}
