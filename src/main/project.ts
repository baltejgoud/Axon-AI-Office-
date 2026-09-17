import { lstat, realpath, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, extname } from 'node:path';
const excluded = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'vendor', '.venv', '.ssh', '.aws']);
export function allowedName(name: string): boolean {
  return !excluded.has(name) && !/^\.env($|\.)/i.test(name) && !/\.(pem|key|pfx|p12|exe|dll|zip|png|jpg|jpeg|gif|ico|mp4|pdf|docx|xlsx)$/i.test(name);
}
export function within(root: string, path: string): boolean {
  const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
export class Project {
  root: string | null = null;
  async choose(path: string): Promise<void> { this.root = await realpath(path); }
  async safe(path: string, create = false): Promise<string> {
    if (!this.root) throw new Error('Choose a project first.');
    const target = resolve(this.root, path);
    if (!within(this.root, target) || target === this.root || path.includes(':')) throw new Error('Path outside project.');
    const parts = relative(this.root, target).split(/[\\/]/);
    if (parts.some(p => !allowedName(p))) throw new Error('Sensitive or unsupported path.');
    let current = this.root;
    for (const part of parts) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || !within(this.root, await realpath(current))) throw new Error('Symbolic links and junctions are not permitted.');
      } catch (error) { if (create && (error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
    }
    return target;
  }
  async list(): Promise<string[]> {
    if (!this.root) return [];
    const root = this.root, files: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 15 || files.length >= 5000) return;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (files.length >= 5000) break;
        if (!allowedName(entry.name) || entry.isSymbolicLink()) continue;
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(path, depth + 1);
        else if (entry.isFile()) files.push(relative(root, path).replace(/\\/g, '/'));
      }
    };
    await walk(root, 0); return files.sort();
  }
  async read(path: string): Promise<string> {
    const target = await this.safe(path);
    if ((await lstat(target)).size > 1_000_000) throw new Error('File exceeds the 1 MB editor limit.');
    const text = await readFile(target, 'utf8');
    if (text.includes('\0')) throw new Error('Binary files are not supported.');
    return text;
  }
  async write(path: string, text: string): Promise<void> {
    if (text.length > 1_000_000) throw new Error('File too large.');
    const target = await this.safe(path, true);
    await mkdir(dirname(target), { recursive: true });
    await this.safe(path, true);
    await writeFile(target, text, 'utf8');
  }
  async search(query: string): Promise<{ path: string; line: number; text: string }[]> {
    if (!query.trim()) return [];
    const hits: { path: string; line: number; text: string }[] = [];
    for (const path of await this.list()) {
      try { (await this.read(path)).split('\n').forEach((text, i) => {
        if (hits.length < 150 && text.toLowerCase().includes(query.toLowerCase())) hits.push({ path, line: i + 1, text: text.slice(0, 250) });
      }); } catch { /* Skip unsupported/unreadable files. */ }
      if (hits.length >= 150) break;
    }
    return hits;
  }
}
