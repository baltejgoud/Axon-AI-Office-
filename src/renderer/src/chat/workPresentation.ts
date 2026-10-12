import type { ToolCall } from '../../../shared/types';
import { hostOf, skillLabel } from '../../../shared/runtimePresentation';
import { questionOf } from '../../../shared/askUser';

const LABELS: Record<string, string> = {
  find_skills: 'Look for skills',
  load_skill: 'Use skill',
  read_file: 'Read file',
  write_file: 'Save file',
  edit_file: 'Edit file',
  delete_file: 'Delete file',
  move_file: 'Move file',
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

function argsOf(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.arguments || '{}') ?? {};
  } catch {
    return {}; // Streaming arguments may be incomplete.
  }
}

type CallStatus = 'running' | 'completed' | 'failed';
const statusOf = (call: ToolCall): CallStatus =>
  call.error !== undefined ? 'failed' : call.result !== undefined ? 'completed' : 'running';

export function toolPresentation(call: ToolCall) {
  const args = argsOf(call);
  let target =
    call.name === 'move_file' && typeof args.from === 'string' && typeof args.to === 'string'
      ? `${args.from} → ${args.to}`
      : [args.path, args.command, args.url, args.query].find((v) => typeof v === 'string');
  const status = statusOf(call);
  let label = LABELS[call.name] ?? call.name.replace(/_/g, ' ');
  // A question to you: "Asked you: ..." with the words of the question.
  if (call.name === 'ask_user') {
    const words = questionOf(call.arguments);
    label = `${status === 'running' ? 'Asking you' : 'Asked you'}${words ? `: ${words.slice(0, 120)}` : ''}`;
    target = '';
  }
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

/**
 * A call to look up or read a skill, as a small chip: "Used skill: api-design" or "Looked for
 * skills: cold email". Null for every other call.
 */
export function skillChip(call: ToolCall): { text: string; status: CallStatus } | null {
  if (call.name !== 'load_skill' && call.name !== 'find_skills') return null;
  const args = argsOf(call);
  const status = statusOf(call);
  if (call.name === 'find_skills') {
    const query = typeof args.query === 'string' ? args.query.trim().slice(0, 80) : '';
    return {
      text: `${status === 'running' ? 'Looking for' : 'Looked for'} skills${query ? `: ${query}` : ''}`,
      status
    };
  }
  const name = typeof args.id === 'string' && args.id.trim() ? skillLabel(args.id) : '';
  const verb =
    status === 'running' ? 'Reading skill' : status === 'failed' ? "Couldn't find skill" : 'Used skill';
  return { text: `${verb}${name ? `: ${name}` : ''}`, status };
}
