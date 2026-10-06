import { MessagePages, type MessagePageRef } from './message-pages';
import type { BackupSummary, PlatformState } from '../shared/platform';
import { everyone } from '../shared/connectors';
import { JsonStore } from './infra/store';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export function initialState(): PlatformState {
  const now = Date.now();
  return {
    version: 1,
    providers: [],
    conversations: [],
    messages: [],
    agents: [],
    documents: [],
    chunks: [],
    workspaces: [
      {
        id: 'code',
        name: 'Code Assistant',
        description:
          'Understand, build, and improve your projects with a conversational engineering assistant.',
        icon: '⌘',
        systemPrompt:
          'You are a careful software engineering assistant. Explain changes and provide complete code. You cannot execute commands or edit files directly. Ask the user to review changes before applying them.',
        instructions: '',
        defaultProviderId: null,
        defaultModelId: null,
        enabledTools: [],
        knowledgeDocIds: [],
        skillIds: [],
        roleIds: [],
        fileAccess: { enabled: false, roots: [] },
        createdAt: now,
        updatedAt: now,
        builtin: true
      }
    ],
    settings: {
      theme: 'light',
      autoTitleConversations: true,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      streamDeltas: true,
      allowShellExecution: false,
      shellAllowlist: [],
      sendCrashDiagnostics: false,
      dataDirectoryNote: '',
      keepInTray: true,
      startWithWindows: false
    },
    mcpServers: [],
    tasks: [],
    reception: {},
    teams: []
  };
}

