import { useState } from 'react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { Button, IconCheck, IconClose, IconShieldAlert, IconTerminal } from './index';
import { DiffLines } from './DiffLines';
import { diffRows, diffStats } from '../features/office/workspace/work';

export function ApprovalCard({
  request,
  onDecision
}: {
  request: ToolApprovalRequest;
  onDecision: (approved: boolean, alwaysAllowSession?: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const handle = (approved: boolean, always = false) => {
    setSubmitting(true);
    onDecision(approved, always);
  };

  const preview = request.preview;
  const path = preview?.path ?? String(request.arguments.path ?? '');
  const stats = preview?.type === 'diff' ? diffStats(preview.content) : null;

  return (
    <div className="approval-card">
      <div className="approval-header">
        <div className="approval-title">
          <span className="approval-icon">
            <IconShieldAlert size={16} />
          </span>
          <strong>Tool execution approval required</strong>
        </div>
        <span className="badge badge-accent">{request.toolName}</span>
      </div>

      <div className="approval-description">
        {stats ? (
          stats.created ? (
            <>
              Create <code>{path}</code>: {stats.added} line{stats.added === 1 ? '' : 's'}.
            </>
          ) : (
            <>
              Save changes to <code>{path}</code>: {stats.added} added, {stats.removed} removed.
            </>
          )
        ) : (
          <>
            The assistant is requesting permission to execute <code>{request.toolName}</code>
            {request.arguments.path ? (
              <>
                {' '}
                on file <code>{String(request.arguments.path)}</code>
              </>
            ) : request.arguments.command ? (
              <>
                <span>Review the command below before approving.</span>
              </>
            ) : null}
            .
          </>
        )}
      </div>

      {preview?.type === 'diff' && (
        <div className="approval-preview-diff">
          <DiffLines rows={diffRows(preview.content)} path={path} limit={400} />
        </div>
      )}

      {preview?.type === 'command' && (
        <details className="approval-preview-cmd">
          <summary>Command · requires your permission</summary>
          <IconTerminal size={14} />
          <pre style={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{preview.content}</pre>
        </details>
      )}

      <div className="approval-actions">
        <Button
          variant="ghost"
          size="sm"
          icon={IconClose}
          disabled={submitting}
          onClick={() => handle(false)}
        >
          Reject
        </Button>
        <Button variant="secondary" size="sm" disabled={submitting} onClick={() => handle(true, true)}>
          Always allow this session
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={IconCheck}
          disabled={submitting}
          onClick={() => handle(true, false)}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
