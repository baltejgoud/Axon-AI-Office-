import type { AuditEntry } from './audit';
import type { AgentRun } from './runtime';
export function activitySentence(entry: AuditEntry): string {
  if (entry.decision === 'withdrawn') return 'Approval withdrawn because the task stopped.';
  if (entry.decision === 'rejected') return 'You rejected this step.';
  if (entry.result === 'error')
    return `Could not ${entry.tool.replaceAll('_', ' ')}. Open details for the reason.`;
  const path = entry.subject;
  switch (entry.tool) {
    case 'list_files':
      return 'Scanned the project for files.';
    case 'search_code':
      return 'Searched project code.';
    case 'read_file':
      return `Read ${path}`;
    case 'write_file':
    case 'edit_file':
      return `Modified ${path}${entry.change ? ` (+${entry.change.added} −${entry.change.removed})` : ''}`;
    case 'run_command':
      return entry.result === 'ok' ? 'Completed a terminal command.' : 'Requested a terminal command.';
    case 'start_process':
      return 'Started a background process.';
    case 'ask_colleague':
      return 'Asked a colleague for help.';
    case 'call_team_meeting':
      return 'Gathered a team to plan the work.';
    default:
      return entry.tool.replaceAll('_', ' ') + (entry.result === 'ok' ? ' completed.' : ' requested.');
  }
}
export function runStage(run: AgentRun): string {
  if (run.status === 'queued') return 'Waiting for provider capacity';
  if (run.status === 'waiting_for_agent') return run.summary ?? 'Waiting for colleague';
  if (run.status === 'waiting_for_approval') return 'Waiting for your approval';
  if (run.status === 'working') {
    if (run.activeTool === 'read_file' || run.activeTool === 'list_files' || run.activeTool === 'search_code')
      return 'Reading project files';
    if (run.activeTool === 'run_command' || run.activeTool === 'start_process') return 'Running command';
    return run.activeTool ? run.activeTool.replaceAll('_', ' ') : 'Thinking';
  }
  return run.status.replaceAll('_', ' ');
}