const BACKUPS_KEPT = 10;
/** Saves happen several times a second during a run; a backup at most this often keeps real history. */
const BACKUP_EVERY_MS = 10 * 60_000;
/** Rolling backups are named for when they were taken: state-2026-09-25T10-00-00-000Z.json. */
const BACKUP_NAME = /^state-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/;
/** When a backup was taken, from its name; null for a file that isn't a rolling backup. */
function takenAt(file: string): number | null {
  const m = BACKUP_NAME.exec(file);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

export class Repository {
  readonly store: JsonStore;
  readonly state: PlatformState;
  private readonly messagePages: MessagePages;
  private pageRefs: MessagePageRef[] = [];
  private readonly conversationCache = new Map<string, PlatformState['messages']>();
  private loadedMessages: PlatformState['messages'] | undefined;
  conversationMessages(id: string): PlatformState['messages'] {
    if (this.loadedMessages) return this.loadedMessages.filter(m => m.conversationId === id);
    let messages = this.conversationCache.get(id);
    if (!messages) {
      messages = this.messagePages.all(this.pageRefs.filter(ref => ref.conversationId === id));
      for (const m of messages) if (m.streaming) { m.streaming = false; m.error = 'Interrupted when the application closed.'; }
      this.conversationCache.set(id, messages);
    }
    return messages;
  }
  appendMessages(...messages: PlatformState['messages']): void {
    if (this.loadedMessages) this.loadedMessages.push(...messages);
    else for (const m of messages) this.conversationMessages(m.conversationId).push(m);
  }
  deleteMessages(id: string): void {
    if (this.loadedMessages) this.loadedMessages = this.loadedMessages.filter(m => m.conversationId !== id);
    this.conversationCache.delete(id);
    this.pageRefs = this.pageRefs.filter(ref => ref.conversationId !== id);
  }
  historyPage(conversationId: string, before?: number, limit = 100) {
    if (this.loadedMessages || this.conversationCache.has(conversationId)) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (before !== undefined && (!Number.isInteger(before) || before < 0))) throw new Error('Invalid history page');
      const all = this.conversationMessages(conversationId);
      const end = Math.min(before ?? all.length, all.length), start = Math.max(0, end - limit);
      return { messages: all.slice(start, end), total: all.length, nextBefore: start > 0 ? start : undefined };
    }
    return this.messagePages.page(this.pageRefs, conversationId, before, limit);
  }
  private savedState(state: PlatformState): PlatformState {
    const own = state === this.state;
    let refs: MessagePageRef[];
    if (own && !this.loadedMessages) {
      refs = [...this.pageRefs];
      for (const [id, messages] of this.conversationCache) refs = [...refs.filter(ref => ref.conversationId !== id), ...this.messagePages.write(messages)];
    } else refs = this.messagePages.write(state.messages);
    if (own) this.pageRefs = refs;
    const metadata = Object.fromEntries(Object.keys(state).filter(key => key !== 'messages').map(key => [key, state[key as keyof PlatformState]]));
    return { ...metadata, messages: [], messagePages: refs } as unknown as PlatformState;
  }
  private readonly file = 'platform-v1.json';
  private lastBackup = -Infinity;
  /** Set once a backup is restored: the next start loads it, so nothing still in memory may be saved over it. */
  private restored = false;
  constructor(
    private readonly dir: string,
    private readonly backupDir: string,
    private readonly now: () => number = Date.now
  ) {
    mkdirSync(backupDir, { recursive: true });
    this.messagePages = new MessagePages(join(dir, 'message-pages'));
    this.store = new JsonStore(dir);
    this.state = this.loadValidated();
    this.loadedMessages = this.pageRefs.length ? undefined : this.state.messages;
    Object.defineProperty(this.state, 'messages', { enumerable: true, configurable: true,
      get: () => {
        if (!this.loadedMessages) {
          this.loadedMessages = this.messagePages.all(this.pageRefs.filter(ref => !this.conversationCache.has(ref.conversationId)));
          for (const messages of this.conversationCache.values()) this.loadedMessages.push(...messages);
          this.conversationCache.clear();
          for (const m of this.loadedMessages) if (m.streaming) { m.streaming = false; m.error = 'Interrupted when the application closed.'; }
        }
        return this.loadedMessages;
      }, set: (value: PlatformState['messages']) => { this.loadedMessages = value; }
    });
    this.backup();
  }
  async save(): Promise<void> {
    if (this.restored) return Promise.resolve();
    if (this.now() - this.lastBackup >= BACKUP_EVERY_MS) this.backup();
    await this.store.save(this.file, this.savedState(this.state));
    // Retain active mutable turns; cold conversations can be reloaded from committed pages.
    for (const [id, messages] of this.conversationCache) {
      if (this.conversationCache.size <= 8) break;
      if (!messages.some(m => m.streaming)) this.conversationCache.delete(id);
    }
  }
  id(): string {
    return randomUUID();
  }

  /** Settings → Restore points: every rolling backup that could be restored, newest first, with what it holds. */
  async listBackups(): Promise<BackupSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.backupDir);
    } catch {
      return [];
    }
    const points: BackupSummary[] = [];
    for (const file of files) {
      const timestamp = takenAt(file);
      if (timestamp === null) continue;
      try {
        const state = this.parse(await readFile(join(this.backupDir, file), 'utf-8'));
        const lastMessageAt = state.messages.reduce<number | null>(
          (latest, m) =>
            typeof m.createdAt === 'number' && m.createdAt > (latest ?? -Infinity) ? m.createdAt : latest,
          null
        );
        points.push({
          file,
          timestamp,
          conversations: state.conversations.length,
          workspaces: state.workspaces.length,
          providers: state.providers.length,
          lastMessageAt
        });
      } catch {
        /* A damaged backup can't be restored, so it isn't offered. */
      }
    }
    return points.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Puts a backup back as the saved state, for the next start. It is read and checked first, so a
   * damaged one changes nothing (and backing up can't prune it away); then what is live now is saved
   * and backed up, so the restore can be undone the same way. After this nothing more is saved: the
   * app holds the old state in memory and must restart.
   */
  async restoreBackup(file: string): Promise<void> {
    if (
      typeof file !== 'string' ||
      takenAt(file) === null ||
      basename(file) !== file ||
      dirname(resolve(this.backupDir, file)) !== resolve(this.backupDir)
    )
      throw new Error("That restore point is not one of Axon's backups.");
    let raw: string;
    try {
      raw = await readFile(join(this.backupDir, file), 'utf-8');
    } catch {
      throw new Error('That restore point is gone. Open Restore points again to see the ones there are.');
    }
    let state: PlatformState;
    try {
      state = this.parse(raw);
    } catch {
      throw new Error("That restore point is damaged and can't be restored. Nothing was changed.");
    }
    await this.store.save(this.file, this.savedState(this.state));
    if (!this.backup()) throw new Error("Couldn't back up your current data first, so nothing was restored.");
    // Set before the write: a save already on its way queues ahead of this one, and none can follow it.
    this.restored = true;
    try {
      await this.store.save(this.file, this.savedState(state));
    } catch (error) {
      this.restored = false;
      throw error;
    }
  }

  private loadValidated(): PlatformState {
    const path = join(this.dir, this.file);
    if (!existsSync(path)) return initialState();
    try {
      const raw = readFileSync(path, 'utf-8');
      const saved = JSON.parse(raw) as PlatformState & { messagePages?: MessagePageRef[] };
      this.pageRefs = saved.messagePages ?? [];
      const state = this.parse(raw, false);
      // A previous run may have been killed mid-generation.
      for (const message of state.messages)
        if (message.streaming) {
          message.streaming = false;
          message.error = 'Interrupted when the application closed.';
        }
      return state;
    } catch (error) {
      // Quarantine the unusable file for forensics; never silently discard bytes.
      try {
        copyFileSync(path, join(this.backupDir, `corrupt-${Date.now()}.json`));
      } catch {
        /* ignore */
      }
      console.error('Saved data was invalid; starting with a fresh workspace.', error);
      this.pageRefs = [];
      return initialState();
    }
  }

  /** Saved state as text, brought up to date and checked; throws when it isn't usable. */
  private parse(raw: string, hydrate = true): PlatformState {
    const state = JSON.parse(raw) as PlatformState;
    const refs = (state as PlatformState & { messagePages?: MessagePageRef[] }).messagePages;
    if (hydrate && refs) state.messages = this.messagePages.all(refs);
    delete (state as PlatformState & { messagePages?: MessagePageRef[] }).messagePages;
    this.migrate(state);
    this.validate(state);
    return state;
  }

  /** Migration seam: convert older schemas in place before validation. */
  private migrate(state: PlatformState): void {
    // v1 gained skillIds/roleIds on conversations, workspaces and agents (2026-09). Default them.
    for (const list of [state.conversations, state.workspaces, state.agents] as {
      skillIds?: string[];
      roleIds?: string[];
    }[][])
      for (const item of list ?? []) {
        item.skillIds ??= [];
        item.roleIds ??= [];
      }
    // Nothing runs on a schedule any more (2026-09): schedules from older builds are switched off, prompt kept.
    for (const agent of state.agents ?? [])
      if (agent.schedule?.kind === 'interval') agent.schedule = { ...agent.schedule, kind: 'manual' };
    state.mcpServers = Array.isArray(state.mcpServers) ? state.mcpServers : [];
    // Connectors are given to people (2026-09): servers from older builds keep the reach they had, for everyone.
    // The Chief of Staff took the Writer's place (2026-09), and the Writer's connectors with it.
    for (const server of state.mcpServers)
      server.coworkers = (server.coworkers ?? everyone()).map((a) =>
        a === 'writer' ? 'chief-of-staff' : a === 'not:writer' ? 'not:chief-of-staff' : a
      );
    // Task records arrived with the office's task boards (2026-09).
    state.tasks = Array.isArray(state.tasks) ? state.tasks : [];
    // The receptionist and the tray arrived with the planner (2026-09).
    state.reception = state.reception && typeof state.reception === 'object' ? state.reception : {};
    // Teams arrived with team meetings (2026-10).
    state.teams = Array.isArray(state.teams) ? state.teams : [];
    // Runtime schema v1 is additive; older conversations and audit records are retained.
    state.runtimeVersion = 1;
    state.runs = Array.isArray(state.runs) ? state.runs : [];
    state.agentMessages = Array.isArray(state.agentMessages) ? state.agentMessages : [];
    if (state.settings) {
      state.settings.keepInTray ??= true;
      state.settings.startWithWindows ??= false;
    }
    const codeWs = state.workspaces?.find((w) => w.id === 'code');
    if (codeWs && codeWs.name === 'Code') {
      codeWs.name = 'Code Assistant';
    }
  }

  private validate(state: PlatformState): void {
    const collections = [
      'providers',
      'conversations',
      'messages',
      'workspaces',
      'agents',
      'documents',
      'chunks'
    ] as const;
    if (
      !state ||
      state.version !== 1 ||
      !state.settings ||
      collections.some((key) => !Array.isArray(state[key]))
    )
      throw new Error('Saved data failed validation.');
    const providerIds = state.providers.map((p) => p.id);
    if (new Set(providerIds).size !== providerIds.length) throw new Error('Saved data failed validation.');
    for (const message of state.messages)
      if (
        typeof message.id !== 'string' ||
        typeof message.content !== 'string' ||
        !['system', 'user', 'assistant', 'tool'].includes(message.role)
      )
        throw new Error('Saved data failed validation.');
    const isIdList = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
    for (const list of [state.conversations, state.workspaces, state.agents] as {
      skillIds: unknown;
      roleIds: unknown;
    }[][])
      for (const item of list)
        if (!isIdList(item.skillIds) || !isIdList(item.roleIds))
          throw new Error('Saved data failed validation.');
    for (const task of state.tasks)
      if (
        typeof task.id !== 'string' ||
        typeof task.title !== 'string' ||
        !['work', 'help', 'todo'].includes(task.kind) ||
        !['open', 'working', 'attention', 'done'].includes(task.status)
      )
        throw new Error('Saved data failed validation.');
  }

  /** Rolling pre-write backup of the previous good state: at start-up, then at most every BACKUP_EVERY_MS (keeps BACKUPS_KEPT). */
  private backup(): boolean {
    try {
      const source = join(this.dir, this.file);
      if (!existsSync(source)) return false;
      this.lastBackup = this.now();
      copyFileSync(
        source,
        join(this.backupDir, `state-${new Date(this.lastBackup).toISOString().replace(/[:.]/g, '-')}.json`)
      );
      const kept = readdirSync(this.backupDir)
        .filter((name) => name.startsWith('state-'))
        .sort();
      for (const stale of kept.slice(0, Math.max(0, kept.length - BACKUPS_KEPT))) {
        try {
          unlinkSync(join(this.backupDir, stale));
        } catch {
          /* ignore */
        }
      }
      return true;
    } catch {
      return false; /* backups must never block saving */
    }
  }
}
