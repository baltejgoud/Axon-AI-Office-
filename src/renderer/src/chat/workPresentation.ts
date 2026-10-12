import type { ToolCall } from '../../../shared/types';
import { hostOf } from '../../../shared/runtimePresentation';

const LABELS: Record<string, string> = {
  read_file: 'Read file',
  write_file: 'Save file',
  edit_file: 'Edit file',
  list_files: 'Explore files',
  search_code: 'Search code',
  run_command: 'Run command',
  start_process: 'Start process',
  read_process: 'Read process output',
  stop_process: 'Stop process',
  web_search: 'Searched the web',
  read_webpage: 'Read a web page',
  ask_colleague: 'Consult colleague',
  call_team_meeting: 'Gather team',
  add_task: 'Create task',
  complete_task: 'Complete task',
  update_task: 'Update task'
};

export function toolPresentation(call: ToolCall) {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.arguments || '{}') ?? {};
  } catch {
    /* Streaming arguments may be incomplete. */
  }
  const target = [args.path, args.command, args.url, args.query].find((v) => typeof v === 'string');
  const status = call.error !== undefined ? 'failed' : call.result !== undefined ? 'completed' : 'running';
  let label = LABELS[call.name] ?? call.name.replace(/_/g, ' ');
  // The web: what was searched for, and which site was read (its address is the target).
  if (call.name === 'web_search') label = status === 'running' ? 'Searching the web' : 'Searched the web';
  else if (call.name === 'read_webpage' && typeof args.url === 'string' && args.url)
    label = `${status === 'running' ? 'Reading' : 'Read'} ${hostOf(args.url)}`;
  return {
    label,
    target: typeof target === 'string' ? target.slice(0, 180) : '',
    status
  } as const;
}
