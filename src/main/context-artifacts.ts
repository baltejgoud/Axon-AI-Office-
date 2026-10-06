import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
/** Full payloads live outside the hot JSON conversation and survive app restarts. */
export class ToolOutputStore {
  private readonly directory: string;
  constructor(dataPath: string) { this.directory = join(dataPath, 'context-artifacts'); }
  private path(id: string) { return join(this.directory, createHash('sha256').update(id).digest('hex') + '.txt'); }
  put(id: string, content: string): void {
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(this.path(id), content, 'utf8');
  }
  read(id: string): string { return readFileSync(this.path(id), 'utf8'); }
}

export interface ContextTelemetryRecord {
  callId: string; at: number; event: 'planned' | 'completed' | 'overflow';
  model: string; agent?: string; task?: string; conversationId?: string;
  inputTokenEstimate?: number; inputTokens?: number; outputTokens?: number; cacheHitTokens?: number;
  sections?: Record<string, number>; compactionPerformed?: boolean;
}
export class ContextTelemetry {
  constructor(private dataPath: string) {}
  record(record: ContextTelemetryRecord): void {
    // Diagnostics must never stop a provider call, and contain no prompt text or credentials.
    try {
      mkdirSync(join(this.dataPath, 'diagnostics'), { recursive: true });
      appendFileSync(join(this.dataPath, 'diagnostics', 'context-calls.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    } catch { /* Best effort local telemetry. */ }
  }
}
