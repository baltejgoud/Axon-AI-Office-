import { OFFICE_AGENTS } from '../data/officeAgents';
import { DISTRICTS } from '../campus/districts';
import { timeAgo } from '../../../format';
import type { ConversationHit } from '../../../../../shared/platform';

export type OfficeCommand = { id: string; label: string; detail: string } & (
  | { kind: 'person'; agentId: string }
  | { kind: 'department'; department: string }
  | {
      kind: 'action';
      action:
        | 'planner'
        | 'library'
        | 'settings'
        | 'focus'
        | 'overview'
        | 'team'
        | 'work'
        | 'history'
        | 'company'
        | 'dashboards'
        | 'welcome';
    }
  | { kind: 'ask'; prompt: string }
  /** A past conversation found by search, opened at the message that matched. */
  | { kind: 'conversation'; agentId: string; conversationId: string; messageId?: string }
);
const actions: OfficeCommand[] = [
  { id: 'company', kind: 'action', action: 'company', label: 'Open company operations', detail: 'Company documents, task briefs, teams and reports' },
  {
    id: 'dashboards',
    kind: 'action',
    action: 'dashboards',
    label: 'Open dashboards',
    detail: 'Data your coworkers gathered, as charts, tables and lists'
  },
  {
    id: 'history',
    kind: 'action',
    action: 'history',
    label: 'Open activity history',
    detail: 'Saved results, decisions and completed work'
  },
  {
    id: 'planner',
    kind: 'action',
    action: 'planner',
    label: 'Open planner',
    detail: 'Tasks, dates and reminders'
  },
  {
    id: 'library',
    kind: 'action',
    action: 'library',
    label: 'Open library',
    detail: 'Knowledge and documents'
  },
  {
    id: 'settings',
    kind: 'action',
    action: 'settings',
    label: 'Open settings',
    detail: 'Providers, accounts and preferences'
  },
  {
    id: 'overview',
    kind: 'action',
    action: 'overview',
    label: 'View whole campus',
    detail: 'Fit the office in view'
  },
  {
    id: 'focus',
    kind: 'action',
    action: 'focus',
    label: 'Toggle focus mode',
    detail: 'Hide secondary office overlays'
  },
  {
    id: 'team',
    kind: 'action',
    action: 'team',
    label: 'Toggle team view',
    detail: 'Accessible coworker roster'
  },
  {
    id: 'work',
    kind: 'action',
    action: 'work',
    label: 'Show coworker work',
    detail: 'Code, files and terminal'
  },
  {
    id: 'welcome',
    kind: 'action',
    action: 'welcome',
    label: 'Show the welcome guide',
    detail: 'Connect a model, choose a folder, try a first task'
  }
];
const catalog: OfficeCommand[] = [
  ...actions,
  ...DISTRICTS.flatMap((d) =>
    d.departments.map((department) => ({
      id: `department:${department}`,
      kind: 'department' as const,
      department,
      label: department,
      detail: `${d.name} department`
    }))
  ),
  ...OFFICE_AGENTS.map((a) => ({
    id: `person:${a.id}`,
    kind: 'person' as const,
    agentId: a.id,
    label: a.name,
    detail: `${a.department} · ${a.role}`
  }))
];
/** Past conversations found by search, as palette rows: who, when, and the line that matched. */
export function conversationCommands(
  hits: readonly ConversationHit[],
  now = Date.now()
): OfficeCommand[] {
  return hits.flatMap((hit) => {
    const agent = OFFICE_AGENTS.find((a) => a.id === hit.agentId);
    if (!agent) return [];
    const short = timeAgo(hit.updatedAt, now);
    const where = `${agent.name} · ${short === 'now' ? 'just now' : /^\d/.test(short) ? `${short} ago` : short}`;
    return [
      {
        id: `conversation:${hit.conversationId}`,
        kind: 'conversation' as const,
        agentId: agent.id,
        conversationId: hit.conversationId,
        messageId: hit.messageId,
        label: hit.title,
        detail: hit.snippet ? `${where} · ${hit.fromYou ? 'You: ' : ''}${hit.snippet}` : where
      }
    ];
  });
}

/** All query words match, so specialties and department names work as well as names. */
export function officeCommands(query: string, limit = 12): OfficeCommand[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = catalog
    .filter((item) => {
      const agent = item.kind === 'person' ? OFFICE_AGENTS.find((a) => a.id === item.agentId) : undefined;
      const text =
        `${item.label} ${item.detail} ${agent?.description ?? ''} ${agent?.capabilities.join(' ') ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => {
      const prefix = query.trim().toLowerCase();
      return (
        Number(b.label.toLowerCase().startsWith(prefix)) - Number(a.label.toLowerCase().startsWith(prefix))
      );
    })
    .slice(0, limit);
  if (query.trim())
    matches.push({
      id: 'ask-receptionist',
      kind: 'ask',
      label: `Ask the receptionist: ${query.trim()}`,
      detail: 'Prepare a message to review and send',
      prompt: query.trim()
    });
  return matches;
}
