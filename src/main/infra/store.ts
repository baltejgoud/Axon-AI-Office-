import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logging';

const log = createLogger('store');

/**
 * Generic JSON document store — the single persistence driver for the whole
 * application. Characteristics:
 *  - Atomic writes (tmp file + rename) so a crash never corrupts data.
 *  - Debounced, coalesced flushes via `debouncedSave` for hot collections.
 *  - In-memory read model: every repository serves queries straight from RAM.
 *  - Driver-based: replacing this with SQLite only requires re-implementing
 *    this class; no repository or service code changes.
 */
export class JsonStore {
  private readonly dir: string;
  private readonly data = new Map<string, unknown>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** Load a collection (or initialize it). */
  load<T>(file: string, initial: T): T {
    if (this.data.has(file)) return this.data.get(file) as T;
    const path = join(this.dir, file);
    let value: T = initial;
    if (existsSync(path)) {
      try {
        value = JSON.parse(readFileSync(path, 'utf8')) as T;
      } catch {
        /* fall through to re-read below */
      }
    }
    this.data.set(file, value);
    return value;
  }

  /** Synchronous boot-time load used during window startup. */
  loadSync<T>(file: string, initial: T): T {
    if (this.data.has(file)) return this.data.get(file) as T;
    const path = join(this.dir, file);
    let value: T = initial;
    if (existsSync(path)) {
      try {
        value = JSON.parse(readFileSync(path, 'utf-8')) as T;
      } catch (err) {
        log.warn(`failed to parse ${file}; starting fresh`, err);
        // preserve the corrupt file for forensics
        try {
          renameSync(path, `${path}.corrupt-${Date.now()}`);
        } catch {
          /* ignore */
        }
      }
    }
    this.data.set(file, value);
    return value;
  }

  get<T>(file: string): T {
    return this.data.get(file) as T;
  }

  /** Persist immediately. */
  async save<T>(file: string, value: T): Promise<void> {
    this.data.set(file, value);
    const pending = this.pending.get(file);
    if (pending) await pending;
    await this.writeToDisk(file, value);
  }

  /** Coalesced write — safe to call on every mutation from hot paths. */
  debouncedSave<T>(file: string, value: T, delayMs = 400): void {
    this.data.set(file, value);
    const existing = this.timers.get(file);
    if (existing) clearTimeout(existing);
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file);
        void this.writeToDisk(file, value).catch((err) => log.error(`flush failed for ${file}`, err));
      }, delayMs)
    );
  }

  /** Force-flush everything (used before app quit). */
  async flushAll(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const jobs: Promise<void>[] = [];
    for (const [file, value] of this.data.entries()) {
      jobs.push(this.writeToDisk(file, value));
    }
    await Promise.allSettled(jobs);
  }

  private async writeToDisk<T>(file: string, value: T): Promise<void> {
    const path = join(this.dir, file);
    const snapshot = JSON.stringify(value, null, 2);
    const prev = this.pending.get(file) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      const tmp = `${path}.tmp-${process.pid}`;
      await writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, path);
    });
    this.pending.set(file, run);
    try { await run; }
    finally { if (this.pending.get(file) === run) this.pending.delete(file); }
  }
}
