/** A project file handed to a coworker from the Files room. */
export interface HandedFile {
  path: string;
  content: string;
}

/** Most characters of one file sent with a task. */
const PER_FILE = 30000;
/** Most characters of file context in one task, across all files. */
const TOTAL = 100000;

/** The task text followed by each handed file, labelled with its path and cut to fit the budget. */
export function withFileContext(text: string, files: readonly HandedFile[]): string {
  let budget = TOTAL;
  const blocks: string[] = [];
  for (const file of files) {
    if (budget <= 0) break;
    const limit = Math.min(PER_FILE, budget);
    const cut = file.content.length > limit;
    const body = cut
      ? `${file.content.slice(0, limit)}\n[truncated: showing ${limit} of ${file.content.length} characters]`
      : file.content;
    budget -= Math.min(file.content.length, limit);
    blocks.push(`<file path="${file.path}">\n${body}\n</file>`);
  }
  return blocks.length ? `${text}\n\n${blocks.join('\n\n')}` : text;
}
