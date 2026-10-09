import { MultiAgents } from './MultiAgents';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FilesPanel } from './FilesPanel';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconCompose,
  IconCopy,
  IconDotsHorizontal,
  IconDownload,
  IconLayoutGrid,
  IconSparkle
} from '../../../ui';
import { defaultTab, useOfficeStore, type AgentActivity, type PanelTab } from '../store/officeStore';
import { OFFICE_AGENTS, type OfficeAgent } from '../data/officeAgents';
import { perform, useApp } from '../../../state';
import { transcriptMarkdown, wholeConversation } from '../../../chat/transcript';
import type { Conversation as Thread } from '../../../../../shared/types';
import { timeAgo } from '../../../format';
import { AgentComposer } from './AgentComposer';
import { TeamList } from './TeamList';
import { AgentPortrait } from '../AgentPortrait';
import { Conversation } from './Conversation';
import { activeThread, agentThreads } from './thread';
import { LIBRARY_RESIDENTS } from '../library';
import { useEscape } from '../../../ui/escape';
import { RECEPTIONIST_ID, coworkerById } from '../../../../../shared/coworkers';
import { starters } from './starters';
import { Planner, PlannerCount } from './Planner';
import { Briefing } from './Briefing';
import { ConnectorRow } from './ConnectorRow';
import { ContextChip } from './ContextChip';
import { latestRun } from '../lifecycle';
import { LifecycleBadge } from '../shell/LifecycleBadge';

/** The panel's two presets, besides dragging its edge: wide to read in, narrow to watch the office. */
const WIDE_PANEL = 720;
const NARROW_PANEL = 400;

/** The whole conversation as Markdown: every message, not only those on screen. */
const transcriptOf = async (thread: Thread, agentName: string) =>
  transcriptMarkdown(await wholeConversation(thread.id), { title: thread.title, agentName });

/** Specialists' descriptions continue a phrase ("the browser-facing code…"); shown alone, they start a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const TAB_LABEL: Record<PanelTab, string> = {
  chat: 'Chat',
  planner: 'Planner',
  files: 'Files',
  updates: 'Multi Agents'
};

/**
 * The selected coworker's side of the office: who they are and how they're doing in one line, then
 * the conversation, which gets most of the height. Their tools (the receptionist's planner, the
 * Files room, this session's updates) are tabs beside it.
 */
