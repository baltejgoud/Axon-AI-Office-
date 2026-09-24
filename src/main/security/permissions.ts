import { PLANNER_TOOL_NAMES } from '../tasks/tools';
import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolApprovalRequest, ToolApprovalDecision } from '../../shared/types';

export type PermissionAction = 'allow' | 'ask' | 'deny';

export interface CheckResult {
  action: PermissionAction;
  reason?: string;
}

interface PendingApproval {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

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

  isPathWithinRoots(targetPath: string): boolean {
    if (!this.roots.length) return false;
    const resolved = resolve(targetPath);
    return this.roots.some(root => {
      const rel = relative(root, resolved);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
  }

  check(req: { toolName: string; args: Record<string, any> }): CheckResult {
    const { toolName, args } = req;

    // 1. Session-level grant check
    const grantKey = `${toolName}:${JSON.stringify(args)}`;
    const toolGrantKey = `${toolName}:*`;
    if (this.sessionGrants.has(grantKey) || this.sessionGrants.has(toolGrantKey)) {
      return { action: 'allow' };
    }

    // Asking a colleague touches nothing on disk; the colleague's own tools are checked one by one.
    if (toolName === 'ask_colleague') return { action: 'allow' };
    // The receptionist's planner tools only touch the task records.
    if (PLANNER_TOOL_NAMES.has(toolName)) return { action: 'allow' };

    // 2. Path containment check
    if (['read_file', 'write_file', 'list_files'].includes(toolName)) {
      const p = args.path || args.directory || args.directoryPath;
      if (p && this.roots.length > 0 && !this.isPathWithinRoots(p)) {
        return { action: 'deny', reason: `Path "${p}" is outside allowed workspace roots.` };
      }
    }

    // 3. Shell execution permission check
    if (toolName === 'run_command') {
      if (!this.allowShell) {
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

    // 5-minute timeout on user approvals
    const timer = setTimeout(() => {
      this.pendingApprovals.delete(id);
      resolver(false);
    }, 300_000);

    this.pendingApprovals.set(id, {
      request,
      resolve: resolver,
      timer
    });

    return { request, promise };
  }

  resolveApproval(decision: ToolApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(decision.requestId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingApprovals.delete(decision.requestId);

    if (decision.approved && decision.alwaysAllowSession) {
      this.sessionGrants.add(`${pending.request.toolName}:*`);
    }

    pending.resolve(decision.approved);
    return true;
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
