/** Every tool call any agent makes, what the permission system decided, and who decided it. */
export type AuditDecision =
  /** Policy allowed it without asking, or a session grant did. */
  | 'allowed'
  /** You approved it. */
  | 'approved'
  /** You approved it and allowed it for the rest of the session. */
  | 'approved-session'
  | 'rejected'
  /** Nobody answered within 5 minutes. */
  | 'timed-out'
  /** The run stopped while it waited for you. */
  | 'withdrawn'
  /** Policy refused it: outside the folders, shell off, tool off. */
  | 'denied'
  /** Not run: bad arguments, an unknown or unavailable tool. */
  | 'skipped'
  /** You undid a saved change. */
  | 'reverted';

export interface AuditActor {
  kind: 'coworker' | 'colleague' | 'subagent' | 'chat' | 'you';
  id?: string;
  name: string;
  /** For a colleague or sub-agent: whose run they were helping. */
  onBehalfOf?: string;
}

export interface AuditEntry {
  id: string;
  at: number;
  conversationId?: string;
  actor: AuditActor;
  tool: string;
  /** What it was about: a path, a command, a connector's arguments. Never file contents; at most 300 characters. */
  subject: string;
  decision: AuditDecision;
  /** For calls that ran: whether the tool succeeded. */
  result?: 'ok' | 'error';
  /** A denial's reason, a tool's error, what an undo did; at most 300 characters. */
  detail?: string;
  toolCallId?: string;
  change?: { added: number; removed: number; created: boolean };
}

export type AuditGroup = 'all' | 'asked' | 'refused' | 'changes';

/** What a list asks for; results come newest first. */
export interface AuditQuery {
  conversationId?: string;
  actorId?: string;
  group?: AuditGroup;
  /** Continue after this entry ("Load more"). */
  afterId?: string;
  limit?: number;
}

const ASKED = new Set<AuditDecision>(['approved', 'approved-session', 'rejected', 'timed-out', 'withdrawn']);
const REFUSED = new Set<AuditDecision>(['denied', 'rejected', 'timed-out', 'skipped']);

/** The Activity log's filters. They overlap on purpose: a rejection was both asked and refused. */
export function inGroup(entry: AuditEntry, group: AuditGroup = 'all'): boolean {
  if (group === 'asked') return ASKED.has(entry.decision);
  if (group === 'refused') return REFUSED.has(entry.decision);
  if (group === 'changes') return entry.decision === 'reverted' || (entry.tool === 'write_file' && entry.result === 'ok');
  return true;
}

/** Each decision in words, for the Activity log's badges. */
export const DECISION_WORDS: Record<AuditDecision, string> = {
  allowed: 'Allowed',
  approved: 'You approved',
  'approved-session': 'You approved for the session',
  rejected: 'You rejected',
  'timed-out': 'No answer in time',
  withdrawn: 'Withdrawn: the run stopped',
  denied: 'Refused by policy',
  skipped: 'Not run',
  reverted: 'You undid it'
};

export const SUBJECT_MAX = 300;
const clip = (text: string, max = SUBJECT_MAX) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** Arguments that carry what a tool writes or sends: never kept. */
const BULKY = /^(content|body|text|data|html|markdown)$/i;
const str = (value: unknown) => (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value));

/** What a call was about, in one line. Never file contents. */
export function auditSubject(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
    case 'write_file':
      return clip(str(args.path));
    case 'list_files':
      return clip(str(args.directory ?? args.directoryPath ?? args.path) || '.');
    case 'search_code':
      return clip(str(args.query));
    case 'run_command':
    case 'start_process':
      return clip(str(args.command));
    case 'read_process':
    case 'stop_process':
      return clip(str(args.id));
    case 'git_commit':
      return clip(str(args.message));
    case 'ask_colleague':
      return clip(`${str(args.colleague)}: ${str(args.question)}`);
    case 'dispatch_subagent':
      return clip(`${str(args.role)}: ${str(args.task)}`);
    case 'read_memory':
    case 'update_memory':
      return '.axon/MEMORY.md';
    default: {
      const shown = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, BULKY.test(key) ? '…' : value]));
      return clip(Object.keys(shown).length ? JSON.stringify(shown) : '');
    }
  }
}
