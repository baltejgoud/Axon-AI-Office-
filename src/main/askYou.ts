import { answerResult, readQuestion } from '../shared/askUser';
import { auditSubject, type AuditActor } from '../shared/audit';
import { coworkerById } from '../shared/coworkers';
import type { StreamEvent, ToolCall } from '../shared/types';
import type { AuditLog } from './audit/log';
import type { PermissionManager } from './security/permissions';
import type { RunSupervisor } from './runtime/supervisor';
import type { ShellPort } from './service';
import type { TaskTracker } from './tasks/tracker';

/** What asking you needs from the service around it. */
export interface AskHost {
  permissions: PermissionManager;
  supervisor: RunSupervisor;
  tracker: TaskTracker;
  audit: AuditLog;
  shell: ShellPort | null;
  emit(event: StreamEvent): void;
}

export interface AskInput {
  conversationId: string;
  agentId: string | undefined;
  /** The reply the call is part of. */
  messageId: string;
  runId: string;
  call: ToolCall;
  args: Record<string, unknown>;
  signal: AbortSignal;
  actor: AuditActor;
}

/**
 * A coworker puts a question to you (`ask_user`). It goes the way an approval does: a card in the
 * window, the run paused with no time limit, a desktop notice if you aren't looking, and Stop
 * withdrawing it. What comes back is what the coworker is told you said. Null when the run was
 * stopped while it waited; an error result when the question itself was empty.
 */
export async function askYou(host: AskHost, input: AskInput): Promise<{ content: string; isError?: boolean } | null> {
  const { conversationId, call, signal } = input;
  const read = readQuestion(input.args);
  if ('error' in read) return { content: read.error, isError: true };
  const { question } = read;

  const { request, outcome } = host.permissions.createApprovalRequest({
    conversationId,
    messageId: input.messageId,
    toolCallId: call.id,
    toolName: call.name,
    args: input.args,
    question
  });
  host.emit({
    channel: 'chat',
    conversationId,
    messageId: input.messageId,
    toolCall: call,
    approvalRequired: request,
    streaming: true,
    done: false
  });
  host.supervisor.update(input.runId, { status: 'waiting_for_approval', activeTool: call.name });
  host.tracker.approvalPending(conversationId);
  // Nobody is looking (Axon hidden, minimized, or behind another app): say who is asking, and take them there.
  const asking = coworkerById(input.agentId);
  if (asking && host.shell && !host.shell.windowFocused())
    host.shell.notify({
      title: `${asking.name} has a question for you`,
      body: question.text.slice(0, 140),
      target: { agentId: asking.id, conversationId }
    });

  // Stopping the run withdraws the question, so a late answer can't reach a run that has ended.
  const withdraw = () => host.permissions.withdraw(request.id);
  signal.addEventListener('abort', withdraw, { once: true });
  if (signal.aborted) withdraw();
  await outcome;
  signal.removeEventListener('abort', withdraw);
  host.supervisor.update(input.runId, { status: 'working', activeTool: undefined });
  host.tracker.approvalResolved(conversationId);
  if (signal.aborted) {
    host.audit.record({
      conversationId,
      actor: input.actor,
      tool: call.name,
      subject: auditSubject(call.name, input.args),
      decision: 'withdrawn',
      toolCallId: call.id
    });
    return null;
  }
  return { content: answerResult(question, host.permissions.takeAnswer(request.id)) };
}
