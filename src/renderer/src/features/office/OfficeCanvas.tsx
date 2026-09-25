import './shell/shell.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Library, RotateCcw, Scan, Settings, ZoomIn } from 'lucide-react';
import { OfficeScene, type OfficeView } from './scene/OfficeScene';
import { loadOfficeModels, officeModelsLoaded } from './scene/room/models';
import { useOfficeStore } from './store/officeStore';
import { OFFICE_AGENTS, type AgentStatus } from './data/officeAgents';
import { DISTRICTS, districtById, type DistrictId } from './campus/districts';
import { AgentPortrait } from './AgentPortrait';
import { OfficeDirectory } from './OfficeDirectory';
import { DistrictChips } from './shell/DistrictChips';
import { DepartmentMenu, type DepartmentChoice } from './shell/DepartmentMenu';
import { Minimap } from './shell/Minimap';
import { SceneLabels, taggedPeople } from './shell/SceneLabels';
import { TeamStrip } from './shell/TeamStrip';
import { departmentFrame, districtAt, districtFrame, labelTier } from './shell/framing';
import type { Vec2, ZoneId } from './simulation/types';
import type { SignSpec } from './campus/signs';
import { useApp } from '../../state';
import { activeHelp } from './tasks';
import { TASK_BOARDS } from './campus/boards';
import { RECEPTIONIST_ID } from '../../../../shared/coworkers';

