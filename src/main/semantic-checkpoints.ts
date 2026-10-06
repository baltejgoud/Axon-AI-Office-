import { createHash } from 'node:crypto';
import type { Message, ChatRequestMessage } from '../shared/types';
import { checkpoint, type MemoryFact } from './context';
import { requestHistory } from './history';
const kinds = new Set(['constraint','decision','goal','rejected','completed','active','question','blocker','file','artifact','command','test','external','handoff']);
export const checkpointFingerprint = (messages: readonly Message[]) => createHash('sha256').update(JSON.stringify(messages.map(m => [m.id, m.content, m.role]))).digest('hex');
/** Accept only exact source excerpts. Every user paragraph is retained if classification misses it. */
export function validateSemanticFacts(messages: readonly Message[], candidate: unknown): MemoryFact[] {
  const history = requestHistory(messages);
  const groups: ChatRequestMessage[][] = [];
  const turnById = new Map<string, number>();
  for (const m of history) {
    if (m.role === 'user' || !groups.length) groups.push([]);
    groups[groups.length - 1].push(m);
    if (m.sourceMessageId) turnById.set(m.sourceMessageId, groups.length - 1);
  }
  const sources = new Map(messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => [m.id, { m, i: turnById.get(m.id) ?? 0 }]));
  const facts = checkpoint(groups).facts;
  if (Array.isArray(candidate)) for (const item of candidate) {
    if (!item || !kinds.has(item.kind) || typeof item.text !== 'string' || !item.text.trim()) continue;
    const source = sources.get(item.sourceMessageId);
    const content = source?.m.content.replace(/<attachment name=[^>]*>[\s\S]*?<\/attachment>/g, '');
    if (!source || !content?.includes(item.text)) continue;
    facts.push({ kind: item.kind, text: item.text, sourceMessageId: source.m.id, sourceTurn: source.i });
  }
  for (const { m, i } of sources.values()) if (m.role === 'user') {
    const content = m.content.replace(/<attachment name=[^>]*>[\s\S]*?<\/attachment>/g, '');
    for (const paragraph of content.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)) {
      if (!facts.some(f => f.sourceMessageId === m.id && f.text.includes(paragraph)))
        facts.push({ kind: 'constraint', text: paragraph, sourceMessageId: m.id, sourceTurn: i });
    }
  }
  return [...new Map(facts.map(f => [`${f.sourceMessageId}:${f.kind}:${f.text}`, f])).values()];
}
/** Coalesces independent background work; rejects stale completion and never mutates a live request. */
export class SemanticCheckpointScheduler {
  private controller = new AbortController();
  get signal() { return this.controller.signal; }
  private jobs = new Map<string, { timer?: ReturnType<typeof setTimeout>; running: boolean; rerun: boolean; task: () => Promise<void> }>();
  dispose() {
    this.controller.abort();
    for (const job of this.jobs.values()) { if (job.timer) clearTimeout(job.timer); job.rerun = false; }
    this.jobs.clear();
  }
  schedule(id: string, task: () => Promise<void>) {
    if (this.signal.aborted) return;
    const old = this.jobs.get(id);
    if (old?.running) { old.task = task; old.rerun = true; return; }
    if (old?.timer) clearTimeout(old.timer);
    const job = { running: false, rerun: false, task, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    job.timer = setTimeout(async () => {
      job.running = true;
      try { await job.task(); } catch (error) { console.error('Background checkpoint failed', error instanceof Error ? error.name : 'Error'); }
      finally { this.jobs.delete(id); if (job.rerun) this.schedule(id, job.task); }
    }, 250);
    job.timer.unref();
    this.jobs.set(id, job);
  }
}
