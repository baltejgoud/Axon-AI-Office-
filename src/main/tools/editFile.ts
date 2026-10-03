/**
 * Targeted edit primitive: apply one literal string replacement to a file's text.
 *
 * This module is deliberately pure — no Electron, no `node:fs` — so the matching
 * rules are testable in isolation and shared by whichever tool wires them up.
 *
 * The contract:
 * - `oldString` is matched literally with `String.prototype.indexOf`, never RegExp.
 * - JSON-escaped sequences (a literal backslash-n, for example) are never unescaped.
 * - Unicode is never normalised (no NFC/NFD folding, no case folding).
 * - When the file text uses CRLF, both `oldString` and `newString` are normalised to
 *   CRLF before matching/replacing so an LF needle still hits, and the output keeps
 *   the file's own line endings.
 */

export type EditResult =
  | { ok: true; text: string; replacements: number }
  | { ok: false; reason: string };

/** Returns the file's line ending when it is CRLF, otherwise null (no normalisation). */
function crlfEol(text: string): '\r\n' | null {
  return text.includes('\r\n') ? '\r\n' : null;
}

/**
 * Converts lone `\n` characters to CRLF. Existing `\r\n` pairs, literal backslash-n
 * sequences, and every other character (including all Unicode) are left untouched.
 */
function toCrlf(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\n' && (i === 0 || value[i - 1] !== '\r')) {
      out += '\r\n';
    } else {
      out += ch;
    }
  }
  return out;
}

function countMatches(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}

function replaceEveryMatch(text: string, oldString: string, newString: string): string {
  let out = '';
  let last = 0;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(oldString, from);
    if (idx === -1) {
      out += text.slice(last);
      return out;
    }
    out += text.slice(last, idx) + newString;
    last = idx + oldString.length;
    from = last;
  }
}

/**
 * Applies `oldString -> newString` to `text`.
 *
 * - Rejects an empty `oldString` (that would otherwise loop forever or replace between
 *   every character).
 * - Rejects a no-op edit where `oldString === newString`.
 * - Fails with a reason when `oldString` is absent, or present more than once unless
 *   `replaceAll` is true.
 */
export function applyUniqueEdit(
  text: string,
  oldString: string,
  newString: string,
  replaceAll = false
): EditResult {
  if (oldString === '') {
    return { ok: false, reason: 'oldString must not be empty' };
  }
  if (oldString === newString) {
    return { ok: false, reason: 'oldString and newString must differ' };
  }

  const eol = crlfEol(text);
  const needle = eol === '\r\n' ? toCrlf(oldString) : oldString;
  const replacement = eol === '\r\n' ? toCrlf(newString) : newString;

  // After EOL normalisation the edit could still collapse to a no-op.
  if (needle === replacement) {
    return { ok: false, reason: 'oldString and newString must differ after normalising line endings' };
  }

  const count = countMatches(text, needle);
  if (count === 0) {
    return { ok: false, reason: 'oldString not found in text' };
  }
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      reason: `oldString matches ${count} times; add more surrounding context to make it unique`
    };
  }

  return { ok: true, text: replaceEveryMatch(text, needle, replacement), replacements: count };
}
