import { RECEPTIONIST_ID, coworkerById } from '../shared/coworkers';
import type { ToolDefinition } from '../shared/types';
import { ASK_COLLEAGUE } from './colleagues';
import { PLANNER_TOOLS } from './tasks/tools';

/** What a colleague may use to look something up; nothing that changes a file or runs a command. */
export const READ_ONLY_TOOLS: readonly string[] = ['read_file', 'list_files', 'search_code'];

/**
 * The tools a conversation offers the model. File tools (and MCP servers) still need a folder;
 * every coworker can ask a colleague, and coworkers do that instead of dispatching sub-agents. The
 * receptionist also keeps the planner.
 */
export function toolsFor(input: {
  agentId?: string;
  hasFolder: boolean;
  registry: ToolDefinition[];
}): ToolDefinition[] {
  const coworker = coworkerById(input.agentId);
  const tools = input.hasFolder
    ? input.registry.filter((tool) => !(coworker && tool.name === 'dispatch_subagent'))
    : [];
  if (coworker) tools.push(ASK_COLLEAGUE);
  if (input.agentId === RECEPTIONIST_ID) tools.push(...PLANNER_TOOLS);
  return tools;
}
