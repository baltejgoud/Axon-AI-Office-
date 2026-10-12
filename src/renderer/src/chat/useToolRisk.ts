import { useApp } from '../state';
import { connectorOf, toolRisk, type ToolRisk } from '../../../shared/toolRisk';

/** What a tool could do in plain words; a connector's tool names the connected app. */
export function useToolRisk(toolName: string): ToolRisk {
  return useToolRisks([toolName])[0];
}

/** The labels for several tools, in order. */
export function useToolRisks(toolNames: readonly string[]): ToolRisk[] {
  const servers = useApp((s) => s.data?.mcpServers);
  return toolNames.map((name) => toolRisk(name, name.startsWith('mcp_') ? connectorOf(name, servers) : null));
}
