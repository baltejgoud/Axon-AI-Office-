import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { SUBJECT_MAX, inGroup, type AuditEntry, type AuditQuery } from '../../shared/audit';

/** Entries kept; past COMPACT_AT the file is rewritten with the newest AUDIT_KEPT. */
export const AUDIT_KEPT = 20_000;
export const COMPACT_AT = 25_000;
const DETAIL_MAX = 300;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** An entry as kept: only its known fields, cut to size. Nothing a tool wrote is ever stored. */
function kept(entry: AuditEntry): AuditEntry {
  const { id, at, conversationId, actor, tool, subject, decision, result, detail, toolCallId, change } = entry;
  return {
    id,
    at,
    ...(conversationId ? { conversationId } : {}),
    actor: {
      kind: actor.kind,
      name: cut(actor.name, 80),
      ...(actor.id ? { id: actor.id } : {}),
      ...(actor.onBehalfOf ? { onBehalfOf: cut(actor.onBehalfOf, 80) } : {})
    },
    tool: cut(tool, 120),
    subject: cut(subject ?? '', SUBJECT_MAX),
    decision,
    ...(result ? { result } : {}),
    ...(detail ? { detail: cut(detail, DETAIL_MAX) } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(change ? { change: { added: change.added, removed: change.removed, created: change.created } } : {})
  };
}

const valid = (entry: any): entry is AuditEntry =>
  !!entry && typeof entry.id === 'string' && typeof entry.at === 'number' && typeof entry.tool === 'string'
  && typeof entry.decision === 'string' && !!entry.actor && typeof entry.actor.name === 'string';

/**
 * The audit trail: an append-only JSON-lines file beside the saved state, so backups stay small and
 * restoring a snapshot never rewrites history. Each entry is one short line written as it happens
 * (so they stay in order, and none is lost to a crash); a failed write is logged, never thrown at a run.
 */
export class AuditLog {
  private entries: AuditEntry[];
  private readonly file: string;

  constructor(dir: string, private readonly now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'audit.jsonl');
    this.entries = this.load();
  }

  record(entry: Omit<AuditEntry, 'id' | 'at'>): AuditEntry {
    const full = kept({ ...entry, id: randomUUID(), at: this.now() } as AuditEntry);
    this.entries.push(full);
    try {
      if (this.entries.length > COMPACT_AT) {
        this.entries = this.entries.slice(-AUDIT_KEPT);
        writeFileSync(`${this.file}.tmp`, this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
        renameSync(`${this.file}.tmp`, this.file);
      } else appendFileSync(this.file, JSON.stringify(full) + '\n', 'utf8');
    } catch (error) {
      console.error('The audit log could not be written.', error);
    }
    return full;
  }

  /** Newest first, filtered, at most `limit` (100 by default, 500 at most). */
  list(query: AuditQuery = {}): AuditEntry[] {
    const limit = Math.max(1, Math.min(500, query.limit ?? 100));
    const found: AuditEntry[] = [];
    let started = !query.afterId;
    for (let i = this.entries.length - 1; i >= 0 && found.length < limit; i--) {
      const entry = this.entries[i];
      if (!started) {
        if (entry.id === query.afterId) started = true;
        continue;
      }
      if (query.conversationId && entry.conversationId !== query.conversationId) continue;
      if (query.actorId && entry.actor.id !== query.actorId) continue;
      if (!inGroup(entry, query.group)) continue;
      found.push(entry);
    }
    return found;
  }

  /** Everything kept, oldest first (for export). */
  all(): AuditEntry[] {
    return [...this.entries];
  }

  /** Resolves once every recorded entry is on disk (they are written as they are recorded). */
  flush(): Promise<void> {
    return Promise.resolve();
  }

  private load(): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const entries: AuditEntry[] = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (valid(entry)) entries.push(entry);
      } catch { /* A damaged line is skipped. */ }
    }
    return entries;
  }
}
