import { OfficeDirectory } from './OfficeDirectory';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import {
  ArrowUpRight,
  Settings,
  BookOpen,
  Coffee,
  Files,
  LayoutGrid,
  MessageCircle,
  RotateCcw,
  Users,
  ZoomIn,
  Map,
  Library
} from 'lucide-react';

import { OfficeScene } from './scene/OfficeScene';

import { useOfficeStore } from './store/officeStore';

import { OFFICE_AGENTS, type AgentStatus } from './data/officeAgents';

// Interim floor until the campus lands: the core team and eight specialists.
const FLOOR_IDS = new Set([
  'frontend-developer',
  'backend-developer',
  'business-analyst',
  'business-development-manager',
  'devops-engineer',
  'qa-engineer',
  'ui-ux-designer',
  'data-engineer'
]);
const FLOOR_AGENTS = OFFICE_AGENTS.filter((agent) => agent.district === 'commons' || FLOOR_IDS.has(agent.id));

import { OFFICE_ZONES } from './data/officeZones';

import { AgentPortrait } from './AgentPortrait';

const zoneIcons = {
  chat: MessageCircle,

  workspaces: LayoutGrid,

  knowledge: BookOpen,

  agents: Users,

  files: Files,

  cafe: Coffee
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',

  working: 'Working',

  waiting: 'Waiting',

  completed: 'Done',

  error: 'Needs attention'
};

const shortNames: Record<string, string> = {
  'frontend-developer': 'Front-end',
  'backend-developer': 'Back-end',
  'business-development-manager': 'Business Development',
  'business-analyst': 'Business Analyst',
  'ui-ux-designer': 'UI/UX',
  'devops-engineer': 'DevOps',
  'qa-engineer': 'QA',
  'data-engineer': 'Data',

  'research-analyst': 'Analyst',

  writer: 'Writer',

  designer: 'Designer',

  'product-coach': 'Product Coach',

  'knowledge-librarian': 'Librarian',

  'files-agent': 'Files Agent',

  'marketing-strategist': 'Marketing',

  'ops-coordinator': 'Operations'
};

