import type { ProviderConfig, Conversation, Message, Workspace, Agent, KnowledgeDoc, KnowledgeChunk, Settings, StreamEvent, Skill, SkillSourceInfo, Role, Selection, ToolApprovalDecision, ToolApprovalRequest, MCPServerConfig, TaskItem, FocusTarget } from './types';
import type { Briefing } from './planner';
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
  mcpServers?: MCPServerConfig[];
  /** Coworkers' tasks and help, and your own to-dos. */
  tasks: TaskItem[];
  /** The front desk's memory: the last day briefed, and whether the tray was explained. */
  reception: { briefedOn?: string; trayHintShown?: boolean };
}
export interface Snapshot extends Omit<PlatformState, 'chunks'> {
  dataPath: string;
  skills: Skill[];
  skillSources: SkillSourceInfo[];
  roles: Role[];
  mcpServers: MCPServerConfig[];
  projectRoot?: string | null;
  /** Tool calls waiting for the user, so a reopened window can still answer them. */
  pendingApprovals: ToolApprovalRequest[];
  /** Start with Windows needs the installed app. */
  startWithWindowsAvailable: boolean;
}
/** Settings' Test connection: one line per model checked. */
export interface ProviderTestResult {
  results: { modelId: string; ok: boolean; ms?: number; error?: string }[];
  /** A key is saved, but the form's endpoint differs from the saved one, so it wasn't sent. */
  savedKeyWithheld: boolean;
  /** Models past the first ten, not checked. */
  untested: number;
}
/** What the planner may write to a to-do. `null` clears a field. */
export interface TaskPatch {
  title?: string;
  due?: string | null;
  remindAt?: number | null;
  notes?: string | null;
  status?: 'open' | 'done';
}
export interface PlatformAPI {
  snapshot(): Promise<Snapshot>;
  providerSave(provider: ProviderConfig, key?: string): Promise<void>;
  /** Checks the form's endpoint, key and models without saving. With no key typed, the saved key is used only for the saved endpoint. */
  providerTest(provider: ProviderConfig, key?: string): Promise<ProviderTestResult>;
  providerDelete(id: string): Promise<void>;
  workspaceSave(workspace: Workspace): Promise<void>;
  workspaceDelete(id: string): Promise<void>;
  agentSave(agent: Agent): Promise<void>;
  agentDelete(id: string): Promise<void>;
  agentExport(id: string): Promise<void>;
  agentImport(): Promise<void>;
  settingsSave(settings: Settings): Promise<void>;
  mcpServerSave(server: MCPServerConfig): Promise<void>;
  mcpServerDelete(id: string): Promise<void>;
  chatCreate(providerId: string, modelId: string, workspaceId: string | null, agentId?: string, selection?: Selection, projectRoot?: string | null, systemPrompt?: string): Promise<Conversation>;
  chatRename(id: string, title: string): Promise<void>;
  chatSelectionSet(conversationId: string, selection: Selection): Promise<void>;
  chatDelete(id: string): Promise<void>;
  chatSend(id: string, text: string, attachmentIds: string[]): Promise<void>;
  chatStop(id: string): Promise<void>;
  toolApprove(decision: ToolApprovalDecision): Promise<void>;
  attach(): Promise<{ id: string; name: string }[]>;
  knowledgeImport(): Promise<void>;
  knowledgeDelete(id: string): Promise<void>;
  knowledgeSearch(query: string): Promise<{ docName: string; text: string; score: number }[]>;
  projectChoose(): Promise<string | null>;
  projectRecent(): Promise<string[]>;
  projectOpen(folder: string): Promise<string | null>;
  projectForget(folder: string): Promise<void>;
  projectList(): Promise<string[]>;
  projectRead(path: string): Promise<string>;
  projectWrite(path: string, text: string): Promise<void>;
  projectSearch(query: string): Promise<{ path: string; line: number; text: string }[]>;
  taskAdd(input: { title: string; due?: string; remindAt?: number; notes?: string }): Promise<TaskItem>;
  taskUpdate(id: string, patch: TaskPatch): Promise<TaskItem>;
  taskDelete(id: string): Promise<void>;
  /** Called once when a window opens: the day's briefing (once a day) and where to look first. */
  officeStart(): Promise<{ briefing: Briefing | null; focus: FocusTarget | null }>;
  onStream(callback: (event: StreamEvent) => void): () => void;
}
declare global { interface Window { axon: PlatformAPI } }
