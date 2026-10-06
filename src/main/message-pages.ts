import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '../shared/types';
export interface MessagePageRef { hash: string; conversationId: string; count: number }
/** Immutable content-addressed pages: a platform snapshot commits their manifest atomically. */
export class MessagePages {
  constructor(private dir: string) { mkdirSync(dir, { recursive: true }); }
  private read(ref: MessagePageRef): Message[] {
    if (!/^[a-f0-9]{64}$/.test(ref.hash)) throw new Error('Invalid message page reference');
    const raw = readFileSync(join(this.dir, ref.hash + '.json'), 'utf8');
    if (createHash('sha256').update(raw).digest('hex') !== ref.hash) throw new Error('Message page checksum mismatch');
    const messages: Message[] = JSON.parse(raw);
    if (!Array.isArray(messages) || messages.length !== ref.count || messages.some(m => m.conversationId !== ref.conversationId || typeof m.id !== 'string' || typeof m.content !== 'string')) throw new Error('Invalid message page');
    return messages;
  }
  write(messages: readonly Message[]): MessagePageRef[] {
    const groups = new Map<string, Message[]>();
    for (const message of messages) { const group = groups.get(message.conversationId) ?? []; group.push(message); groups.set(message.conversationId, group); }
    const refs: MessagePageRef[] = [];
    for (const [conversationId, group] of groups) for (let i = 0; i < group.length; i += 100) {
      const page = group.slice(i, i + 100), raw = JSON.stringify(page);
      const hash = createHash('sha256').update(raw).digest('hex'), path = join(this.dir, hash + '.json');
      if (!existsSync(path)) { writeFileSync(path + '.tmp', raw, { mode: 0o600 }); renameSync(path + '.tmp', path); }
      refs.push({ hash, conversationId, count: page.length });
    }
    return refs;
  }
  all(refs: readonly MessagePageRef[]): Message[] { return refs.flatMap(ref => this.read(ref)); }
  page(refs: readonly MessagePageRef[], conversationId: string, before?: number, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (before !== undefined && (!Number.isInteger(before) || before < 0))) throw new Error('Invalid history page');
    const selected = refs.filter(ref => ref.conversationId === conversationId);
    const total = selected.reduce((n, ref) => n + ref.count, 0);
    const end = Math.min(before ?? total, total), start = Math.max(0, end - limit);
    let offset = 0;
    const messages: Message[] = [];
    for (const ref of selected) {
      if (offset < end && offset + ref.count > start) messages.push(...this.read(ref).slice(Math.max(0, start - offset), end - offset));
      offset += ref.count;
    }
    return { messages, total, nextBefore: start > 0 ? start : undefined };
  }
}