export function OfficeCanvas() {
  const container = useRef<HTMLDivElement>(null);

  const labels = useRef<HTMLDivElement>(null);

  const scene = useRef<OfficeScene | null>(null);

  const [failed, setFailed] = useState(false);

  const [loading, setLoading] = useState(true);

  const [hovered, setHovered] = useState<string | null>(null);

  const {
    selectedAgentId,
    focusedZoneId,
    agentRuntime,
    is3dEnabled,
    selectAgent,
    focusZone,
    toggle3d,
    openOverlay
  } = useOfficeStore();

  const visibleAgents = FLOOR_AGENTS;

  const roster = failed || !is3dEnabled;

  useEffect(() => {
    if (roster || !container.current) return;

    setLoading(true);

    const host = container.current;

    let world: OfficeScene;

    try {
      world = new OfficeScene(
        host,

        () => setFailed(true),

        () => setLoading(false),

        visibleAgents
      );

      scene.current = world;

      world.onAgentClick = (id) => {
        selectAgent(id);
        world.setSelectedAgent(id, true);
      };

      world.onAgentHover = setHovered;

      world.setSelectedAgent(useOfficeStore.getState().selectedAgentId);

      world.setLabels(Array.from(labels.current?.querySelectorAll<HTMLElement>('[data-anchor]') ?? []));

      Object.entries(useOfficeStore.getState().agentRuntime).forEach(([id, runtime]) =>
        world.updateAgentStatus(id, runtime.status)
      );
    } catch {
      host.replaceChildren();

      setFailed(true);

      return;
    }

    const observer = new ResizeObserver(() => world.handleResize());

    observer.observe(host);

    return () => {
      observer.disconnect();

      world.destroy();

      scene.current = null;
    };
  }, [roster, selectAgent, visibleAgents]);

  useEffect(() => {
    scene.current?.setSelectedAgent(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    Object.entries(agentRuntime).forEach(([id, runtime]) =>
      scene.current?.updateAgentStatus(id, runtime.status)
    );
  }, [agentRuntime]);

  const chooseAgent = (id: string) => {
    selectAgent(id);
    scene.current?.setSelectedAgent(id, true);
  };
  const reset = () => {
    scene.current?.resetCamera();

    focusZone(null);
  };

  const chooseZone = (id: string) => {
    const zone = OFFICE_ZONES.find((item) => item.id === id);

    if (!zone) return;

    focusZone(id);

    const primary =
      id === 'agents' ? visibleAgents.find((agent) => agent.district !== 'commons')?.id : zone.primaryAgentId;

    if (primary) selectAgent(primary);

    scene.current?.focusZone(zone.id);
  };

  const workingCount = Object.values(agentRuntime).filter((item) => item.status === 'working').length;

  return (
    <section className="office-viewport" aria-label="Interactive AI office">
      <header className="office-heading">
        <div>
          <span className="office-wordmark">
            Axon<span className="office-wordmark-dot">.</span>
          </span>

          <p>Your AI office for what’s next.</p>
        </div>

        <div className="office-presence">
          <span className="office-presence-dot" />

          {workingCount ? `${workingCount} working` : 'Your team is ready'}

          <small>{OFFICE_AGENTS.length} coworkers · 22 specialist departments</small>
        </div>
      </header>

      <OfficeDirectory />

      <nav className="office-navigation" aria-label="Office departments">
        <div className="office-zone-tabs">
          {OFFICE_ZONES.map((zone) => {
            const ZoneIcon = zoneIcons[zone.id as keyof typeof zoneIcons];

            return (
              <button
                key={zone.id}

                className={focusedZoneId === zone.id ? 'active' : ''}

                onClick={() => chooseZone(zone.id)}

                aria-pressed={focusedZoneId === zone.id}

                title={zone.subtitle}
              >
                <ZoneIcon size={15} />

                {zone.name}
              </button>
            );
          })}
        </div>

        <div className="office-view-controls">
          <button onClick={() => openOverlay('knowledge')} title="Open library" aria-label="Open library">
            <Library size={16} />
          </button>

          <button onClick={() => openOverlay('settings')} title="Settings" aria-label="Office settings">
            <Settings size={16} />
          </button>

          <button onClick={reset} title="Reset view" aria-label="Reset view" disabled={roster}>
            <RotateCcw size={16} />
          </button>

          <button
            onClick={() => {
              if (failed) setFailed(false);
              else toggle3d();
            }}

            title={roster ? 'Office view' : 'Team view'}

            aria-label={roster ? 'Office view' : 'Team view'}
          >
            <Map size={16} />
          </button>
        </div>
      </nav>

      {roster ? (
        <div className="office-roster-fallback">
          <div className="roster-header">
            <h2>Meet your team</h2>

            <p>
              {failed
                ? 'Office graphics are unavailable. Your coworkers are still ready to help.'
                : 'Choose a coworker to start something great.'}
            </p>
          </div>

          <div className="roster-grid">
            {visibleAgents.map((agent) => (
              <button
                className={`roster-card ${selectedAgentId === agent.id ? 'selected' : ''}`}

                key={agent.id}

                onClick={() => chooseAgent(agent.id)}

                aria-pressed={selectedAgentId === agent.id}
              >
                <AgentPortrait agent={agent} />

                <strong>{agent.name}</strong>

                <span>{agent.role}</span>

                <p>{agent.description}</p>

                <span className={`status-badge ${agentRuntime[agent.id]?.status ?? 'idle'}`}>
                  <span className="status-dot-sm" />

                  {agentRuntime[agent.id]?.status ?? 'idle'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="office-stage">
          <div
            ref={container}

            className="office-canvas-container"

            aria-label="Office floor plan. Use the named coworker buttons to select a person."
          />

          {loading && (
            <div className="office-loading" role="status">
              Opening your office…
            </div>
          )}

          <div ref={labels} className={`office-scene-labels ${loading ? 'is-loading' : ''}`}>
            {OFFICE_ZONES.map((zone) => {
              const ZoneIcon = zoneIcons[zone.id as keyof typeof zoneIcons];

              return (
                <button
                  key={zone.id}

                  data-anchor={`zone:${zone.id}`}

                  className="office-zone-label"

                  onClick={() => chooseZone(zone.id)}
                >
                  <ZoneIcon size={17} />

                  <span>
                    <strong>{zone.name}</strong>

                    <small>{zone.subtitle}</small>
                  </span>
                </button>
              );
            })}

            {visibleAgents.map((agent) => {
              const status = agentRuntime[agent.id]?.status ?? 'idle';

              const selected = selectedAgentId === agent.id;

              return (
                <button
                  key={agent.id}

                  data-anchor={`agent:${agent.id}`}

                  className={`office-person-label ${selected ? 'selected' : ''}`}

                  style={{ '--agent-color': agent.accentColor } as CSSProperties}

                  onClick={() => chooseAgent(agent.id)}

                  aria-label={`Select ${agent.name}, ${status}`}

                  aria-pressed={selected}
                >
                  <span className={`person-status ${status}`} />

                  {selected ? (
                    <span className="person-label-detail">
                      <strong>{agent.name}</strong>

                      <small>{STATUS_LABELS[status]}</small>
                    </span>
                  ) : (
                    (shortNames[agent.id] ??
                    agent.name.replace(/ (Developer|Engineer|Manager|Specialist)$/, ''))
                  )}
                </button>
              );
            })}
          </div>

          <div className="office-map-hint">
            <ZoomIn size={13} />

            <span>
              {hovered
                ? `Select ${OFFICE_AGENTS.find((a) => a.id === hovered)?.name}`
                : 'Click a coworker to begin · Scroll to zoom · Drag to explore'}
            </span>
          </div>
        </div>
      )}

      <footer className="office-team-dock">
        <div className="office-team-caption">
          <Users size={17} />

          <strong>Your team</strong>

          <span>{visibleAgents.length} on this floor</span>
        </div>

        <div className="office-team-people">
          {visibleAgents.map((agent) => (
            <button
              key={agent.id}

              onClick={() => chooseAgent(agent.id)}

              className={selectedAgentId === agent.id ? 'selected' : ''}

              aria-pressed={selectedAgentId === agent.id}

              title={agent.name}
            >
              <AgentPortrait agent={agent} />

              <span>
                {shortNames[agent.id] ?? agent.name.replace(/ (Developer|Engineer|Manager|Specialist)$/, '')}
              </span>
            </button>
          ))}
        </div>

        <button
          className="office-manage-team"

          onClick={toggle3d}

          title="Browse this team"

          aria-label="Browse this team"
        >
          <ArrowUpRight size={18} />
        </button>
      </footer>
    </section>
  );
}
