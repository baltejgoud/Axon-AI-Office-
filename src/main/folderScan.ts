import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** File types the Library can read (same set as the file picker). */
export const DOCUMENT_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'xls', 'ts', 'js', 'py', 'json'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', 'venv']);
const MAX_DEPTH = 8;

/**
 * Every supported document under a folder, sub-folders included. Hidden folders (.git, .venv),
 * dependency and build folders are skipped; links are not followed. Stops at `limit` files.
 */
export async function scanFolder(root: string, limit: number): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const wanted = new Set(DOCUMENT_EXTENSIONS.map((e) => `.${e}`));
  let truncated = false;
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && wanted.has(extname(entry.name).toLowerCase())) {
        if (files.length >= limit) { truncated = true; return; }
        files.push(join(dir, entry.name));
      }
    }
  };
  await walk(root, 0);
  return { files, truncated };
}
