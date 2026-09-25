import { PLANNER_TOOL_NAMES } from '../tasks/tools';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolApprovalRequest, ToolApprovalDecision } from '../../shared/types';

export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface CheckResult {
  action: PermissionAction;
  reason?: string;
}

/** What one run may touch: its folders, and whether shell commands are on. */
export interface PermissionScope {
  roots: string[];
  allowShell: boolean;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

/** Tools whose "always allow" covers only the exact call approved: a blanket grant would let any command run. */
const EXACT_GRANTS = new Set(['run_command', 'git_commit']);

export class PermissionManager {
  private readonly sessionGrants = new Set<string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(
    private roots: string[],
    private allowShell: boolean,
    private defaultPolicy: Record<string, PermissionAction> = {}
  ) {}

  updateConfig(roots: string[], allowShell: boolean) {
    this.roots = roots;
    this.allowShell = allowShell;
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
  check(req: { toolName: string; args: Record<string, any> }, scope?: PermissionScope): CheckResult {
    const { toolName, args } = req;
    const roots = scope?.roots ?? this.roots;
    const allowShell = scope?.allowShell ?? this.allowShell;

    // 1. Session-level grant check
    if (this.sessionGrants.has(`${toolName}:${JSON.stringify(args)}`) || this.sessionGrants.has(`${toolName}:*`)) {
      return { action: 'allow' };
    }

    // Asking a colleague touches nothing on disk; the colleague's own tools are checked one by one.
    if (toolName === 'ask_colleague') return { action: 'allow' };
    // The receptionist's planner tools only touch the task records.
    if (PLANNER_TOOL_NAMES.has(toolName)) return { action: 'allow' };

    // 2. Path containment check
    if (['read_file', 'write_file', 'list_files'].includes(toolName)) {
      const p = args.path || args.directory || args.directoryPath;
      if (p && roots.length > 0 && !this.isPathWithinRoots(String(p), roots)) {
        return { action: 'deny', reason: `Path "${p}" is outside allowed workspace roots.` };
      }
    }

    // 3. Shell execution permission check
    if (toolName === 'run_command') {
      if (!allowShell) {
        return { action: 'deny', reason: 'Shell command execution is disabled in workspace settings.' };
      }
      return { action: 'ask' };
    }

    // 4. Safe read-only tools default to allow within workspace
    if (toolName === 'read_file' || toolName === 'list_files' || toolName === 'search_code') {
      return { action: this.defaultPolicy[toolName] || 'allow' };
    }

    // 5. write_file defaults to ask (requires approval card)
    if (toolName === 'write_file') {
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
  }): { request: ToolApprovalRequest; promise: Promise<boolean> } {
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

    let resolver: (approved: boolean) => void = () => {};
    const promise = new Promise<boolean>((resolve) => {
      resolver = resolve;
    });

    // 5-minute timeout on user approvals; a waiting approval never keeps the app from quitting.
    const timer = setTimeout(() => {
      this.pendingApprovals.delete(id);
      resolver(false);
    }, 300_000);
    timer.unref?.();

    this.pendingApprovals.set(id, {
      request,
      resolve: resolver,
      timer
    });

    return { request, promise };
  }

  /** Every request still waiting for the user. */
  pending(): ToolApprovalRequest[] {
    return [...this.pendingApprovals.values()].map((pending) => pending.request);
  }

  resolveApproval(decision: ToolApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(decision.requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingApprovals.delete(decision.requestId);

    if (decision.approved && decision.alwaysAllowSession) {
      const { toolName, arguments: args } = pending.request;
      this.sessionGrants.add(EXACT_GRANTS.has(toolName) ? `${toolName}:${JSON.stringify(args)}` : `${toolName}:*`);
    }

    pending.resolve(decision.approved);
    return true;
  }

  /** The run that asked has stopped: the request is answered as rejected and leaves the pending list. */
  withdraw(requestId: string): void {
    this.resolveApproval({ requestId, approved: false });
  }

  clearSession() {
    this.sessionGrants.clear();
    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
  }
}
