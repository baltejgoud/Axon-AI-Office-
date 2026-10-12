import type { ReactNode } from 'react';
import type { Dashboard, DashboardWidget, StatWidget } from '../../../../../shared/dashboards';
import { timeAgo } from '../../../format';
import { IconExternalLink } from '../../../ui';
import { StatTile, WidgetView, openLink } from './Widgets';
import './dashboards.css';

/** "just now", "5m ago" */
export const ago = (at: number) => {
  const when = timeAgo(at);
  return when === 'now' ? 'just now' : `${when} ago`;
};

/** Stat tiles next to each other share a row; everything else is a block of its own. */
function groups(
  widgets: readonly DashboardWidget[]
): ({ stats: StatWidget[] } | { widget: DashboardWidget })[] {
  const out: ({ stats: StatWidget[] } | { widget: DashboardWidget })[] = [];
  for (const widget of widgets) {
    const last = out[out.length - 1];
    if (widget.type === 'stat' && last && 'stats' in last) last.stats.push(widget);
    else out.push(widget.type === 'stat' ? { stats: [widget] } : { widget });
  }
  return out;
}

/** A dashboard in full: its title and takeaway, the blocks in order, and where the data came from. */
export function DashboardView({ dashboard, actions }: { dashboard: Dashboard; actions?: ReactNode }) {
  return (
    <article className="dash" aria-label={`Dashboard: ${dashboard.title}`}>
      <header className="dash-head">
        <div className="dash-head-text">
          <h2>{dashboard.title}</h2>
          {dashboard.summary && <p>{dashboard.summary}</p>}
          <small>
            {dashboard.updatedAt > dashboard.createdAt ? 'Updated' : 'Shown'} {ago(dashboard.updatedAt)}
          </small>
        </div>
        {actions && <div className="dash-actions">{actions}</div>}
      </header>
      <div className="dash-grid">
        {groups(dashboard.widgets).map((group, i) =>
          'stats' in group ? (
            <div className="dash-stats wide" key={i}>
              {group.stats.map((stat, j) => (
                <StatTile key={j} widget={stat} />
              ))}
            </div>
          ) : (
            <WidgetView key={i} widget={group.widget} />
          )
        )}
      </div>
      {dashboard.sources.length > 0 && (
        <footer className="dash-sources">
          <h3>Sources</h3>
          <ul>
            {dashboard.sources.map((source, i) => (
              <li key={i}>
                {source.url ? (
                  <button
                    className="dash-source-link"
                    title={source.url}
                    onClick={() => openLink(source.url!)}
                  >
                    {source.title}
                    <IconExternalLink size={12} aria-hidden="true" />
                  </button>
                ) : (
                  source.title
                )}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}
