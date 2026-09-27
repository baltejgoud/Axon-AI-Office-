import { RECEPTIONIST_ID, coworkerById } from '../shared/coworkers';
import type { ToolDefinition } from '../shared/types';
import { ASK_COLLEAGUE } from './colleagues';
import { PLANNER_TOOLS } from './tasks/tools';

/** What a colleague may use to look something up; nothing that changes a file or runs a command. */
export const READ_ONLY_TOOLS: readonly string[] = ['read_file', 'list_files', 'search_code'];

/**
 * The folders a run may work in. A workspace with file access brings its folders and the project
 * open in the app; a conversation with its own folder keeps to it; an office coworker works in the
 * project open in the app (reading freely, asking before any write or command). The receptionist
 * keeps to her planner, and a plain chat without a folder gets none.
 */
export function runRoots(input: {
  agentId?: string;
  /** The workspace's folders when it has file access turned on. */
  workspaceRoots?: readonly string[] | null;
  conversationRoot?: string | null;
  projectRoot: string | null;
}): string[] {
  const { agentId, workspaceRoots, conversationRoot, projectRoot } = input;
  if (workspaceRoots) return [...new Set([...workspaceRoots, ...(projectRoot ? [projectRoot] : [])])];
  if (conversationRoot) return [conversationRoot];
  if (projectRoot && coworkerById(agentId) && agentId !== RECEPTIONIST_ID) return [projectRoot];
  return [];
}

/**
 * The tools a conversation offers the model. File tools still need a folder; connector tools come
 * with the coworker (or your own chats) and don't. Every coworker can ask a colleague, and coworkers
 * do that instead of dispatching sub-agents. The receptionist also keeps the planner.
 */
export function toolsFor(input: {
  agentId?: string;
  hasFolder: boolean;
  registry: ToolDefinition[];
  /** The run's connector tools, already chosen for its coworker. */
  connectorTools?: ToolDefinition[];
}): ToolDefinition[] {
  const coworker = coworkerById(input.agentId);
  const tools = input.hasFolder
    ? input.registry.filter((tool) => !(coworker && tool.name === 'dispatch_subagent'))
    : [];
  if (coworker) tools.push(ASK_COLLEAGUE);
  if (input.agentId === RECEPTIONIST_ID) tools.push(...PLANNER_TOOLS);
  tools.push(...(input.connectorTools ?? []));
  return tools;
}
