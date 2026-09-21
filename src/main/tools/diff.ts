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

  if (m * n < 1_000_000) {
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
    const diffList: { type: 'keep' | 'del' | 'add'; text: string }[] = [];

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

    diffList.reverse();

    const header = `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${m} +1,${n} @@\n`;
    const body = diffList
      .map(d => (d.type === 'add' ? `+${d.text}` : d.type === 'del' ? `-${d.text}` : ` ${d.text}`))
      .join('\n');
    return header + body;
  }

  return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,${m} +1,${n} @@\n[File modified: ${m} lines -> ${n} lines]`;
}
