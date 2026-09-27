import catalogJson from '../connectors/catalog.json';
import type { McpToolAnnotations, McpToolPolicy } from './types';
import { COWORKERS, SPECIALIST_GROUPS } from './coworkers';

export type ConnectorAuth = 'none' | 'oauth' | 'oauth-app' | 'github-account';
export type ConnectorCategory = 'code' | 'docs' | 'design' | 'comms' | 'payments' | 'reference' | 'hubs' | 'local';

/** One connector in the bundled catalog. */
export interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  /** The service's home page. */
  site: string;
  /** Hosted: always Streamable HTTP. */
  url?: string;
  /** On this PC: a stdio command. */
  command?: string;
  args?: string[];
  /**
   * none: no account. oauth: signs in, Axon registers itself. oauth-app: signs in with an app
   * registered ahead of time. github-account: your Axon GitHub sign-in.
   */
  auth: ConnectorAuth;
  /** Where the build's OAuth app for an `oauth-app` (or GitHub) connector comes from. */
  clientIdEnv?: string;
  clientSecretEnv?: string;
  /** Signs in with the app you set up for an account in Settings → Accounts (Google's, for Gmail, Calendar and Drive). */
  accountApp?: 'google';
  /** The service itself is in preview (Google's). */
  preview?: boolean;
  defaultCoworkers: string[];
  defaultGroups: string[];
}

export const CONNECTORS: readonly ConnectorEntry[] = catalogJson as ConnectorEntry[];
export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  code: 'Code & deploy',
  docs: 'Docs & projects',
  design: 'Design',
  comms: 'Mail, chat & CRM',
  payments: 'Payments',
  reference: 'Reference',
  hubs: 'Hubs',
  local: 'On this PC'
};
/** Connector tools one request may carry; OpenAI refuses more than 128 tools in all. */
export const CONNECTOR_TOOL_BUDGET = 100;
/** Skill requirements a connector satisfies: Rube's skills now run on Composio Connect. */
export const REQUIREMENT_CONNECTORS: Record<string, string> = { 'mcp:rube': 'composio' };

const byId = new Map(CONNECTORS.map((entry) => [entry.id, entry]));
export const connectorById = (id?: string): ConnectorEntry | undefined => (id ? byId.get(id) : undefined);

/** Who a connector serves when it is first connected. */
export const defaultAssignees = (entry: ConnectorEntry): string[] => [
  ...entry.defaultCoworkers,
  ...entry.defaultGroups.map((group) => `group:${group}`)
];

/** Everyone: every core coworker, every department and your own chats. */
export const everyone = (): string[] => [
  ...COWORKERS.filter((c) => c.core).map((c) => c.id),
  ...SPECIALIST_GROUPS.map((group) => `group:${group}`),
  'chats'
];

/** Whether a connector serves a run: its coworker by id or department (unless taken out), or your own chats. */
export function servesRun(assignees: readonly string[] | undefined, run: { coworkerId?: string; department?: string }): boolean {
  if (!assignees) return false;
  if (!run.coworkerId) return assignees.includes('chats');
  if (assignees.includes(`not:${run.coworkerId}`)) return false;
  return assignees.includes(run.coworkerId) || (!!run.department && assignees.includes(`group:${run.department}`));
}

/** Switches one person on or off, taking them out of their department rather than it out of the list. */
export function assign(list: readonly string[], coworker: { id: string; department: string }, on: boolean): string[] {
  const rest = list.filter((a) => a !== coworker.id && a !== `not:${coworker.id}`);
  const viaGroup = rest.includes(`group:${coworker.department}`);
  if (on) return viaGroup ? rest : [...rest, coworker.id];
  return viaGroup ? [...rest, `not:${coworker.id}`] : rest;
}

/** Switches a whole department; its members' own entries are folded into it. */
export function assignGroup(list: readonly string[], group: string, members: readonly string[], on: boolean): string[] {
  const own = new Set(members.flatMap((id) => [id, `not:${id}`]));
  const rest = list.filter((a) => a !== `group:${group}` && !own.has(a));
  return on ? [...rest, `group:${group}`] : rest;
}

/** What happens when a tool is called: your override, else a trusted server's read-only mark, else ask. */
export function toolAction(
  server: { catalogId?: string; toolPolicy?: Record<string, McpToolPolicy>; trustAnnotations?: boolean },
  tool: { name: string; annotations?: McpToolAnnotations }
): McpToolPolicy {
  const override = server.toolPolicy?.[tool.name];
  if (override) return override;
  const trusted = !!server.catalogId || !!server.trustAnnotations;
  return trusted && tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true ? 'allow' : 'ask';
}

/** Whole connectors, in order, until the budget is spent; the rest are left out by name. */
export function withinBudget<T>(groups: readonly { id: string; name: string; tools: readonly T[] }[], max = CONNECTOR_TOOL_BUDGET) {
  const tools: T[] = [];
  const kept: string[] = [];
  const leftOut: string[] = [];
  for (const group of groups) {
    if (tools.length + group.tools.length <= max) {
      tools.push(...group.tools);
      kept.push(group.id);
    } else leftOut.push(group.name);
  }
  return { tools, kept, leftOut };
}

/** HTTPS, or plain HTTP to this machine; never with a user name or password in it. */
export function isSecureMcpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}
