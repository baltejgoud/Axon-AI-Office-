import { READ_ONLY_TOOLS } from './officeTools';

/**
 * The most of one tool result a model is sent. A command that printed megabytes once filled a
 * run's context and the provider refused the request; the start of the output is what matters.
 */
export const TOOL_RESULT_LIMIT = 30_000;

/** A tool result as the model gets it: whole, or its start and a note on what was left out. */
export function capToolResult(content: string, limit = TOOL_RESULT_LIMIT): string {
  if (content.length <= limit) return content;
  const left = content.length - limit;
  return `${content.slice(0, limit)}\n\n[${left.toLocaleString('en-US')} more characters cut. If you need them, read a narrower part: one file, a line range, or a filtered command.]`;
}

/** Lookups that change nothing, so running one again with the same input can only return the same. */
const LOOKUPS: ReadonlySet<string> = new Set([...READ_ONLY_TOOLS, 'find_people']);

/** Arguments in one form whatever their key order, so the same lookup is recognised. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(typeof value === 'string' ? value.trim() : value) ?? 'null';
}

/**
 * One run's memory of the lookups it already made. Weaker models repeat the same search three or
 * four times in a row; the repeat is answered with a pointer to the first result instead of running.
 */
export class RepeatGuard {
  private readonly done = new Set<string>();

  /** What to tell the model instead of running a lookup it already made in this run; null to run it. */
  repeat(name: string, args: Record<string, unknown>): string | null {
    if (!LOOKUPS.has(name) || !this.done.has(`${name}:${canonical(args)}`)) return null;
    return `Already done in this task: ${name} with this same input. Its result is above. Use it, or look up something different.`;
  }

  /** Records a lookup that succeeded; one that failed may be tried again. */
  remember(name: string, args: Record<string, unknown> | null): void {
    if (LOOKUPS.has(name) && args) this.done.add(`${name}:${canonical(args)}`);
  }
}
