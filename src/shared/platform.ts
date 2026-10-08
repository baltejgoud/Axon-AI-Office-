import type { AgentRun, AgentMessage, TerminalSession } from './runtime';
import type {
  ClaudeRateLimits,
  ProviderConfig,
  Conversation,
  Message,
  Workspace,
  Agent,
  KnowledgeDoc,
  KnowledgeChunk,
  Settings,
  StreamEvent,
  Skill,
  SkillSourceInfo,
  Role,
  Selection,
  ToolApprovalDecision,
  ToolApprovalRequest,
  MCPServerConfig,
  TaskItem,
  FocusTarget,
  ProcessInfo,
  Team
} from './types';
import type { Briefing } from './planner';
import type {
  AccountProfile,
  AccountsState,
  DeviceCode,
  PublishInput,
  RepoSummary,
  ScmDiff,
  ScmStatus
} from './scm';
import type { ContextUsage } from './context-usage';
import type { AuditEntry, AuditQuery } from './audit';
export interface PlatformState {
  version: 1;
  runtimeVersion?: 1;
  runs?: AgentRun[];
  agentMessages?: AgentMessage[];
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
  /** Teams the Chief of Staff and the Ops Coordinator gathered. */
  teams: Team[];
}
export interface Snapshot extends Omit<PlatformState, 'chunks'> {
  dataPath: string;
  skills: Skill[];
  skillSources: SkillSourceInfo[];
  roles: Role[];
  mcpServers: MCPServerConfig[];
  /** Catalog connectors that have an OAuth app to sign in with: this build's, or your own. */
  connectorApps: string[];
  projectRoot?: string | null;
  /** Tool calls waiting for the user, so a reopened window can still answer them. */
  pendingApprovals: ToolApprovalRequest[];
  /** Commands the coworkers left running in the background. */
  processes: ProcessInfo[];
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
/** Settings' Find models: the model IDs the endpoint offers the key. */
export interface ProviderModelsResult {
  models: string[];
  /** A key is saved, but the form's endpoint differs from the saved one, so it wasn't sent. */
  savedKeyWithheld: boolean;
}
/** Settings' set-up from a pasted key: where the key works, and the models it can use there. */
export interface ProviderConnectResult {
  /** The service's address that accepted the key; another region's when the form's did not. */
  baseUrl: string;
  /** The models the key can use, or null when the endpoint lists none. */
  models: string[] | null;
  savedKeyWithheld: boolean;
}
/** Settings → Accounts → Claude: a Claude Console API key and, for a key that spans workspaces, the workspace to run in. */
export interface ClaudeConnectInput {
  key: string;
  workspaceId?: string;
}
export type ClaudeConnectResult =
  | { ok: true; models: number; organizationChanged: boolean }
  /** The key spans several workspaces, or the workspace was refused: ask which one. */
  | { ok: false; needsWorkspace: true; message: string };
/** Tokens replies reported, and what they cost at the prices you set. */
export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  /** Dollars for replies whose model has a price; null when none of them has one. */
  cost: number | null;
  /** Replies that reported usage. */
  turns: number;
  /** Of those, replies whose model has no price: in the tokens, not in the cost. */
  unpricedTurns: number;
}
/** One line of a Usage table: a day, a provider, a model or a conversation. */
export interface UsageRow {
  key: string;
  label: string;
  detail?: string;
  totals: UsageTotals;
}
/** Settings → Usage, added up from every reply's reported usage when asked. */
export interface UsageReport {
  today: UsageTotals;
  /** The last 7 days, today included. */
  week: UsageTotals;
  allTime: UsageTotals;
  /** Newest first; days without usage left out. */
  byDay: UsageRow[];
  byProvider: UsageRow[];
  /** Whether the model has a price set now. */
  byModel: (UsageRow & { priced: boolean })[];
  /** Most recently used first. */
  conversations: (UsageRow & { lastUsedAt: number })[];
  /** Replies that finished without reporting usage. */
  unreportedTurns: number;
}
/** A restore point: one rolling backup of everything Axon saves, as Settings lists it. */
export interface BackupSummary {
  /** Its file name in the backups folder; what restoreBackup takes. */
  file: string;
  /** When it was taken. */
  timestamp: number;
  conversations: number;
  workspaces: number;
  providers: number;
  /** Its newest message, or null when it has none. */
  lastMessageAt: number | null;
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
  runtimeRuns(): Promise<AgentRun[]>;
  conversationClose(id: string): Promise<boolean>;
  projectClose(): Promise<boolean>;
  terminalList(conversationId: string): Promise<TerminalSession[]>;
  terminalOpen(conversationId: string): Promise<TerminalSession>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalKill(id: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  providerSave(provider: ProviderConfig, key?: string): Promise<void>;
  /** Checks the form's endpoint, key and models without saving. With no key typed, the saved key is used only for the saved endpoint. */
  providerTest(provider: ProviderConfig, key?: string): Promise<ProviderTestResult>;
  providerModels(provider: ProviderConfig, key?: string): Promise<ProviderModelsResult>;
  providerConnect(provider: ProviderConfig, key?: string): Promise<ProviderConnectResult>;
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
  /** Adds a catalog connector, signing in first in the browser when it needs to. */
  connectorAdd(catalogId: string): Promise<void>;
  /** Tries a connector again, signing in first if it lost its sign-in. */
  connectorReconnect(id: string): Promise<void>;
  connectorSignInCancel(): Promise<void>;
  /** Forgets a connector's sign-in. */
  connectorSignOut(id: string): Promise<void>;
  /** Your own OAuth app for a connector this build has none for. */
  connectorAppSave(catalogId: string, clientId: string, clientSecret?: string): Promise<void>;
  chatCreate(
    providerId: string,
    modelId: string,
    workspaceId: string | null,
    agentId?: string,
    selection?: Selection,
    projectRoot?: string | null,
    systemPrompt?: string
  ): Promise<Conversation>;
  getConversationCost(conversationId: string): Promise<import('./cost').ConversationCost>;
  chatHistoryPage(conversationId: string, before?: number, limit?: number): Promise<{ messages: Message[]; total: number; nextBefore?: number }>;
  chatRename(id: string, title: string): Promise<void>;
  chatSelectionSet(conversationId: string, selection: Selection): Promise<void>;
  chatDelete(id: string): Promise<void>;
  chatSend(id: string, text: string, attachmentIds: string[]): Promise<void>;
  chatStop(id: string): Promise<void>;
  /** The context meter for a conversation before anything is sent; null for an unknown conversation. */
  getContextUsage(conversationId: string): Promise<ContextUsage | null>;
  /** Settings → Usage: every reply's reported usage, added up; dollars only for models with prices. */
  usageReport(): Promise<UsageReport>;
  /** Settings → Restore points: the rolling backups, newest first. */
  listBackups(): Promise<BackupSummary[]>;
  /** Asks natively first; then restores the backup and restarts Axon. Rejects with "Restore cancelled." on Cancel. */
  restoreBackup(file: string): Promise<void>;
  /** Settings → Activity log: every tool call any agent made, newest first. */
  auditList(query: AuditQuery): Promise<AuditEntry[]>;
  /** Saves the activity log where you choose; false when cancelled. */
  auditExport(): Promise<boolean>;
  /** Undoes a coworker's saved write after asking; rejects with "Undo cancelled." on Cancel. */
  revertChange(toolCallId: string): Promise<void>;
  toolApprove(decision: ToolApprovalDecision): Promise<void>;
  attach(): Promise<{ id: string; name: string }[]>;
  /** Voice typing: a composer recording as text, by the engine Settings → Voice picks. `prompt` names what you're likely to say. */
  speechTranscribe(audio: ArrayBuffer, mime: string, prompt: string): Promise<string>;
  readToolArtifact(conversationId: string, toolCallId: string, offset?: number): Promise<{ content: string; nextOffset?: number; total: number }>;
  getContextInspector(id: string): Promise<{ sections: Record<string, number>; system: string; messages: string; tools: string }>;
  chatMemoryCorrect(id: string, original: string, replacement: string): Promise<void>;
  chatModelSet(id: string, providerId: string, modelId: string): Promise<void>;
  knowledgeImport(): Promise<void>;
  knowledgeImportFolder(): Promise<{ imported: number; skipped: number; truncated: boolean } | null>;
  /** A plan waiting for you: start the work. */
  teamStart(id: string): Promise<void>;
  /** Stops a team's meeting or every owner still working. */
  teamStop(id: string): Promise<void>;
  /** Drops a plan you don't want. */
  teamDiscard(id: string): Promise<void>;
  /** Carries a failed or stopped team on. */
  teamRetry(id: string): Promise<void>;
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
  /** Who is signed in, which sign-ins this build offers, and the installed Git. */
  accountsGet(): Promise<AccountsState>;
  chatgptSignIn(): Promise<void>;
  chatgptCancel(): Promise<void>;
  chatgptSignOut(): Promise<{ remoteRevoked: boolean }>;
  chatgptRefreshModels(): Promise<void>;
  /** Claude with a Claude Console API key, checked with Anthropic's free model list: no message is sent. */
  claudeConnect(input: ClaudeConnectInput): Promise<ClaudeConnectResult>;
  claudeCancel(): Promise<void>;
  claudeRefreshModels(): Promise<void>;
  /** Forgets the key. It keeps working until it is disabled or deleted in Claude Console. */
  claudeDisconnect(): Promise<void>;
  /** The organization's rate limits as the last Claude request reported them. */
  claudeLimits(): Promise<ClaudeRateLimits | null>;
  /** Opens github.com/login/device and returns the code to type there. */
  githubSignInStart(): Promise<DeviceCode>;
  /** Resolves once the code is approved on github.com. */
  githubSignInFinish(): Promise<AccountProfile>;
  githubSignInCancel(): Promise<void>;
  githubSignOut(): Promise<void>;
  /**
   * Sets up the app GitHub or Google sign-in uses when this build has none: a GitHub OAuth app's
   * Client ID, or a Google "Desktop app" client's ID and secret (which also sign in Gmail, Calendar
   * and Drive). An empty Client ID forgets it.
   */
  accountAppSave(kind: 'github' | 'google', clientId: string, clientSecret?: string): Promise<void>;
  /** Opens Google's sign-in in the browser; resolves when it returns to Axon. */
  googleSignIn(): Promise<AccountProfile>;
  googleSignInCancel(): Promise<void>;
  googleSignOut(): Promise<void>;
  githubRepos(): Promise<RepoSummary[]>;
  /** Looks for Git again (after installing it). */
  gitCheck(): Promise<string | null>;
  scmStatus(): Promise<ScmStatus>;
  scmDiff(path: string): Promise<ScmDiff>;
  scmStage(paths: string[]): Promise<void>;
  scmUnstage(paths: string[]): Promise<void>;
  scmCommit(message: string): Promise<{ authorSet: boolean }>;
  scmSync(): Promise<void>;
  scmBranches(): Promise<{ current: string | null; local: string[]; remote: string[] }>;
  scmCheckout(name: string): Promise<void>;
  scmCreateBranch(name: string): Promise<void>;
  /** Asks where to put the clone; the opened folder, or null when cancelled. */
  scmClone(repo: string): Promise<string | null>;
  /** The new repository's page on GitHub. */
  scmPublish(input: PublishInput): Promise<string>;
  openLink(url: string): Promise<void>;
  /** Stops a background process a coworker started. */
  processStop(id: string): Promise<void>;
  /** Opens the page a background process serves in your browser. */
  processOpen(id: string): Promise<void>;
  onStream(callback: (event: StreamEvent) => void): () => void;
}
declare global {
  interface Window {
    axon: PlatformAPI;
  }
}
