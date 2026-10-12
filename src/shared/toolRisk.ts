/**
 * What a step could do, in a few plain words, for the label on each approval card. Pure, so the
 * wording is tested and the window and any other surface say the same thing.
 */

export type RiskKind = 'reads' | 'files' | 'command' | 'connector' | 'question' | 'other';

export interface ToolRisk {
  kind: RiskKind;
  label: string;
}

/** Tools that only look at something. */
const READS = new Set([
  'read_file',
  'list_files',
  'search_code',
  'file_context',
  'get_symbol',
  'read_process',
  'read_memory',
  'read_attachment',
  'find_skills',
  'load_skill',
  'find_people',
  'web_search',
  'read_webpage'
]);
/** Tools that save, change or remove something on this computer. */
const CHANGES_FILES = new Set(['write_file', 'edit_file', 'create_document', 'git_commit', 'update_memory']);
/** Tools that run something in a terminal. */
const COMMANDS = new Set(['run_command', 'start_process', 'stop_process']);
/** A tool whose name says it removes or moves things (a connector's, or one added later). */
const CHANGING_NAME = /(^|_)(delete|remove|rename|move|trash|erase|overwrite|truncate)(_|$)/;

/** The connected app a tool belongs to ("Notion"), from the connectors in the snapshot; null for any other tool. */
export function connectorOf(
  toolName: string,
  servers: readonly { name: string; tools?: readonly { axonName: string }[] }[] | undefined
): string | null {
  return servers?.find((server) => server.tools?.some((tool) => tool.axonName === toolName))?.name ?? null;
}

/** Several steps' labels in one line: "Changes files (2), Runs a command". Empty for no steps. */
export function riskSummary(risks: readonly ToolRisk[]): string {
  const counts = new Map<string, number>();
  for (const { label } of risks) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, n]) => (n > 1 ? `${label} (${n})` : label)).join(', ');
}

/**
 * The label for a tool. `connectorName` is the connected app the tool belongs to ("Notion"), when it
 * is one; without it a connector's tool still says it uses a connected app.
 */
export function toolRisk(toolName: string, connectorName?: string | null): ToolRisk {
  if (toolName === 'ask_user') return { kind: 'question', label: 'Asks you a question' };
  const connector = connectorName?.trim();
  if (connector) return { kind: 'connector', label: `Uses ${connector}` };
  if (toolName.startsWith('mcp_')) return { kind: 'connector', label: 'Uses a connected app' };
  if (COMMANDS.has(toolName)) return { kind: 'command', label: 'Runs a command' };
  if (CHANGES_FILES.has(toolName) || CHANGING_NAME.test(toolName)) return { kind: 'files', label: 'Changes files' };
  if (READS.has(toolName)) return { kind: 'reads', label: 'Reads only' };
  if (toolName === 'dispatch_subagent') return { kind: 'other', label: 'Starts a helper' };
  return { kind: 'other', label: 'Takes an action' };
}
