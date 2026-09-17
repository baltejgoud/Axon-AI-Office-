/**
 * Axon shared domain types — the single source of truth for both processes.
 * Everything persisted in the storage layer or crossing the IPC boundary
 * must be expressed with these types.
 */

export type ID = string;

/* ---------------------------------- Providers --------------------------------- */

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ModelSpec {
  /** Model identifier sent to the provider API, e.g. "gpt-5", "claude-opus". */
  id: string;
  /** Human friendly label, e.g. "GPT-5 Thinking". */
  displayName: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

export interface ProviderConfig {
  id: ID;
  name: string;
  kind: ProviderKind;
  /** Base URL for openai-compatible endpoints; defaults per kind when omitted. */
  baseUrl?: string;
  models: ModelSpec[];
  enabled: boolean;
  createdAt: number;
  /** True when an API key is stored (key material itself never leaves main). */
  hasApiKey: boolean;
}

export interface ResolvedModel {
  provider: ProviderConfig;
  model: ModelSpec;
}

/* ---------------------------------- Chat -------------------------------------- */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Attachment {
  id: ID;
  name: string;
  mime: string;
  size: number;
  /** Absolute path inside the app attachments directory. */
  path: string;
  kind: 'text' | 'image' | 'binary';
  /** Extracted textual content for text-like files (bounded). */
  textPreview?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  error?: string;
}

export interface Message {
  id: ID;
  conversationId: ID;
  role: MessageRole;
  content: string;
  createdAt: number;
  providerId?: ID;
  modelId?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  error?: string;
  /** Reported provider usage for assistant responses. */
  usage?: ChatUsage;
  /** True while assistant tokens are still streaming. */
  streaming?: boolean;
}

export interface Conversation {
  id: ID;
  title: string;
  workspaceId: ID | null;
  providerId: ID;
  modelId: string;
  skillIds: string[];
  roleIds: string[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
}

/* -------------------------------- Workspaces ---------------------------------- */

export interface FileAccessPolicy {
  enabled: boolean;
  /** Absolute directories the workspace may read/write. Empty = chat-only. */
  roots: string[];
}

export interface Workspace {
  id: ID;
  name: string;
  description?: string;
  icon?: string;
  systemPrompt: string;
  instructions?: string;
  defaultProviderId: ID | null;
  defaultModelId: string | null;
  enabledTools: string[];
  knowledgeDocIds: ID[];
  skillIds: string[];
  roleIds: string[];
  fileAccess: FileAccessPolicy;
  createdAt: number;
  updatedAt: number;
  builtin?: boolean;
}

/* ---------------------------------- Agents ------------------------------------ */

export type AgentScheduleKind = 'manual' | 'interval';

export interface AgentSchedule {
  kind: AgentScheduleKind;
  /** Only for kind === 'interval'. */
  intervalMinutes?: number;
  /** Prompt used when the schedule fires. */
  input?: string;
}

export interface Agent {
  id: ID;
  name: string;
  description?: string;
  icon?: string;
  providerId: ID | null;
  modelId: string | null;
  systemPrompt: string;
  tools: string[];
  workspaceId: ID | null;
  skillIds: string[];
  roleIds: string[];
  maxSteps: number;
  schedule: AgentSchedule;
  createdAt: number;
  updatedAt: number;
}

/* -------------------------------- Knowledge ----------------------------------- */

export interface KnowledgeDoc {
  id: ID;
  name: string;
  /** Extension / detected kind: pdf, docx, xlsx, csv, md, txt, code… */
  kind: string;
  size: number;
  chunkCount: number;
  createdAt: number;
  workspaceIds: ID[];
}

export interface KnowledgeChunk {
  id: ID;
  docId: ID;
  docName: string;
  index: number;
  text: string;
  tokens: number;
}

export interface KnowledgeSearchHit {
  docId: ID;
  docName: string;
  chunkId: ID;
  score: number;
  text: string;
}

/* --------------------------------- Settings ----------------------------------- */

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  autoTitleConversations: boolean;
  defaultTemperature: number;
  defaultMaxTokens: number;
  streamDeltas: boolean;
  /** When true, the Code workspace may execute allow-listed shell commands. */
  allowShellExecution: boolean;
  shellAllowlist: string[];
  sendCrashDiagnostics: boolean;
  dataDirectoryNote: string;
}

/* ------------------------------ Provider runtime ------------------------------ */

export interface ChatRequestMessage {
  role: MessageRole;
  content: string;
  images?: { mime: string; base64: string }[];
  /** For role === 'tool'. */
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatRequestMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: { id: string; name: string; arguments: string }[];
  usage?: ChatUsage;
}

export type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'usage'; usage: ChatUsage };

/* --------------------------------- Streaming ---------------------------------- */

export type StreamEvent =
  | {
      channel: 'chat';
      conversationId: ID;
      messageId: ID;
      /** Full accumulated assistant text at the time of the event. */
      contentSoFar?: string;
      error?: string;
      usage?: ChatUsage;
      streaming?: boolean;
      done: boolean;
    }
  | {
      channel: 'agent';
      agentId: ID;
      runId: ID;
      step: number;
      text?: string;
      toolCalls?: ToolCall[];
      error?: string;
      done: boolean;
    };

/* ---------------------------------- Code -------------------------------------- */

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
}

/* --------------------------------- Skills & roles ------------------------------- */

export type SkillCategory = 'design' | 'engineering' | 'workflow' | 'review' | 'content' | 'integration' | 'other';

export interface Skill {
  id: string;
  source: string;
  path: string;
  name: string;
  description: string;
  category: SkillCategory;
  requires: string[];
  hasScripts: boolean;
  supported: boolean;
  bytes: number;
}

export interface SkillSourceInfo {
  slug: string;
  url: string;
  license: string;
  commit: string;
  skillCount: number;
}

export interface Role {
  id: string;
  name: string;
  group: string;
  profile: string;
}

export interface Selection {
  skillIds: string[];
  roleIds: string[];
}

export interface CodeSearchHit {
  path: string;
  line: number;
  text: string;
}
