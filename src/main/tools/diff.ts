import type { FileChange } from '../../shared/types';

type DiffOp = { type: 'keep' | 'del' | 'add'; text: string };

/** Line-by-line edit script (longest common subsequence), or null when the files are too large to compare. */
function lineDiff(oldLines: string[], newLines: string[]): DiffOp[] | null {
  const m = oldLines.length;
  const n = newLines.length;
  if (m * n >= 1_000_000) return null;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m, j = n;
  const diffList: DiffOp[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diffList.push({ type: 'keep', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffList.push({ type: 'add', text: newLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diffList.push({ type: 'del', text: oldLines[i - 1] });
      i--;
    }
  }

  return diffList.reverse();
}

/**
 * Lightweight unified diff generator for tool approval previews.
 */
export function createUnifiedDiff(filePath: string, oldText: string, newText: string): string {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];

  if (oldText === newText) {
    return 'No changes.';
  }

  const m = oldLines.length;
  const n = newLines.length;
  const diffList = lineDiff(oldLines, newLines);

  if (diffList) {
    const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${m} +1,${n} @@\n`;
    const body = diffList
      .map(d => (d.type === 'add' ? `+${d.text}` : d.type === 'del' ? `-${d.text}` : ` ${d.text}`))
      .join('\n');
    return header + body;
  }

  return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${m} +1,${n} @@\n[File modified: ${m} lines -> ${n} lines]`;
}

/** Hunks larger than this are left out of a saved change; the counts still say how big it was. */
const HUNKS_LIMIT = 60_000;

/**
 * What a write changed, for the window: lines added and removed, and unified-diff hunks with
 * `context` unchanged lines around each change. New files and very large changes carry counts only.
 */
export function fileChange(oldText: string | null, newText: string, context = 3): FileChange {
  const newLines = newText ? newText.split('\n') : [];
  if (oldText === null) return { added: newLines.length, removed: 0, created: true };
  const oldLines = oldText ? oldText.split('\n') : [];
  const ops = lineDiff(oldLines, newLines);
  if (!ops) {
    // Too large to compare line by line: count lines that appear on one side more often than the other.
    const counts = new Map<string, number>();
    for (const line of oldLines) counts.set(line, (counts.get(line) ?? 0) + 1);
    let added = 0;
    for (const line of newLines) {
      const left = counts.get(line) ?? 0;
      if (left > 0) counts.set(line, left - 1);
      else added++;
    }
    return { added, removed: oldLines.length - (newLines.length - added), created: false };
  }

  const rows: (DiffOp & { a: number; b: number })[] = [];
  let a = 1, b = 1;
  for (const op of ops) {
    rows.push({ ...op, a, b });
    if (op.type !== 'add') a++;
    if (op.type !== 'del') b++;
  }
  const changed = rows.flatMap((row, index) => (row.type === 'keep' ? [] : [index]));
  const out: string[] = [];
  for (let k = 0; k < changed.length; k++) {
    const start = Math.max(0, changed[k] - context);
    let end = Math.min(rows.length - 1, changed[k] + context);
    // Changes close enough to share context become one hunk.
    while (k + 1 < changed.length && changed[k + 1] - context <= end + 1) {
      k++;
      end = Math.min(rows.length - 1, changed[k] + context);
    }
    const slice = rows.slice(start, end + 1);
    const olds = slice.filter(row => row.type !== 'add');
    const news = slice.filter(row => row.type !== 'del');
    const oldStart = olds.length ? olds[0].a : slice[0].a - 1;
    const newStart = news.length ? news[0].b : slice[0].b - 1;
    out.push(`@@ -${oldStart},${olds.length} +${newStart},${news.length} @@`);
    for (const row of slice) out.push((row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ') + row.text);
  }
  const hunks = out.join('\n');
  return {
    added: rows.filter(row => row.type === 'add').length,
    removed: rows.filter(row => row.type === 'del').length,
    created: false,
    ...(hunks && hunks.length <= HUNKS_LIMIT ? { hunks } : {})
  };
}
