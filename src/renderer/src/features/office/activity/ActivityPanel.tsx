import { useEffect, useRef, useState } from 'react';
import { FilesPanel } from './FilesPanel';
import { Activity, BookOpen, FileText, MessageSquarePlus, MoreHorizontal, Sparkles } from 'lucide-react';
import { useOfficeStore } from '../store/officeStore';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useApp } from '../../../state';
import { timeAgo } from '../../../format';
import { AgentComposer } from './AgentComposer';
import { TeamList } from './TeamList';
import { AgentPortrait } from '../AgentPortrait';
import { Conversation } from './Conversation';
import { activeThread, agentThreads } from './thread';
import { LIBRARY_RESIDENTS } from '../library';
import { useEscape } from '../../../ui/escape';

const FEED_PREVIEW = 3;

export function ActivityPanel() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const data = useApp((s) => s.data);
  const { selectedAgentId, agentRuntime, startFresh, setAgentConversation, openOverlay, teamBoard } =
    useOfficeStore();
  const agent = OFFICE_AGENTS.find((a) => a.id === selectedAgentId) ?? OFFICE_AGENTS[0];
  const runtime = agentRuntime[agent.id];
  const conversations = data?.conversations ?? [];
  const conversation = activeThread(conversations, agent.id, runtime);
  const threads = agentThreads(conversations, agent.id);
  const messages = data?.messages.filter((m) => m.conversationId === conversation?.id) ?? [];
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const status =
    runtime?.status === 'idle' && assistant
      ? assistant.error
        ? 'error'
        : assistant.streaming
          ? 'working'
          : 'completed'
      : (runtime?.status ?? 'idle');
  const streaming = status === 'working';
  const activities = runtime?.activities ?? [];
  const shownActivities = feedOpen ? activities : activities.slice(0, FEED_PREVIEW);
  const libraryResident = LIBRARY_RESIDENTS.includes(agent.id);

  useEffect(() => {
    setMenuOpen(false);
    setFeedOpen(false);
  }, [agent.id]);

  // A board was clicked: the panel shows that team's tasks until you pick someone or go back.
  if (teamBoard)
    return (
      <aside className="office-activity-panel" aria-label="Team tasks">
        <TeamList team={teamBoard} />
      </aside>
    );

  return (
    <aside className="office-activity-panel" aria-label="Selected coworker activity">
      <header className="activity-header">
        <div className="activity-title-icon">
          <Activity size={23} />
        </div>
        <div>
          <h2>Activity</h2>
          <p>See what your team is working on.</p>
        </div>
        <span className={`live-badge ${streaming ? 'is-live' : ''}`}>
          <span />
          {streaming ? 'Live' : 'Ready'}
        </span>
      </header>
      <div className="activity-agent-hero">
        <AgentPortrait agent={agent} className="activity-portrait" urgent />
        <div className="activity-agent-meta">
          <span className="activity-selected-tag">Selected coworker</span>
          <h3>{agent.name}</h3>
          <p>{agent.role}</p>
          <span className={`status-badge ${status}`} role="status">
            <span className="status-dot-sm" />
            {status === 'waiting' ? 'Waiting for input' : status[0].toUpperCase() + status.slice(1)}
          </span>
        </div>
        <ConversationMenu
          open={menuOpen}
          onToggle={setMenuOpen}
          items={[
            {
              key: 'new',
              label: 'New conversation',
              icon: <MessageSquarePlus size={15} />,
              disabled: !conversation,
              onSelect: () => startFresh(agent.id)
            },
            ...(libraryResident
              ? [
                  {
                    key: 'library',
                    label: 'Manage library',
                    icon: <BookOpen size={15} />,
                    onSelect: () => openOverlay('knowledge')
                  }
                ]
              : []),
            ...threads.slice(0, 8).map((thread) => ({
              key: thread.id,
              label: thread.title,
              detail: timeAgo(thread.updatedAt),
              current: thread.id === conversation?.id,
              onSelect: () => setAgentConversation(agent.id, thread.id)
            }))
          ]}
        />
      </div>
      <div className="activity-body">
        {agent.id === 'files-agent' && <FilesPanel />}
        {!conversation && (
          <section className="current-task-card">
            <div className="activity-section-heading">
              <FileText size={15} />
              <h4>{runtime?.fresh ? 'New conversation' : 'Let’s make progress'}</h4>
            </div>
            <p className="activity-intro">{agent.description}</p>
            <div className="activity-capabilities">
              {agent.capabilities.slice(0, 3).map((cap) => (
                <span key={cap}>{cap}</span>
              ))}
            </div>
          </section>
        )}
        {activities.length > 0 && (
          <section className="activity-feed-section">
            <div className="activity-section-heading">
              <Activity size={15} />
              <h4>Recent updates</h4>
              <span className="activity-session-label">This session</span>
            </div>
            <ol className="activity-feed-list">
              {shownActivities.map((event) => (
                <li key={event.id} className={`activity-item type-${event.type}`}>
                  <time>
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {activities.length > FEED_PREVIEW && (
              <button className="activity-feed-more" onClick={() => setFeedOpen(!feedOpen)}>
                {feedOpen ? 'Show fewer' : `Show all (${activities.length})`}
              </button>
            )}
          </section>
        )}
        <Conversation
          agentName={agent.name}
          conversation={conversation}
          pendingTask={streaming ? runtime?.currentTask : undefined}
        />
        {!conversation && !activities.length && (
          <div className="activity-empty">
            <span>
              <Sparkles size={20} />
            </span>
            <strong>A clear desk. A fresh start.</strong>
            <p>
              Give {shortName(agent.name)} a task.
              <br />
              Your conversation will appear here.
            </p>
          </div>
        )}
      </div>
      <AgentComposer key={agent.id} agentId={agent.id} />
    </aside>
  );
}

interface MenuItem {
  key: string;
  label: string;
  icon?: JSX.Element;
  detail?: string;
  current?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function ConversationMenu({
  open,
  onToggle,
  items
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  items: MenuItem[];
}) {
  const root = useRef<HTMLDivElement>(null);
  useEscape(() => onToggle(false), open);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onToggle(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onToggle]);
  const actions = items.filter((item) => item.icon);
  const history = items.filter((item) => !item.icon);
  const render = (item: MenuItem) => (
    <button
      key={item.key}
      role="menuitem"
      disabled={item.disabled}
      aria-current={item.current || undefined}
      className={item.current ? 'current' : ''}
      onClick={() => {
        item.onSelect();
        onToggle(false);
      }}
    >
      {item.icon}
      <span className="activity-menu-label">{item.label}</span>
      {item.detail && <small>{item.detail}</small>}
    </button>
  );
  return (
    <div className="activity-menu-anchor" ref={root}>
      <button
        className="activity-menu-trigger"
        aria-label="Conversation options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="activity-menu" role="menu">
          {actions.map(render)}
          {history.length > 0 && <div className="activity-menu-heading">Earlier conversations</div>}
          {history.map(render)}
        </div>
      )}
    </div>
  );
}

function shortName(name: string) {
  return name === 'Research Analyst' ? 'your analyst' : `the ${name.toLowerCase()}`;
}
