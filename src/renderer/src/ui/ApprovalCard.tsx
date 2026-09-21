import { useState } from 'react';
import { Check, ShieldAlert, Terminal, X } from 'lucide-react';
import type { ToolApprovalRequest } from '../../../shared/types';
import { Button, Icon } from './index';

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

  return (
    <div className="approval-card">
      <div className="approval-header">
        <div className="approval-title">
          <span className="approval-icon">
            <Icon icon={ShieldAlert} size="md" />
          </span>
          <strong>Tool execution approval required</strong>
        </div>
        <span className="badge badge-accent">{request.toolName}</span>
      </div>

      <div className="approval-description">
        The assistant is requesting permission to execute <code>{request.toolName}</code>
        {request.arguments.path ? (
          <>
            {' '}
            on file <code>{String(request.arguments.path)}</code>
          </>
        ) : request.arguments.command ? (
          <>
            : command <code>{String(request.arguments.command)}</code>
          </>
        ) : null}
        .
      </div>

      {preview?.type === 'diff' && (
        <div className="approval-preview-diff">
          {preview.content.split('\n').map((line, idx) => {
            const isAdd = line.startsWith('+') && !line.startsWith('+++');
            const isDel = line.startsWith('-') && !line.startsWith('---');
            const isHdr = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++');
            return (
              <div
                key={idx}
                className={`approval-diff-line ${isAdd ? 'add' : isDel ? 'del' : isHdr ? 'hdr' : ''}`}
              >
                {line}
              </div>
            );
          })}
        </div>
      )}

      {preview?.type === 'command' && (
        <div className="approval-preview-cmd">
          <Icon icon={Terminal} size="sm" />
          <span>$ {preview.content}</span>
        </div>
      )}

      <div className="approval-actions">
        <Button variant="ghost" size="sm" icon={X} disabled={submitting} onClick={() => handle(false)}>
          Reject
        </Button>
        <Button variant="secondary" size="sm" disabled={submitting} onClick={() => handle(true, true)}>
          Always allow this session
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={Check}
          disabled={submitting}
          onClick={() => handle(true, false)}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
