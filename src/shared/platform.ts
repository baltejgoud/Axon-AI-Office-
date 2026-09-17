import type { ProviderConfig, Conversation, Message, Workspace, Agent, KnowledgeDoc, KnowledgeChunk, Settings, StreamEvent, Skill, SkillSourceInfo, Role, Selection } from './types';
export interface PlatformState {
  version: 1;
  providers: ProviderConfig[];
  conversations: Conversation[];
  messages: Message[];
  workspaces: Workspace[];
  agents: Agent[];
  documents: KnowledgeDoc[];
  chunks: KnowledgeChunk[];
  settings: Settings;
}
export interface Snapshot extends Omit<PlatformState, 'chunks'> {
  dataPath: string;
  skills: Skill[];
  skillSources: SkillSourceInfo[];
  roles: Role[];
}
export interface PlatformAPI {
  snapshot(): Promise<Snapshot>;
  providerSave(provider: ProviderConfig, key?: string): Promise<void>;
  providerDelete(id: string): Promise<void>;
  workspaceSave(workspace: Workspace): Promise<void>;
  workspaceDelete(id: string): Promise<void>;
  agentSave(agent: Agent): Promise<void>;
  agentDelete(id: string): Promise<void>;
  agentExport(id: string): Promise<void>;
  agentImport(): Promise<void>;
  settingsSave(settings: Settings): Promise<void>;
  chatCreate(providerId: string, modelId: string, workspaceId: string | null, agentId?: string, selection?: Selection): Promise<Conversation>;
  chatRename(id: string, title: string): Promise<void>;
  chatSelectionSet(conversationId: string, selection: Selection): Promise<void>;
  chatDelete(id: string): Promise<void>;
  chatSend(id: string, text: string, attachmentIds: string[]): Promise<void>;
  chatStop(id: string): Promise<void>;
  attach(): Promise<{ id: string; name: string }[]>;
  knowledgeImport(): Promise<void>;
  knowledgeDelete(id: string): Promise<void>;
  knowledgeSearch(query: string): Promise<{ docName: string; text: string; score: number }[]>;
  projectChoose(): Promise<string | null>;
  projectList(): Promise<string[]>;
  projectRead(path: string): Promise<string>;
  projectWrite(path: string, text: string): Promise<void>;
  projectSearch(query: string): Promise<{ path: string; line: number; text: string }[]>;
  onStream(callback: (event: StreamEvent) => void): () => void;
}
declare global { interface Window { axon: PlatformAPI } }