export function OfficeCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The furniture models load once, before the office is first built (the loading note shows meanwhile).
  const [modelsReady, setModelsReady] = useState(officeModelsLoaded);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<OfficeView | null>(null);
  const tasks = useApp((s) => s.data?.tasks);
  /** Colleagues over at someone's desk, helper → host, as last sent to the scene. */
  const helping = useRef(new Map<string, string>());
  const syncHelp = useCallback((world: OfficeScene, pairs: { helper: string; host: string }[]) => {
    const next = new Map(pairs.map((pair) => [pair.helper, pair.host]));
    for (const [helper, host] of helping.current) if (next.get(helper) !== host) world.endHelp(helper);
    for (const [helper, host] of next)
      if (helping.current.get(helper) !== host) world.startHelp(helper, host);
    helping.current = next;
  }, []);
  /** The latest sign handler; the scene is created once and calls through this. */
  const signClick = useRef<(sign: SignSpec) => void>(() => {});
  const {
    selectedAgentId,
    agentRuntime,
    is3dEnabled,
    focusDepartment,
    flyTo,
    selectAgent,
    flyToAgent,
    toggle3d,
    openOverlay,
    setFocusDepartment
  } = useOfficeStore();
  const roster = failed || !is3dEnabled;

  useEffect(() => {
    if (modelsReady) return;
    let live = true;
    void loadOfficeModels().then(() => live && setModelsReady(true));
    return () => {
      live = false;
    };
  }, [modelsReady]);

  useEffect(() => {
    if (roster || !modelsReady || !container.current) return;
    setLoading(true);
    const host = container.current;
    let world: OfficeScene;
    try {
      world = new OfficeScene(
        host,
        () => setFailed(true),
        () => setLoading(false)
      );
      scene.current = world;
      world.onAgentClick = (id) => {
        selectAgent(id);
        world.setSelectedAgent(id, true);
      };
      world.onAgentHover = setHovered;
      world.onViewChange = setView;
      world.onFilesClick = () => useOfficeStore.getState().flyToAgent('files-agent');
      world.onLibraryClick = () => useOfficeStore.getState().openOverlay('knowledge');
      world.onSignClick = (sign) => signClick.current(sign);
      // A team's board opens its task list; the Today board goes to the receptionist's planner.
      world.onBoardClick = (team) =>
        TASK_BOARDS.find((board) => board.team === team)?.kind === 'today'
          ? useOfficeStore.getState().focusOn({ agentId: RECEPTIONIST_ID, planner: true })
          : useOfficeStore.getState().openTeamBoard(team);
      world.setTasks(useApp.getState().data?.tasks ?? []);
      world.setSelectedAgent(useOfficeStore.getState().selectedAgentId);
      Object.entries(useOfficeStore.getState().agentRuntime).forEach(([id, runtime]) =>
        world.updateAgentStatus(id, runtime.status)
      );
      helping.current = new Map();
      syncHelp(world, activeHelp(useApp.getState().data?.tasks ?? []));
    } catch (error) {
      // The roster stands in for the office; say why, for anyone reading the console.
      console.error('Office graphics could not start:', error);
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
  }, [roster, modelsReady, selectAgent, syncHelp]);

  useEffect(() => {
    scene.current?.setSelectedAgent(selectedAgentId);
    // Picking someone outside the chosen department lets the strip follow the camera again.
    const store = useOfficeStore.getState();
    const person = OFFICE_AGENTS.find((agent) => agent.id === selectedAgentId);
    if (store.focusDepartment && person && person.department !== store.focusDepartment)
      store.setFocusDepartment(null);
    // With the Files room open, the Files Agent goes to the cabinets.
    if (selectedAgentId === 'files-agent') scene.current?.sendTo('files-agent', 'cabinet');
  }, [selectedAgentId]);

  // Someone asked the office to go to a person (handing over files, clicking the cabinets).
  useEffect(() => {
    if (flyTo) scene.current?.setSelectedAgent(flyTo.agentId, true);
  }, [flyTo]);

  // Colleagues walk over while they help, and back once the run that asked is over.
  useEffect(() => {
    if (!scene.current) return;
    scene.current.setTasks(tasks ?? []);
    syncHelp(scene.current, activeHelp(tasks ?? []));
  }, [tasks, syncHelp]);

  // The Today board's day labels move on with the clock.
  useEffect(() => {
    const timer = setInterval(() => scene.current?.setTasks(useApp.getState().data?.tasks ?? []), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Object.entries(agentRuntime).forEach(([id, runtime]) =>
      scene.current?.updateAgentStatus(id, runtime.status)
    );
  }, [agentRuntime]);

  const statuses = useMemo(
    () =>
      Object.fromEntries(Object.entries(agentRuntime).map(([id, runtime]) => [id, runtime.status])) as Record<
        string,
        AgentStatus
      >,
    [agentRuntime]
  );
  const working = Object.keys(statuses).filter(
    (id) => statuses[id] === 'working' || statuses[id] === 'waiting'
  );

  // Labels follow the zoom: districts from afar, departments in between, people up close.
  const tier = labelTier(view?.bounds ?? null);
  const tagged = useMemo(
    () => (view ? taggedPeople(view.bounds, view.target, statuses, selectedAgentId) : [selectedAgentId]),
    [view, statuses, selectedAgentId]
  );
  const labelKey = `${tier}|${tagged.join(',')}|${selectedAgentId}|${loading}`;
  useLayoutEffect(() => {
    scene.current?.setLabels(
      Array.from(labels.current?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])
    );
  }, [labelKey]);

  const viewDistrict: DistrictId = view ? districtAt(view.target) : 'commons';

  const chooseAgent = useCallback(
    (id: string) => {
      selectAgent(id);
      scene.current?.setSelectedAgent(id, true);
    },
    [selectAgent]
  );
  const chooseDistrict = (id: DistrictId) => {
    const frame = districtFrame(id);
    setFocusDepartment(null);
    scene.current?.focusPoint(frame.point, frame.span);
  };
  const chooseDepartment = (name: string) => {
    const frame = departmentFrame(name);
    setFocusDepartment(name);
    if (frame) scene.current?.focusPoint(frame.point, frame.span);
  };
  const chooseRoom = (zone: ZoneId) => {
    setFocusDepartment(null);
    // The Files room opens the folder wall with the Files Agent.
    if (zone === 'files') flyToAgent('files-agent');
    else scene.current?.focusZone(zone);
  };
  signClick.current = (sign) => {
    if (sign.kind === 'district') chooseDistrict(sign.target as DistrictId);
  };
  const chooseFromMenu = (choice: DepartmentChoice) =>
    choice.kind === 'department' ? chooseDepartment(choice.name) : chooseRoom(choice.zone);
  const look = (point: Vec2) => scene.current?.lookAt(point);

  // The team strip shows the department you picked, else the district in view.
  const strip = useMemo(() => {
    if (focusDepartment)
      return {
        title: focusDepartment,
        people: OFFICE_AGENTS.filter((a) => a.department === focusDepartment)
      };
    const district = districtById(viewDistrict);
    return {
      title: district.id === 'commons' ? 'Commons · core team' : district.name,
      people: OFFICE_AGENTS.filter((a) => a.district === district.id)
    };
  }, [focusDepartment, viewDistrict]);

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
          {working.length ? `${working.length} working right now` : 'Your team is ready'}
          <small>
            {OFFICE_AGENTS.length} coworkers · {DISTRICTS.reduce((n, d) => n + d.departments.length, 0)}{' '}
            departments
          </small>
        </div>
      </header>

      <div className="office-directory">
        <DepartmentMenu current={focusDepartment} onChoose={chooseFromMenu} />
        <OfficeDirectory onChoose={chooseAgent} />
      </div>

      <nav className="office-navigation" aria-label="Office districts">
        <DistrictChips active={roster ? null : viewDistrict} onChoose={chooseDistrict} />
        <div className="office-view-controls">
          <button onClick={() => openOverlay('knowledge')} title="Open library" aria-label="Open library">
            <Library size={16} />
          </button>
          <button onClick={() => openOverlay('settings')} title="Settings" aria-label="Office settings">
            <Settings size={16} />
          </button>
          <button
            onClick={() => scene.current?.overview()}
            title="Whole campus"
            aria-label="Whole campus"
            disabled={roster}
          >
            <Scan size={16} />
          </button>
          <button
            onClick={() => {
              setFocusDepartment(null);
              scene.current?.resetCamera();
            }}
            title="Back to the Commons"
            aria-label="Reset view"
            disabled={roster}
          >
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
            <LayoutGrid size={16} />
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
          {DISTRICTS.map((district) => (
            <section key={district.id} className="roster-district" aria-label={district.name}>
              <h3>
                <span className="office-district-swatch" style={{ background: district.color }} />
                {district.name}
              </h3>
              <div className="roster-grid">
                {OFFICE_AGENTS.filter((agent) => agent.district === district.id).map((agent) => (
                  <button
                    className={`roster-card ${selectedAgentId === agent.id ? 'selected' : ''}`}
                    key={agent.id}
                    onClick={() => chooseAgent(agent.id)}
                    aria-pressed={selectedAgentId === agent.id}
                  >
                    <AgentPortrait agent={agent} />
                    <strong>{agent.name}</strong>
                    <span>{agent.department}</span>
                    <span className={`status-badge ${statuses[agent.id] ?? 'idle'}`}>
                      <span className="status-dot-sm" />
                      {statuses[agent.id] ?? 'idle'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
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
          <SceneLabels
            ref={labels}
            tier={tier}
            people={tagged}
            selectedId={selectedAgentId}
            statuses={statuses}
            loading={loading}
            onAgent={chooseAgent}
          />
          {!loading && (
            <Minimap
              view={view?.bounds ?? null}
              working={working}
              selectedId={selectedAgentId}
              onLook={look}
            />
          )}
          <div className="office-map-hint">
            <ZoomIn size={13} />
            <span>
              {hovered
                ? `Select ${OFFICE_AGENTS.find((a) => a.id === hovered)?.name}`
                : 'Click anyone to start · Scroll to zoom · Drag to explore'}
            </span>
          </div>
        </div>
      )}

      <TeamStrip
        title={strip.title}
        people={strip.people}
        selectedId={selectedAgentId}
        onChoose={chooseAgent}
      />
    </section>
  );
}
