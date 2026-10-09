import { PLANNER_TOOL_NAMES } from '../tasks/tools';
import { TEAM_TOOL_NAMES } from '../team/tools';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import type { McpToolPolicy, ToolApprovalRequest, ToolApprovalDecision } from '../../shared/types';

export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface CheckResult {
  action: PermissionAction;
  reason?: string;
  /** A session grant allowed it ("Always allow this session"). */
  bySession?: boolean;
  /** A grant for the conversation's current run allowed it ("Allow for this task"). */
  byTask?: boolean;
}

/** How an approval request ended. */
export type ApprovalOutcome = 'approved' | 'approved-session' | 'approved-task' | 'rejected' | 'timed-out' | 'withdrawn';

/** What one run may touch: its folders, and whether shell commands are on. */
export interface PermissionScope {
  roots: string[];
  allowShell: boolean;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: NodeJS.Timeout;
}

/** Tools whose "always allow" covers only the exact call approved: a blanket grant would let any command run. */
const EXACT_GRANTS = new Set(['run_command', 'start_process', 'git_commit']);
/** The tools that save files. They share one "save files without asking" grant, and the folder check. */
export const FILE_SAVERS = new Set(['write_file', 'edit_file']);
/** The name a tool's session grant is kept under. */
const grantName = (toolName: string) => (FILE_SAVERS.has(toolName) ? 'write_file' : toolName);
/** What a grant for this call covers: the exact call for commands, else the tool. */
const grantKey = (toolName: string, args: unknown) =>
  EXACT_GRANTS.has(toolName) ? `${toolName}:${JSON.stringify(args)}` : `${grantName(toolName)}:*`;

export class PermissionManager {
  private readonly sessionGrants = new Set<string>();
  /** "Allow for this task": grants for one conversation's current run, by conversation, gone when it ends. */
  private readonly taskGrants = new Map<string, Set<string>>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  /** How a connector's tool is treated; null for tools that aren't a connector's. */
  private connectorRule: ((toolName: string) => McpToolPolicy | null) | null = null;

  constructor(
    private roots: string[],
    private allowShell: boolean,
    private defaultPolicy: Record<string, PermissionAction> = {}
  ) {}

  updateConfig(roots: string[], allowShell: boolean) {
    this.roots = roots;
    this.allowShell = allowShell;
  }

  setConnectorRule(rule: (toolName: string) => McpToolPolicy | null): void {
    this.connectorRule = rule;
  }

