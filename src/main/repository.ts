import type { PlatformState } from '../shared/platform';
import { JsonStore } from './infra/store';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function initialState(): PlatformState {
  const now = Date.now();
  return { version: 1, providers: [], conversations: [], messages: [], agents: [], documents: [], chunks: [],
    workspaces: [{ id: 'code', name: 'Code', description: 'Understand, build, and improve your projects.', icon: '⌘',
      systemPrompt: 'You are a careful software engineering assistant. Explain changes and provide complete code. You cannot execute commands or edit files directly. Ask the user to review changes before applying them.',
      instructions: '', defaultProviderId: null, defaultModelId: null, enabledTools: [], knowledgeDocIds: [],
      skillIds: [], roleIds: [],
      fileAccess: { enabled: false, roots: [] }, createdAt: now, updatedAt: now, builtin: true }],
    settings: { theme: 'dark', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096,
      streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' } };
}

const BACKUPS_KEPT = 10;

export class Repository {
  readonly store: JsonStore;
  readonly state: PlatformState;
  private readonly file = 'platform-v1.json';
  constructor(private readonly dir: string, private readonly backupDir: string) {
    mkdirSync(backupDir, { recursive: true });
    this.store = new JsonStore(dir);
    this.state = this.loadValidated();
    this.backup();
  }
  save(): Promise<void> {
    this.backup();
    return this.store.save(this.file, this.state);
  }
  id(): string { return randomUUID(); }

  private loadValidated(): PlatformState {
    const path = join(this.dir, this.file);
    if (!existsSync(path)) return initialState();
    try {
      const state = JSON.parse(readFileSync(path, 'utf-8')) as PlatformState;
      this.migrate(state);
      this.validate(state);
      // A previous run may have been killed mid-generation.
      for (const message of state.messages) if (message.streaming) { message.streaming = false; message.error = 'Interrupted when the application closed.'; }
      return state;
    } catch (error) {
      // Quarantine the unusable file for forensics; never silently discard bytes.
      try { copyFileSync(path, join(this.backupDir, `corrupt-${Date.now()}.json`)); } catch { /* ignore */ }
      console.error('Saved data was invalid; starting with a fresh workspace.', error);
      return initialState();
    }
  }

  /** Migration seam: convert older schemas in place before validation. */
  private migrate(state: PlatformState): void {
    // v1 gained skillIds/roleIds on conversations, workspaces and agents (2026-09). Default them.
    for (const list of [state.conversations, state.workspaces, state.agents] as { skillIds?: string[]; roleIds?: string[] }[][])
      for (const item of list ?? []) { item.skillIds ??= []; item.roleIds ??= []; }
  }

  private validate(state: PlatformState): void {
    const collections = ['providers', 'conversations', 'messages', 'workspaces', 'agents', 'documents', 'chunks'] as const;
    if (!state || state.version !== 1 || !state.settings || collections.some(key => !Array.isArray(state[key]))) throw new Error('Saved data failed validation.');
    const providerIds = state.providers.map(p => p.id);
    if (new Set(providerIds).size !== providerIds.length) throw new Error('Saved data failed validation.');
    for (const message of state.messages)
      if (typeof message.id !== 'string' || typeof message.content !== 'string' || !['system', 'user', 'assistant', 'tool'].includes(message.role)) throw new Error('Saved data failed validation.');
    const isIdList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
    for (const list of [state.conversations, state.workspaces, state.agents] as { skillIds: unknown; roleIds: unknown }[][])
      for (const item of list) if (!isIdList(item.skillIds) || !isIdList(item.roleIds)) throw new Error('Saved data failed validation.');
  }

  /** Rolling pre-write backup of the previous good state (keeps BACKUPS_KEPT). */
  private backup(): void {
    try {
      const source = join(this.dir, this.file);
      if (!existsSync(source)) return;
      copyFileSync(source, join(this.backupDir, `state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const kept = readdirSync(this.backupDir).filter(name => name.startsWith('state-')).sort();
      for (const stale of kept.slice(0, Math.max(0, kept.length - BACKUPS_KEPT))) {
        try { unlinkSync(join(this.backupDir, stale)); } catch { /* ignore */ }
      }
    } catch { /* backups must never block saving */ }
  }
}

