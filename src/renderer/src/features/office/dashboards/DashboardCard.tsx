import type { ToolCall } from '../../../../../shared/types';
import { widgetSummary, type StatWidget } from '../../../../../shared/dashboards';
import { useApp } from '../../../state';
import { IconChartBar } from '../../../ui';
import { useOfficeStore } from '../store/officeStore';
import { ago } from './DashboardView';
import { StatTile } from './Widgets';
import './dashboards.css';

/**
 * A dashboard a coworker showed, in their conversation: the title, the first few numbers, what else
 * is on it, and Open for the whole thing. A call that failed (the model is asked to fix it) or is
 * still being written shows nothing; an earlier call of one updated since says so.
 */
export function DashboardCard({ call }: { call: ToolCall }) {
  const dashboard = useApp((s) => s.data?.dashboards?.find((d) => d.toolCallIds.includes(call.id)));
  if (!dashboard) return null;
  const stats = dashboard.widgets.filter((w): w is StatWidget => w.type === 'stat').slice(0, 4);
  const more = widgetSummary(dashboard.widgets);
  const first = dashboard.toolCallIds[0] === call.id;
  const latest = dashboard.toolCallIds[dashboard.toolCallIds.length - 1] === call.id;
  return (
    <section className="dash-card" aria-label={`Dashboard: ${dashboard.title}`}>
      <header className="dash-card-head">
        <span className="dash-card-icon" aria-hidden="true">
          <IconChartBar size={17} />
        </span>
        <span className="dash-card-title">
          <strong title={dashboard.title}>{dashboard.title}</strong>
          <small>
            {first ? 'Dashboard' : 'Dashboard updated'} · {ago(dashboard.updatedAt)}
          </small>
        </span>
        <button
          className="dash-small-button"
          onClick={() => useOfficeStore.getState().openDashboard(dashboard.id)}
        >
          Open
        </button>
      </header>
      {dashboard.summary && <p className="dash-card-summary">{dashboard.summary}</p>}
      {stats.length > 0 && (
        <div className="dash-stats">
          {stats.map((stat, i) => (
            <StatTile key={i} widget={stat} />
          ))}
        </div>
      )}
      {more && <small className="dash-card-more">Also: {more}</small>}
      {!latest && <small className="dash-card-note">Updated since. Open shows the latest.</small>}
    </section>
  );
}
