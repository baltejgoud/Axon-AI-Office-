import { RECEPTIONIST_ID, coworkerById } from '../shared/coworkers';
import type { ToolDefinition } from '../shared/types';
import { ASK_USER_TOOL } from '../shared/askUser';
import { WEB_TOOL_NAMES } from '../shared/webAccess';
import { ASK_COLLEAGUE } from './colleagues';
import { FIND_SKILLS, LOAD_SKILL } from './skills';
import { PLANNER_TOOLS } from './tasks/tools';
import { MESSAGE_TEAM, TEAM_LEADS, TEAM_TOOLS } from './team/tools';
import { WEB_TOOL_DEFINITIONS } from './tools/web';

/** What a colleague may use to look something up; nothing that changes a file or runs a command. */
export const READ_ONLY_TOOLS: readonly string[] = ['read_file', 'list_files', 'search_code', 'file_context', 'get_symbol'];

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
 * with the coworker (or your own chats) and don't, and neither do the web tools: with web access on,
 * everyone (every coworker, and your own chats) can search the web and read pages, folder or not.
 * Every coworker can ask a colleague, and coworkers do that instead of dispatching sub-agents. Where
 * someone is there to answer (`askUser`), they can ask you too.
 * Everyone but the receptionist, your own chats included, can look up skills and read them. The
 * receptionist also keeps the planner.
 */
export function toolsFor(input: {
  agentId?: string;
  hasFolder: boolean;
  registry: ToolDefinition[];
  /** The run's connector tools, already chosen for its coworker. */
  connectorTools?: ToolDefinition[];
  /** Web access is on (Settings → Web access). Off or absent: no web tools, whatever the registry holds. */
  webAccess?: boolean;
  /**
   * The run can stop and ask you a question (`ask_user`). Set for a coworker's or your own chat; left off
   * for an unattended run (a team member's task), which decides and says what it chose.
   */
  askUser?: boolean;
  /** The conversation is a team task's, or its lead's while the team works: teammates can be messaged. */
  teamChat?: boolean;
}): ToolDefinition[] {
  const coworker = coworkerById(input.agentId);
  // Leads delegate: they read for context, and their team writes and runs things.
  const lead = !!input.agentId && TEAM_LEADS.has(input.agentId);
  const tools = input.hasFolder
    ? input.registry.filter(
        (tool) =>
          !WEB_TOOL_NAMES.has(tool.name) &&
          !(coworker && tool.name === 'dispatch_subagent') &&
          (!lead || READ_ONLY_TOOLS.includes(tool.name))
      )
    : [];
  if (coworker) tools.push(ASK_COLLEAGUE);
  if (input.askUser) tools.push(ASK_USER_TOOL);
  if (input.agentId !== RECEPTIONIST_ID) tools.push(FIND_SKILLS, LOAD_SKILL);
  if (input.agentId === RECEPTIONIST_ID) tools.push(...PLANNER_TOOLS);
  // The Chief of Staff and the Ops Coordinator can find people and gather a team.
  if (input.agentId && TEAM_LEADS.has(input.agentId)) tools.push(...TEAM_TOOLS);
  if (input.webAccess) tools.push(...WEB_TOOL_DEFINITIONS);
  if (coworker && input.teamChat) tools.push(MESSAGE_TEAM);
  tools.push(...(input.connectorTools ?? []));
  return tools;
}
