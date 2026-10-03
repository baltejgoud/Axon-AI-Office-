/**
 * Guard for whole-file writes.
 *
 * `write_file` replaces a file's entire contents. When a model miscounts or truncates what it
 * is echoing back, the lines it dropped are gone, and the damage looks like an ordinary edit in
 * the transcript. Two cheap, pure checks run against every write before it touches disk:
 *
 * - `assessWrite` refuses a write that removes far more lines than it adds, and points the model
 *   at a targeted edit instead.
 * - `preserveTrailingNewline` puts back the final newline a model forgets to send, so whole-file
 *   writes stop showing up as "\ No newline at end of file" noise on an otherwise untouched line.
 *
 * Both are pure functions of their arguments: no filesystem, no Electron, no clock, no network.
 * They read counts only, never the diff hunks, because hunks are dropped for new and very large
 * changes (diff.ts) and a guard that goes quiet on the biggest writes is no guard at all.
 */

/** What the caller should do with the write. `reason` is present exactly when the action is `block`. */
export type WriteVerdict = {
  action: 'allow' | 'block';
  /** Model-facing text for a block. Never model-facing for an allow, so nothing reads as a warning. */
  reason?: string;
};

/** Removals allowed on their own, before the write has to account for anything it adds. */
const REMOVAL_ALLOWANCE = 20;

/** How many removals each added line buys. Four is loose enough for a genuine refactor. */
const REMOVALS_PER_ADDED_LINE = 4;

/**
 * Decide whether a whole-file write is proportionate to what it changed.
 *
 * `added` and `removed` are LINE counts, matching `FileChange.added` / `.removed` from diff.ts
 * (see `fileChange`). Order of the rules matters: `created` is checked first, because a brand new
 * file legitimately has zero removals but also may have hundreds of lines.
 *
 * The shape of the rule is "is this a rewrite or an edit?". A write that removes at most
 * `added * 4 + 20` lines is an edit; anything beyond that is a rewrite, and a rewrite by a model
 * that cannot see its own output reliably eats unrelated code.
 *
 * @example
 * assessWrite({ created: false, added: 1, removed: 1 });      // { action: 'allow' }
 * assessWrite({ created: false, added: 3, removed: 30 });     // { action: 'allow' }  (30 <= 32)
 * assessWrite({ created: false, added: 5, removed: 60 });     // { action: 'block', reason: ... }
 */
export function assessWrite(change: { created: boolean; added: number; removed: number }): WriteVerdict {
  const added = countOf(change.added);
  const removed = countOf(change.removed);

  // A new file removes nothing by definition, so it is always an intended write.
  if (change.created) return { action: 'allow' };

  // Small edits pass whatever they add.
  if (removed <= REMOVAL_ALLOWANCE) return { action: 'allow' };

  // A rewrite that also rewrites everything else: allow, but only if it explains its removals.
  const allowance = added * REMOVALS_PER_ADDED_LINE + REMOVAL_ALLOWANCE;
  if (removed <= allowance) return { action: 'allow' };

  return {
    action: 'block',
    reason:
      `Blocked: this write deletes ${removed} lines of an existing file but adds only ${added}, ` +
      `and a write of this size is allowed to delete up to ${allowance} (${added} added x ${REMOVALS_PER_ADDED_LINE} + ${REMOVAL_ALLOWANCE}). ` +
      'Writing a whole file this way has silently dropped unrelated lines before, so it was not applied. ' +
      'Use edit_file to make a targeted edit instead — it changes only the lines you name and leaves the rest of the file alone. ' +
      'If you really do need to replace the file, read it again, keep every existing line you are not deliberately changing, ' +
      'and make the change in a smaller write.'
  };
}

/** Counts arrive from the diff layer: ignore a missing, negative, fractional or NaN value. */
function countOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Put back the final newline a whole-file write forgot.
 *
 * Models reliably drop the last newline when they re-emit a file, which dirties the diff for a
 * file whose contents never really changed, and turns every `.gitattributes`/prettier/CI check
 * that cares about a trailing newline red for the wrong reason.
 *
 * The line ending copied is the one already used by `oldText` (CRLF stays CRLF, LF stays LF), so
 * this cannot silently rewrite the endings of the lines it did not touch.
 *
 * @example
 * preserveTrailingNewline('a\nb\n', 'a\nb');       // 'a\nb\n'
 * preserveTrailingNewline('a\r\nb\r\n', 'a\nb');   // 'a\nb\r\n'  (CRLF preserved)
 * preserveTrailingNewline('a\nb', 'a\nb\n');       // 'a\nb\n'     (already had one; left alone)
 */
export function preserveTrailingNewline(oldText: string, newText: string): string {
  // An empty old file says nothing about endings, and an empty new file has nothing to terminate.
  if (!oldText || !newText) return newText;

  const crlf = oldText.includes('\r\n');
  const eol = crlf ? '\r\n' : '\n';

  // Files that end without a newline keep ending without one.
  if (!endsWith(oldText, eol)) return newText;
  // The write already terminates the file: leave it exactly as sent, never a second newline.
  if (endsWith(newText, eol)) return newText;

  return newText + eol;
}

/** `text` ends with `suffix`. `endsWith` alone would call "a\r\n" a match for a "\n" test. */
function endsWith(text: string, suffix: string): boolean {
  return text.length >= suffix.length && text.slice(-suffix.length) === suffix;
}