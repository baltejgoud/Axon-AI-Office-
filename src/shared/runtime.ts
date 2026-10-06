export type RunStatus =
  | 'planned'
  | 'queued'
  | 'starting'
  | 'working'
  | 'waiting_for_agent'
  | 'waiting_for_user'
  | 'waiting_for_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'canceling'
  | 'canceled'
  | 'interrupted';
export interface AgentRun {
  context?: {
    inputTokens: number; contextWindow: number; outputReserve: number; safetyMargin: number;
    archivedTokens: number; sections: Record<string, number>; model: string; estimated: boolean;
    compactionPerformed: boolean; outputTokens?: number; providerInputTokens?: number;
  };
  runId: string;
  parentRunId?: string;
  teamId?: string;
  conversationId: string;
  projectId?: string;
  agentId: string;
  taskId?: string;
  status: RunStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  cancellationReason?: string;
  dependencies: string[];
  children: string[];
  activeTool?: string;
  summary?: string;
  artifactRefs: string[];
  error?: string;
}
export const ACTIVE_RUN_STATUSES = new Set<RunStatus>([
  'queued',
  'starting',
  'working',
  'waiting_for_agent',
  'waiting_for_user',
  'waiting_for_approval',
  'canceling'
]);
export interface AgentMessage {
  messageId: string;
  runId: string;
  taskId?: string;
  fromAgentId: string;
  toAgentId: string;
  type:
    | 'request'
    | 'response'
    | 'handoff'
    | 'review_request'
    | 'review_result'
    | 'blocker'
    | 'decision'
    | 'status'
    | 'artifact'
    | 'completion';
  purpose: string;
  content: string;
  createdAt: number;
  replyTo?: string;
  artifactRefs: string[];
  requiresResponse: boolean;
  status: 'delivered' | 'answered' | 'canceled';
}
export interface TerminalSession {
  id: string;
  conversationId: string;
  runId?: string;
  projectRoot: string;
  cwd: string;
  shell: string;
  owner: 'user' | 'agent';
  running: boolean;
  output: string;
  startedAt: number;
  exitCode?: number;
  signal?: number;
}
