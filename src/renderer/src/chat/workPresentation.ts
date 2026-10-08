import type { ToolCall } from '../../../shared/types';

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
  return {
    label: LABELS[call.name] ?? call.name.replace(/_/g, ' '),
    target: typeof target === 'string' ? target.slice(0, 180) : '',
    status: call.error !== undefined ? 'failed' : call.result !== undefined ? 'completed' : 'running'
  } as const;
}