  /** Relative paths are read against each root (tools take project-relative paths); absolute ones as they are. */
  isPathWithinRoots(targetPath: string, roots: string[] = this.roots): boolean {
    if (!roots.length) return false;
    return roots.some(root => {
      const rel = relative(root, resolve(root, targetPath));
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
  }

  /** Checks one call. `scope` is the run's own folders and shell setting; without it the manager's defaults apply. */
  check(req: { toolName: string; args: Record<string, any>; conversationId?: string }, scope?: PermissionScope): CheckResult {
    const result = this.decide(req, scope);
    // A grant for this task only answers a question; it never turns a refusal into an allow.
    if (result.action === 'ask' && req.conversationId && this.taskGrants.get(req.conversationId)?.has(grantKey(req.toolName, req.args)))
      return { action: 'allow', byTask: true };
    return result;
  }

  private decide(req: { toolName: string; args: Record<string, any> }, scope?: PermissionScope): CheckResult {
    const { toolName, args } = req;
    const roots = scope?.roots ?? this.roots;
    const allowShell = scope?.allowShell ?? this.allowShell;

    // A connector tool you turned off stays off, whatever was allowed before.
    const connector = this.connectorRule?.(toolName) ?? null;
    if (connector === 'off') return { action: 'deny', reason: 'This tool is turned off in Settings → Connectors.' };

    // 1. Session-level grant check
    if (this.sessionGrants.has(`${toolName}:${JSON.stringify(args)}`) || this.sessionGrants.has(`${grantName(toolName)}:*`)) {
      return { action: 'allow', bySession: true };
    }
    // A connector tool: your override, or its server's read-only mark.
    if (connector) return { action: connector };

    // Asking a colleague touches nothing on disk; the colleague's own tools are checked one by one.
    if (toolName === 'ask_colleague') return { action: 'allow' };
    // The receptionist's planner tools only touch the task records.
    if (PLANNER_TOOL_NAMES.has(toolName)) return { action: 'allow' };
    // Finding people and calling a meeting only read; the plan waits for you before anything is done.
    if (TEAM_TOOL_NAMES.has(toolName)) return { action: 'allow' };

    // 2. Path containment check
    if (['read_file', 'list_files', 'file_context', 'get_symbol'].includes(toolName) || FILE_SAVERS.has(toolName)) {
      const p = args.path || args.directory || args.directoryPath;
      if (p && roots.length > 0 && !this.isPathWithinRoots(String(p), roots)) {
        return { action: 'deny', reason: `Path "${p}" is outside allowed workspace roots.` };
      }
    }

    // A background process's output and stop touch only what the same conversation started (the tools check).
    if (toolName === 'read_process' || toolName === 'stop_process') return { action: 'allow' };

    // 3. Shell execution permission check (a background process is a command that keeps running)
    if (toolName === 'run_command' || toolName === 'start_process') {
      if (!allowShell) {
        return { action: 'deny', reason: 'Shell command execution is disabled in workspace settings.' };
      }
      return { action: 'ask' };
    }

    // 4. Safe read-only tools default to allow within workspace
    if (['read_file', 'list_files', 'search_code', 'file_context', 'get_symbol'].includes(toolName)) {
      return { action: this.defaultPolicy[toolName] || 'allow' };
    }

    // 5. Saving a file defaults to ask (requires approval card)
    if (FILE_SAVERS.has(toolName)) {
      return { action: this.defaultPolicy[toolName] || 'ask' };
    }

    return { action: this.defaultPolicy[toolName] || 'ask' };
  }

  createApprovalRequest(params: {
    conversationId: string;
    messageId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, any>;
    preview?: ToolApprovalRequest['preview'];
  }): { request: ToolApprovalRequest; promise: Promise<boolean>; outcome: Promise<ApprovalOutcome> } {
    const id = randomUUID();
    const request: ToolApprovalRequest = {
      id,
      conversationId: params.conversationId,
      messageId: params.messageId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      arguments: params.args,
      preview: params.preview
    };

    let settle: (outcome: ApprovalOutcome) => void = () => {};
    const outcome = new Promise<ApprovalOutcome>((resolve) => {
      settle = resolve;
    });
    const promise = outcome.then((ended) => ended === 'approved' || ended === 'approved-session' || ended === 'approved-task');

    // 5-minute timeout on user approvals; a waiting approval never keeps the app from quitting.
    const timer = setTimeout(() => {
      this.pendingApprovals.delete(id);
      settle('timed-out');
    }, 300_000);
    timer.unref?.();

    this.pendingApprovals.set(id, { request, resolve: settle, timer });
    return { request, promise, outcome };
  }

  /** Every request still waiting for the user. */
  pending(): ToolApprovalRequest[] {
    return [...this.pendingApprovals.values()].map((pending) => pending.request);
  }

  resolveApproval(decision: ToolApprovalDecision): boolean {
    return this.settle(decision.requestId,
      !decision.approved
        ? 'rejected'
        : decision.alwaysAllowSession
          ? 'approved-session'
          : decision.allowForTask
            ? 'approved-task'
            : 'approved');
  }

  /** The run that asked has stopped: the request is answered as withdrawn and leaves the pending list. */
  withdraw(requestId: string): void {
    this.settle(requestId, 'withdrawn');
  }

  private settle(requestId: string, outcome: ApprovalOutcome): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(requestId);
    if (outcome === 'approved-session') {
      const { toolName, arguments: args } = pending.request;
      this.sessionGrants.add(grantKey(toolName, args));
    }
    if (outcome === 'approved-task') {
      const { toolName, arguments: args, conversationId } = pending.request;
      const grants = this.taskGrants.get(conversationId) ?? new Set<string>();
      grants.add(grantKey(toolName, args));
      this.taskGrants.set(conversationId, grants);
    }
    pending.resolve(outcome);
    return true;
  }

  /** A conversation's run has ended: what was allowed for that task asks again next time. */
  endTask(conversationId: string): void {
    this.taskGrants.delete(conversationId);
  }

  clearSession() {
    this.sessionGrants.clear();
    this.taskGrants.clear();
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timer);
      pending.resolve('withdrawn');
    }
    this.pendingApprovals.clear();
  }
}
