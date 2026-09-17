import { join } from 'node:path';
import type { UtilityProcess } from 'electron';
import { utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import type { KnowledgeChunk, KnowledgeDoc } from '../shared/types';
import { createLogger } from './infra/logging';

const log = createLogger('parse-pool');
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type WorkerEntry = { proc: UtilityProcess; pending: Map<string, Pending> };

/**
 * Round-robin pool of utilityProcess workers running the untrusted document
 * parsers. Requests carry a 30s timeout; a crashed or timed-out worker is
 * abandoned (pending jobs rejected) and a fresh one spawns on next use.
 */
export class ParsePool {
  private readonly workers: WorkerEntry[] = [];
  private next = 0;
  constructor(private readonly workerPath: string, private readonly size = 2) {}

  extract(path: string): Promise<string> {
    return this.request<string>('extract', path);
  }

  ingest(path: string): Promise<{ doc: import('../shared/types').KnowledgeDoc; chunks: KnowledgeChunk[] }> {
    return this.request('ingest', path);
  }

  destroy(): void {
    for (const entry of this.workers) {
      for (const job of entry.pending.values()) { clearTimeout(job.timer); job.reject(new Error('Application is closing.')); }
      entry.proc.kill();
    }
    this.workers.length = 0;
  }

  private request<T>(op: 'extract' | 'ingest', path: string): Promise<T> {
    const entry = this.acquire(), id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        entry.proc.kill();
        this.workers.splice(this.workers.indexOf(entry), 1);
        reject(new Error('Document parsing timed out. Try a smaller file.'));
      }, 30000);
      entry.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      entry.proc.postMessage({ id, op, path });
    });
  }

  private acquire(): WorkerEntry {
    let entry = this.workers[this.next % this.size];
    if (!entry) {
      const proc = utilityProcess.fork(join(__dirname, 'parse-worker.js'), [], { serviceName: 'axon-parser' });
      entry = { proc, pending: new Map() };
      proc.on('message', (message: { id: string; error?: string; text?: string; doc?: import('../shared/types').KnowledgeDoc; chunks?: KnowledgeChunk[] }) => {
        const job = entry!.pending.get(message.id);
        if (!job) return;
        entry!.pending.delete(message.id);
        clearTimeout(job.timer);
        if (message.error) job.reject(new Error(message.error));
        else if (message.doc && message.chunks) job.resolve({ doc: message.doc, chunks: message.chunks });
        else if (typeof message.text === 'string') job.resolve(message.text);
        else job.reject(new Error('Malformed parser response.'));
      });
      proc.on('exit', code => {
        for (const job of entry!.pending.values()) { clearTimeout(job.timer); job.reject(new Error(`Document parser stopped unexpectedly (${code}).`)); }
        entry!.pending.clear();
        const index = this.workers.indexOf(entry!);
        if (index >= 0) this.workers.splice(index, 1);
        log.warn(`parser worker exited (${code}); a replacement spawns on next use`);
      });
      this.workers.push(entry);
    }
    this.next = (this.next + 1) % this.size;
    return entry;
  }
}
