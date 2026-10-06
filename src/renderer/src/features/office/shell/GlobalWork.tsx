import { useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { ACTIVE_RUN_STATUSES } from '../../../../../shared/runtime';
import { coworkerById } from '../../../../../shared/coworkers';
export function GlobalWork() {
  const runs = useApp((s) => s.data?.runs);
  const [open, setOpen] = useState(false);
  const active = (runs ?? []).filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  return (
    <div className="global-work">
      <button className="office-presence-main" aria-expanded={open} onClick={() => setOpen(!open)}>
        {active.length
          ? `${new Set(active.map((r) => r.agentId)).size} coworkers active`
          : 'Your team is ready'}
      </button>
      {open && (
        <div className="global-work-panel">
          <strong>
            {active.filter((r) => r.status === 'working' || r.status === 'starting').length} working ·{' '}
            {active.filter((r) => r.status.startsWith('waiting') || r.status === 'queued').length} waiting
          </strong>
          {active.slice(0, 12).map((r) => (
            <button
              key={r.runId}
              onClick={() => {
                useOfficeStore.getState().focusOn({ agentId: r.agentId, conversationId: r.conversationId });
                useOfficeStore.getState().setPanelTab('updates');
                setOpen(false);
              }}
            >
              <strong>{coworkerById(r.agentId)?.name ?? r.agentId}</strong>
              <span>{r.summary ?? r.activeTool ?? r.status.replaceAll('_', ' ')}</span>
              <small>{r.status.replaceAll('_', ' ')}</small>
            </button>
          ))}
          {!active.length && <p>No active runs.</p>}
        </div>
      )}
    </div>
  );
}
