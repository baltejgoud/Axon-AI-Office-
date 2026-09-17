import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Central layout of every on-disk location Axon uses. All services resolve
 * paths through here so the data directory can be relocated in one place.
 */
export class PathService {
  readonly root: string;
  readonly data: string;
  readonly db: string;
  readonly secrets: string;
  readonly attachments: string;
  readonly knowledge: string;
  readonly logs: string;
  readonly backups: string;

  constructor() {
    this.root = app.getPath('userData');
    this.data = join(this.root, 'data');
    this.db = join(this.data, 'db');
    this.secrets = join(this.root, 'secrets');
    this.attachments = join(this.data, 'attachments');
    this.knowledge = join(this.data, 'knowledge');
    this.logs = join(this.root, 'logs');
    this.backups = join(this.root, 'backups');
  }

  /** Create the directory skeleton on boot. */
  ensure(): void {
    for (const dir of [this.root, this.data, this.db, this.secrets, this.attachments, this.knowledge, this.logs, this.backups]) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/** File names inside the JSON store. */
export const StoreFiles = {
  providers: 'providers.json',
  conversations: 'conversations.json',
  messages: 'messages.json',
  workspaces: 'workspaces.json',
  agents: 'agents.json',
  knowledgeDocs: 'knowledge-docs.json',
  knowledgeChunks: 'knowledge-chunks.json',
  settings: 'settings.json',
  state: 'state.json'
} as const;
