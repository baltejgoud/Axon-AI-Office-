import { useMemo, useState } from 'react';
import { perform, useApp } from '../../../state';
import { AxonLogo, Button, EmptyState, IconChartBar, IconTrash } from '../../../ui';
import { AgentPortrait } from '../AgentPortrait';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useOfficeStore } from '../store/officeStore';
import { DashboardView, ago } from './DashboardView';
import './dashboards.css';

/** Who showed a dashboard: a coworker's id, or YOU for your own chats. */
const YOU = 'you';
const agentOf = (id: string | undefined) => (id ? OFFICE_AGENTS.find((a) => a.id === id) : undefined);
const nameOf = (id: string | undefined) => (id ? (agentOf(id)?.name ?? 'A coworker') : 'You');

/**
 * Every dashboard coworkers showed, newest first, filtered by who showed it; the one you pick in
 * full, with a way back to the conversation it came from.
 */
export function DashboardsSheet() {
  const dashboards = useApp((s) => s.data?.dashboards);
  const conversations = useApp((s) => s.data?.conversations);
  const selected = useOfficeStore((s) => s.dashboardId);
  const [who, setWho] = useState('all');
  const sorted = useMemo(
    () => [...(dashboards ?? [])].sort((a, b) => b.updatedAt - a.updatedAt),
    [dashboards]
  );
  const people = useMemo(() => [...new Set(sorted.map((d) => d.agentId ?? YOU))], [sorted]);
  const shown = sorted.filter((d) => who === 'all' || (d.agentId ?? YOU) === who);
  const current = shown.find((d) => d.id === selected) ?? shown[0];

  if (!sorted.length)
    return (
      <div className="dash-sheet-empty">
        <EmptyState
          icon={IconChartBar}
          title="No dashboards yet"
          description="When a coworker gathers data worth seeing at a glance, they can show it here as charts, tables and lists. Ask one to put what they found in a dashboard."
        />
      </div>
    );

  const conversationOpen =
    current?.agentId && conversations?.some((c) => c.id === current.conversationId) ? current : null;
  const goToConversation = () => {
    if (!conversationOpen?.agentId) return;
    const office = useOfficeStore.getState();
    office.openOverlay(null);
    office.focusOn({ agentId: conversationOpen.agentId, conversationId: conversationOpen.conversationId });
    office.setPanelTab('chat');
  };

  return (
    <div className="dash-sheet">
      <aside className="dash-sheet-list" aria-label="Dashboards">
        {people.length > 1 && (
          <label className="dash-sheet-filter">
            Who
            <select value={who} onChange={(event) => setWho(event.target.value)}>
              <option value="all">Everyone</option>
              {people.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id === YOU ? undefined : id)}
                </option>
              ))}
            </select>
          </label>
        )}
        <ul className="dash-sheet-items">
          {shown.map((dashboard) => {
            const agent = agentOf(dashboard.agentId);
            return (
              <li key={dashboard.id}>
                <button
                  className="dash-sheet-item"
                  aria-current={dashboard.id === current?.id}
                  onClick={() => useOfficeStore.setState({ dashboardId: dashboard.id })}
                >
                  {agent ? (
                    <AgentPortrait agent={agent} />
                  ) : (
                    <span className="dash-sheet-axon" aria-hidden="true">
                      <AxonLogo size={18} />
                    </span>
                  )}
                  <span>
                    <strong title={dashboard.title}>{dashboard.title}</strong>
                    <small>
                      {nameOf(dashboard.agentId)} · {ago(dashboard.updatedAt)}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="dash-sheet-view">
        {current && (
          <DashboardView
            key={current.id}
            dashboard={current}
            actions={
              <>
                {conversationOpen && (
                  <Button size="sm" onClick={goToConversation}>
                    Go to conversation
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={IconTrash}
                  onClick={() => void perform(() => window.axon.dashboardDelete(current.id))}
                >
                  Delete
                </Button>
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
