import { CalendarCheck, CalendarPlus, ListChecks, PencilLine } from 'lucide-react';
import type { ToolCall } from '../../../../../shared/types';
import { parsePlannerCall } from '../tasks';
import { useMinute } from './Planner';

const ICONS: Record<string, typeof CalendarPlus> = {
  add_task: CalendarPlus,
  update_task: PencilLine,
  complete_task: CalendarCheck,
  list_tasks: ListChecks
};

/** What the receptionist just did to the planner, in one line: "Added: Prep the deck — due Fri". */
export function PlannerToolCard({ call }: { call: ToolCall }) {
  const now = useMinute();
  const info = parsePlannerCall(call, now);
  const Icon = ICONS[call.name] ?? ListChecks;
  const listing = call.name === 'list_tasks';
  return (
    <div className={`planner-card${info.error ? ' failed' : ''}${info.pending ? ' pending' : ''}`}>
      <Icon size={14} aria-hidden="true" />
      <span className="planner-card-text">
        {listing || !info.title ? (
          <strong>{info.verb}</strong>
        ) : (
          <>
            <strong>{info.verb}:</strong> {info.title}
          </>
        )}
        {info.detail && !info.error && <small>{info.detail}</small>}
        {info.error && (
          <small className="planner-card-error">{info.error.replace('; ask the user.', '.')}</small>
        )}
      </span>
    </div>
  );
}