export function ActivityPanel() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const drawer = useOfficeStore((s) => s.drawer);
  const [chatScroller, setChatScroller] = useState<HTMLDivElement | null>(null);
  const [jumpSlot, setJumpSlot] = useState<HTMLDivElement | null>(null);
  const data = useApp((s) => s.data);
  const {
    selectedAgentId,
    agentRuntime,
    startFresh,
    setAgentConversation,
    openOverlay,
    teamBoard,
    briefing,
    panelTab,
    setPanelTab
  } = useOfficeStore();
  const agent = OFFICE_AGENTS.find((a) => a.id === selectedAgentId) ?? OFFICE_AGENTS[0];
  const runtime = agentRuntime[agent.id];
  const conversations = data?.conversations ?? [];
  const conversation = activeThread(conversations, agent.id, runtime);
  const run = conversation ? latestRun(data?.runs ?? [], agent.id, conversation.id) : undefined;
  const pending = useApp((s) => s.pendingApprovals);
  const runStatus = Object.values(pending).some((r) => r.conversationId === conversation?.id)
    ? 'waiting_for_approval'
    : run?.status;
  const threads = agentThreads(conversations, agent.id);
  const messages = data?.messages.filter((m) => m.conversationId === conversation?.id) ?? [];
  const assistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const status =
    runtime?.status === 'idle' && assistant
      ? assistant.error
        ? 'error'
        : 'completed'
      : (runtime?.status ?? 'idle');
  // A run that ended without its answer never reads as completed.
  const stoppedEarly = Boolean(assistant?.incomplete && !assistant.streaming);
  const streaming = status === 'working';
  const activities = runtime?.activities ?? [];
  const libraryResident = LIBRARY_RESIDENTS.includes(agent.id);
  const reception = agent.id === RECEPTIONIST_ID;
  const filesRoom = agent.id === 'files-agent';

  const tabs: { id: PanelTab; count?: ReactNode }[] = [
    ...(filesRoom ? [{ id: 'files' as const }] : []),
    { id: 'chat' },
    ...(reception ? [{ id: 'planner' as const, count: <PlannerCount /> }] : []),
    { id: 'updates' as const }
  ];
  const tab = tabs.some((t) => t.id === panelTab) ? panelTab : defaultTab(agent.id);

  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [agent.id]);

  // A board was clicked: the panel shows that team's tasks until you pick someone or go back.
  if (teamBoard)
    return (
      <aside className="office-activity-panel" aria-label="Team tasks">
        <TeamList team={teamBoard} />
      </aside>
    );

  // The same words as the map, the activity list and the badges: one status language everywhere.
  const statusLabel =
    status === 'waiting' ? 'Needs you' : status === 'error' ? 'Failed' : status[0].toUpperCase() + status.slice(1);
  return (
    <aside className="office-activity-panel" aria-label="Selected coworker activity">
      <header className="activity-agent-hero">
        <button
          type="button"
          className={`activity-portrait-button status-${status}`}
          aria-label={`About the ${agent.name.toLowerCase()}`}
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen(!profileOpen)}
        >
          <AgentPortrait agent={agent} className="activity-portrait" urgent />
        </button>
        <div className="activity-agent-meta">
          <h3>
            <button type="button" title="About them" onClick={() => setProfileOpen(!profileOpen)}>
              {agent.name}
            </button>
          </h3>
          <p>
            <span className="activity-role">{agent.role}</span>
            {runStatus ? (
              <LifecycleBadge status={runStatus} stoppedEarly={stoppedEarly} />
            ) : stoppedEarly && status === 'completed' ? (
              <LifecycleBadge status="completed" stoppedEarly />
            ) : (
              <span className={`status-badge ${status}`} role="status">
                <span className="status-dot-sm" />
                {statusLabel}
              </span>
            )}
          </p>
          {conversation && <ContextChip conversation={conversation} />}
        </div>
        <div className="activity-hero-actions">
          <ConnectorRow key={agent.id} agent={agent} />
          <ConversationMenu
            open={menuOpen}
            onToggle={setMenuOpen}
            items={[
              {
                key: 'new',
                label: 'New conversation',
                icon: <IconCompose size={15} />,
                disabled: !conversation,
                onSelect: () => {
                  void (async () => {
                    if (!conversation || (await window.axon.conversationClose(conversation.id)))
                      startFresh(agent.id);
                  })();
                }
              },
              ...(conversation
                ? [
                    {
                      key: 'copy-thread',
                      label: 'Copy whole conversation',
                      icon: <IconCopy size={15} />,
                      onSelect: () =>
                        void perform(async () => {
                          await navigator.clipboard.writeText(await transcriptOf(conversation, agent.name));
                          useApp.getState().pushToast('Conversation copied');
                        })
                    },
                    {
                      key: 'save-thread',
                      label: 'Save conversation as file…',
                      icon: <IconDownload size={15} />,
                      onSelect: () =>
                        void perform(async () => {
                          const path = await window.axon.documentSave(
                            `${agent.name} - ${conversation.title}`,
                            await transcriptOf(conversation, agent.name),
                            conversation.projectRoot
                          );
                          if (path) useApp.getState().pushToast(`Saved to ${path}`);
                        })
                    }
                  ]
                : []),
              {
                key: 'dock',
                label: drawer.side === 'right' ? 'Move panel to the left' : 'Move panel to the right',
                icon: drawer.side === 'right' ? <IconArrowLeft size={15} /> : <IconArrowRight size={15} />,
                onSelect: () =>
                  useOfficeStore.getState().setDrawer({ side: drawer.side === 'right' ? 'left' : 'right' })
              },
              {
                key: 'width',
                label: drawer.width < WIDE_PANEL ? 'Wide panel, for reading' : 'Narrow panel, to see the office',
                icon: <IconLayoutGrid size={15} />,
                onSelect: () =>
                  useOfficeStore.getState().setDrawer({
                    width: drawer.width < WIDE_PANEL ? Math.min(WIDE_PANEL, window.innerWidth - 160) : NARROW_PANEL
                  })
              },
              ...(libraryResident
                ? [
                    {
                      key: 'library',
                      label: 'Manage library',
                      icon: <IconBook size={15} />,
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
        {profileOpen && <Profile agent={agent} onClose={() => setProfileOpen(false)} />}
      </header>
      {tabs.length > 1 && (
        <div className="activity-tabs" role="tablist" aria-label={`${agent.name}’s panel`}>
          {tabs.map(({ id, count }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`activity-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`activity-panel-${id}`}
              className={tab === id ? 'active' : ''}
              onClick={() => setPanelTab(id)}
            >
              {TAB_LABEL[id]}
              {count}
            </button>
          ))}
        </div>
      )}
      {filesRoom && (
        <TabPanel id="files" hidden={tab !== 'files'}>
          <FilesPanel />
        </TabPanel>
      )}
      {/* The chat stays mounted behind other tabs, so its scroll and streaming carry on. */}
      <TabPanel id="chat" hidden={tab !== 'chat'} labelled={tabs.length > 1} scrollRef={setChatScroller}>
        {reception && briefing && <Briefing briefing={briefing} />}
        {!conversation && !(reception && briefing) && (
          <div className="activity-empty">
            <span>
              <IconSparkle size={18} />
            </span>
            <strong>{runtime?.fresh ? 'A new conversation' : 'A clear desk. A fresh start.'}</strong>
            <p>{sentence(agent.description)}</p>
            <div className="activity-starters" role="group" aria-label="Ways to start">
              <small>Try asking</small>
              {starters(coworkerById(agent.id) ?? agent).map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  title={starter.prompt}
                  onClick={() => useOfficeStore.getState().compose(agent.id, starter.prompt)}
                >
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Conversation
          agentName={agent.name}
          conversation={conversation}
          pendingTask={streaming || status === 'waiting' ? runtime?.currentTask : undefined}
          working={streaming || status === 'waiting'}
          shown={tab === 'chat'}
          onContinue={() =>
            useOfficeStore
              .getState()
              .compose(agent.id, 'Continue where you left off and finish the answer.', true)
          }
          scrollParent={chatScroller}
          jumpSlot={jumpSlot}
        />
      </TabPanel>
      <div className="chat-jump-row" ref={setJumpSlot} hidden={tab !== 'chat'} />
      {tab === 'planner' && (
        <TabPanel id="planner">
          <Planner />
        </TabPanel>
      )}
      {tab === 'updates' && (
        <TabPanel id="updates">
          <MultiAgents conversationId={conversation?.id} activities={activities} />
        </TabPanel>
      )}
      <AgentComposer key={agent.id} agentId={agent.id} />
    </aside>
  );
}

function TabPanel({
  id,
  hidden = false,
  labelled = true,
  scrollRef,
  children
}: {
  id: PanelTab;
  hidden?: boolean;
  /** Only when there are tabs to be labelled by. */
  labelled?: boolean;
  /** The panel's scroll area, for content that scrolls with it (the thread). */
  scrollRef?: (element: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={scrollRef}
      className={`activity-body activity-tabpanel-${id}`}
      id={`activity-panel-${id}`}
      role={labelled ? 'tabpanel' : undefined}
      aria-labelledby={labelled ? `activity-tab-${id}` : undefined}
      hidden={hidden}
    >
      {children}
    </div>
  );
}

/** What happened with this coworker this session, newest first. */
function Updates({ activities }: { activities: AgentActivity[] }) {
  return (
    <section className="activity-feed-section" aria-label="This session’s updates">
      <ol className="activity-feed-list">
        {activities.map((event) => (
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
    </section>
  );
}

/** Who they are, from their portrait or name: what they do and what they're good at. */
function Profile({ agent, onClose }: { agent: OfficeAgent; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element;
      // The portrait and name toggle it themselves.
      if (
        !root.current?.contains(target) &&
        !target.closest?.('.activity-portrait-button, .activity-agent-meta h3')
      )
        onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div
      className="activity-profile"
      role="dialog"
      aria-label={`About the ${agent.name.toLowerCase()}`}
      ref={root}
    >
      <div className="activity-profile-head">
        <AgentPortrait agent={agent} className="activity-profile-portrait" />
        <div>
          <strong>{agent.name}</strong>
          <small>
            {agent.role === agent.department ? agent.role : `${agent.role} · ${agent.department}`}
          </small>
        </div>
      </div>
      <p>{sentence(agent.description)}</p>
      {agent.capabilities.length > 0 && (
        <div className="activity-capabilities">
          {agent.capabilities.map((cap) => (
            <span key={cap}>{cap}</span>
          ))}
        </div>
      )}
    </div>
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
      data-action={item.key}
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
        title="Conversations and more"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        <IconDotsHorizontal size={16} />
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
