import { useEffect, useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { Planner, useMinute } from '../activity/Planner';
import { groupPlanner } from '../../../../../shared/planner';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import { IconCalendar } from '../../../ui';

export function PlannerCard({ workOpen = false }: { workOpen?: boolean }) {
  const [folded, setFolded] = useState(false);
  const tasks = useApp((s) => s.data?.tasks);
  const open = useOfficeStore((s) => s.plannerOpen);
  const hidden = useOfficeStore(
    (s) => s.conversationOpen || s.focusMode || s.workFullscreen || s.coworkerCard || s.activityHistoryOpen
  );
  const approvals = useApp((s) => s.pendingApprovals);
  useEffect(() => {
    if (open) setFolded(false);
  }, [open]);
  const now = useMinute();
  const count = groupPlanner(tasks ?? [], now).today.length;
  if (hidden) return null;
  const expanded = !folded && (count > 0 || open) && ((!Object.keys(approvals).length && !workOpen) || open);
  return (
    <section
      className={`office-planner-card${expanded ? '' : ' collapsed'}${open ? ' requested' : ''}`}
      data-office-obstacle
      aria-label="Today's planner"
    >
      <header>
        <IconCalendar size={18} />
        <strong>Today</strong>
        <time>{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</time>
        <button
          onClick={() => {
            setFolded(expanded);
            useOfficeStore.getState().setPlannerOpen(!expanded);
          }}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse planner' : 'Expand planner'}
        >
          {expanded ? '−' : '+'}
        </button>
      </header>
      {expanded && (
        <>
          <Planner compact />
          <button
            className="planner-all"
            onClick={() => useOfficeStore.getState().focusOn({ agentId: RECEPTIONIST_ID, planner: true })}
          >
            Open full planner
          </button>
        </>
      )}
    </section>
  );
}
