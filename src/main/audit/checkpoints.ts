import { mkdirSync } from 'node:fs';
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** The version a write replaced, so you can undo it. */
export interface Checkpoint {
  toolCallId: string;
  conversationId: string;
  /** The project folder it was written in, and the path inside it. */
  root: string;
  path: string;
  /** Whether the file was there before; with no `before`, it was but couldn't be read. */
  existed: boolean;
  before?: string;
  /** What the write left, to tell whether the file has changed since. */
  afterHash: string;
  savedAt: number;
}

export const CHECKPOINTS_KEPT = 500;
export const CHECKPOINT_BYTES = 200 * 1024 * 1024;
export const hashText = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** One file per checkpoint, named by a hash of its tool call: provider ids never become paths. */
export class Checkpoints {
  constructor(
    private readonly dir: string,
    private readonly limits = { count: CHECKPOINTS_KEPT, bytes: CHECKPOINT_BYTES },
    private readonly now: () => number = Date.now
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private fileOf(toolCallId: string): string {
    return join(this.dir, `${createHash('sha1').update(toolCallId).digest('hex')}.json`);
  }

  /** Keeps a checkpoint and prunes the oldest; false when it couldn't be kept. */
  async save(point: Omit<Checkpoint, 'savedAt'>): Promise<boolean> {
    try {
      await writeFile(this.fileOf(point.toolCallId), JSON.stringify({ ...point, savedAt: this.now() }), 'utf8');
      await this.prune();
      return true;
    } catch {
      return false;
    }
  }

  async get(toolCallId: string): Promise<Checkpoint | null> {
    try {
      const point = JSON.parse(await readFile(this.fileOf(toolCallId), 'utf8')) as Checkpoint;
      return point.toolCallId === toolCallId && typeof point.root === 'string' && typeof point.path === 'string' ? point : null;
    } catch {
      return null;
    }
  }

  async remove(toolCallId: string): Promise<void> {
    try { await unlink(this.fileOf(toolCallId)); } catch { /* already gone */ }
  }

  /** Newest first by when each was saved; past the count or the bytes, the rest go. */
  private async prune(): Promise<void> {
    const files = await Promise.all((await readdir(this.dir)).filter((name) => name.endsWith('.json')).map(async (name) => {
      const path = join(this.dir, name);
      const info = await stat(path);
      let savedAt = info.mtimeMs;
      try { savedAt = (JSON.parse(await readFile(path, 'utf8')) as Checkpoint).savedAt ?? savedAt; } catch { /* keep the file time */ }
      return { path, size: info.size, savedAt };
    }));
    files.sort((a, b) => b.savedAt - a.savedAt);
    let count = 0, bytes = 0;
    for (const file of files) {
      count++;
      bytes += file.size;
      if (count > this.limits.count || bytes > this.limits.bytes) await unlink(file.path).catch(() => undefined);
    }
  }
}
