import { useState } from 'react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { Button, IconCheck, IconClose, IconShieldAlert, IconTerminal } from './index';
import { DiffLines } from './DiffLines';
import { diffRows, diffStats } from '../features/office/workspace/work';
import { toolPresentation } from '../chat/workPresentation';
import { useToolRisk } from '../chat/useToolRisk';
import { RiskLabel } from './RiskLabel';

const SHORTCUT = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';

/**
 * A tool waiting for your OK, in one line first (what and where), then the change or command to
 * look at. Approve once, approve for the rest of this task, or reject; Ctrl+Enter approves.
 */
export function ApprovalCard({
  request,
  onDecision
}: {
  request: ToolApprovalRequest;
  onDecision: (approved: boolean, grant?: 'task' | 'session') => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const risk = useToolRisk(request.toolName);

  const handle = (approved: boolean, grant?: 'task' | 'session') => {
    setSubmitting(true);
    onDecision(approved, grant);
  };

  const preview = request.preview;
  const path = preview?.path ?? String(request.arguments.path ?? '');
  const stats = preview?.type === 'diff' ? diffStats(preview.content) : null;
  const shown = toolPresentation({ id: request.toolCallId, name: request.toolName, arguments: JSON.stringify(request.arguments) });
  // Deleting or moving a file: its preview is a headline ("Delete a.txt (12 lines, 340 bytes)") and then the file's first lines.
  const fileOp = request.toolName === 'delete_file' || request.toolName === 'move_file';
  const [headline, ...rest] = fileOp && preview?.type === 'generic' ? preview.content.split('\n') : [];
  const detail = rest.join('\n').trim();
  const summary = stats
    ? stats.created
      ? `Create ${path} · ${stats.added} line${stats.added === 1 ? '' : 's'}`
      : `Save ${path} · +${stats.added} −${stats.removed}`
    : headline
      ? headline
      : `${shown.label}${shown.target ? ` · ${shown.target}` : ''}`;
  // For these, "always" and "for this task" cover only this exact file (or move), never every file.
  const exact = request.toolName === 'delete_file' ? 'this file' : 'this move';

  return (
    <div className="approval-card">
      <div className="approval-header">
        <div className="approval-title">
          <span className="approval-icon">
            <IconShieldAlert size={16} />
          </span>
          <strong>Needs your OK</strong>
          <RiskLabel risk={risk} />
          <span className="approval-summary" title={summary}>
            {summary}
          </span>
        </div>
      </div>

      {preview?.type === 'diff' && (
        <div className="approval-preview-diff">
          <DiffLines rows={diffRows(preview.content)} path={path} limit={400} />
        </div>
      )}

      {fileOp && detail && <pre className="tool-call-pre scrollable">{detail}</pre>}

      {preview?.type === 'command' && (
        <details className="approval-preview-cmd" open>
          <summary>
            <IconTerminal size={14} /> Command
          </summary>
          <pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{preview.content}</pre>
        </details>
      )}

      <div className="approval-actions">
        <button
          type="button"
          className="approval-session"
          disabled={submitting}
          title={fileOp ? `Don’t ask again for ${exact} until Axon restarts` : 'Don’t ask again until Axon restarts'}
          onClick={() => handle(true, 'session')}
        >
          {fileOp ? `Always allow ${exact} this session` : 'Always allow this session'}
        </button>
        <Button variant="ghost" size="sm" icon={IconClose} disabled={submitting} onClick={() => handle(false)}>
          Reject
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={submitting}
          title={fileOp ? `Don’t ask again for ${exact} until this task is done` : 'Don’t ask again for this tool until this task is done'}
          onClick={() => handle(true, 'task')}
        >
          Allow for this task
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={IconCheck}
          disabled={submitting}
          title={`Approve (${SHORTCUT}+Enter)`}
          onClick={() => handle(true)}
        >
          Approve <kbd className="approval-kbd">{SHORTCUT}+Enter</kbd>
        </Button>
      </div>
    </div>
  );
}
