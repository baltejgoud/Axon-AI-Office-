import type { ComponentType } from 'react';
import type { ToolCall } from '../../../../../shared/types';
import { IconCalendar, IconCheck, IconCheckList, IconCompose, type AppIconProps } from '../../../ui';
import { parsePlannerCall } from '../tasks';
import { useMinute } from './Planner';

const ICONS: Record<string, ComponentType<AppIconProps>> = {
  add_task: IconCalendar,
  update_task: IconCompose,
  complete_task: IconCheck,
  list_tasks: IconCheckList
};

/** What the receptionist just did to the planner, in one line: "Added: Prep the deck — due Fri". */
export function PlannerToolCard({ call }: { call: ToolCall }) {
  const now = useMinute();
  const info = parsePlannerCall(call, now);
  const Icon = ICONS[call.name] ?? IconCheckList;
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
