import { ACTIVE_RUN_STATUSES } from '../../../../shared/runtime';
import { PlannerCard } from './shell/PlannerCard';
import { GlobalWork } from './shell/GlobalWork';
import './shell/shell.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  IconCode,
  IconLayoutGrid,
  IconBook,
  IconRotateCcw,
  IconScan,
  IconLock,
  IconSettings,
  IconSparkle,
  IconUnlock,
  IconZoomIn
} from '../../ui';
import { OfficeScene, type OfficeView } from './scene/OfficeScene';
import { loadOfficeModels, officeModelsLoaded } from './scene/room/models';
import { useOfficeStore } from './store/officeStore';
import { OFFICE_AGENTS, type AgentStatus } from './data/officeAgents';
import { DISTRICTS, districtById, type DistrictId } from './campus/districts';
import { AgentPortrait } from './AgentPortrait';
import { ColleagueSummary } from './ColleagueSummary';
import { OfficeDirectory } from './OfficeDirectory';
import { DistrictChips } from './shell/DistrictChips';
import { AccountButton } from './shell/AccountButton';
import { NotificationBell } from './shell/NotificationBell';
import { DepartmentMenu, type DepartmentChoice } from './shell/DepartmentMenu';
import { Minimap } from './shell/Minimap';
import { SceneLabels, markerKey, taggedPeople } from './shell/SceneLabels';
import { TeamStrip } from './shell/TeamStrip';
import { WaitingPill } from './shell/WaitingPill';
import { waitingStatus } from './waiting';
import { SHORTCUT_KEY } from './workspace/WorkViews';
import { departmentFrame, districtAt, districtFrame, labelTier } from './shell/framing';
import type { Vec2, ZoneId } from './simulation/types';
import type { SignSpec } from './campus/signs';
import type { Team } from '../../../../shared/types';
import { useApp } from '../../state';
import { consultVisits, VisitDirector } from './visits';
import { markersFor } from './presence';
import { openMeetings, roomBoardCards } from './team';
import { roomOf } from '../../../../shared/rooms';
import { TASK_BOARDS } from './campus/boards';
import { RECEPTIONIST_ID } from '../../../../shared/coworkers';
import { latestRun, runLifecycle } from './lifecycle';
import { activeThread } from './activity/thread';
import type { Team as BoardTeam } from './tasks';
import { departmentHere } from './shell/spatialLabels';

/** Whether the camera stays put for drags and the wheel, kept on this computer. */
const CAMERA_LOCK_KEY = 'axon.cameraLocked';
const readCameraLocked = () => {
  try {
    return localStorage.getItem(CAMERA_LOCK_KEY) === '1';
  } catch {
    return false;
  }
};

/** The team meeting or working in a room now, newest first: what its board opens. */
const openTeamIn = (room: string) =>
  [...(useApp.getState().data?.teams ?? [])]
    .filter(
      (t) =>
        (['meeting', 'planned', 'working', 'reporting'].includes(t.status) ||
          (t.status === 'failed' && !!t.plan)) &&
        roomOf(t) === room
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

/** What clicking a board does, in a few words, for the label by the pointer. */
function boardHint(team: BoardTeam): string {
  const board = TASK_BOARDS.find((b) => b.team === team);
  if (!board) return '';
  if (board.kind === 'today') return 'Today: open the planner';
  if (board.room) {
    if (openTeamIn(board.room)) return `${board.title}: open the team’s conversation`;
    if (board.kind === 'meeting') return `${board.title}: no meeting here now`;
  }
  return `${board.title}: open team tasks`;
}

export function OfficeCanvas({
  work
}: {
  /** The selected coworker's work surface, when they have used a tool: whether it is open, and a toggle. */
  work?: { open: boolean; toggle: () => void };
}) {
  const container = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const labels = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The furniture models load once, before the office is first built (the loading note shows meanwhile).
  const [modelsReady, setModelsReady] = useState(officeModelsLoaded);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<OfficeView | null>(null);
  const tasks = useApp((s) => s.data?.tasks);
  /**
   * Who is over at whose desk right now, asking a colleague something: the asker visits the one
   * they asked, until that colleague has answered. Keeps asking the scene for visits that could not
   * start yet (the visiting spot was taken).
   */
  const visiting = useRef<VisitDirector | null>(null);
  const visits = useMemo(() => consultVisits(tasks ?? [], Date.now()), [tasks]);
  const teams = useApp((s) => s.data?.teams);
  const runs = useApp((s) => s.data?.runs);
  const conversations = useApp((s) => s.data?.conversations);
  const messages = useApp((s) => s.data?.messages);
  const approvals = useApp((s) => s.pendingApprovals);
  /** Teams in their rooms, as last sent to the scene. */
  const meeting = useRef(new Set<string>());
  const syncTeams = useCallback((world: OfficeScene, all: readonly Team[]) => {
    const now = openMeetings(all);
    const next = new Set(now.map((m) => m.id));
    for (const key of meeting.current) if (!next.has(key)) world.endTeamMeeting(key);
    // Every time, so whose team task is running stays current.
    for (const m of now) {
      const teamWorkers = (useApp.getState().data?.runs ?? [])
        .filter((r) => r.teamId === m.id && ACTIVE_RUN_STATUSES.has(r.status))
        .map((r) => r.agentId);
      world.startTeamMeeting(m.id, m.leadId, m.attendees, m.room, [
        ...new Set([...m.working, ...teamWorkers])
      ]);
    }
    meeting.current = next;
    world.setRoomBoards(roomBoardCards(all));
  }, []);
  /** The latest sign handler; the scene is created once and calls through this. */
  const signClick = useRef<(sign: SignSpec) => void>(() => {});
  const hoverTip = useRef<HTMLDivElement>(null);
  const [cameraLocked, lockCamera] = useState(readCameraLocked);
  const setCameraLocked = (locked: boolean) => {
    lockCamera(locked);
    try {
      localStorage.setItem(CAMERA_LOCK_KEY, locked ? '1' : '0');
    } catch {
      // Locked for this session only.
    }
  };
  const {
    selectedAgentId,
    coworkerCard,
    conversationOpen,
    dockCollapsed,
    focusMode,
    agentRuntime,
    is3dEnabled,
    focusDepartment,
    flyTo,
    selectAgent,
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
      world.onPinOccluded = () => useOfficeStore.getState().openConversation();
      world.onEmptyClick = () => useOfficeStore.getState().closeCoworkerCard();
      world.onAgentHover = setHovered;
      world.onViewChange = setView;
      world.onFilesClick = () => useOfficeStore.getState().focusOn({ agentId: 'files-agent' });
      world.onLibraryClick = () => useOfficeStore.getState().openOverlay('knowledge');
      world.onSignClick = (sign) => signClick.current(sign);
      // A short label by the pointer: what a click on this sign or board does, before you click.
      world.onTargetHover = (target, x, y) => {
        const tip = hoverTip.current;
        if (!tip) return;
        const text = !target ? '' : 'sign' in target ? `Go to ${target.sign.title}` : boardHint(target.board);
        tip.hidden = !text;
        if (!text) return;
        tip.textContent = text;
        const box = tip.parentElement!.getBoundingClientRect();
        tip.style.left = `${x - box.left + 14}px`;
        tip.style.top = `${y - box.top + 18}px`;
      };
      // A team's board opens its task list; the Today board goes to the receptionist's planner. A
      // board never moves the camera: what it opens comes up beside you.
      world.onBoardClick = (team) => {
        const board = TASK_BOARDS.find((b) => b.team === team);
        if (board?.kind === 'today')
          return useOfficeStore
            .getState()
            .focusOn({ agentId: RECEPTIONIST_ID, planner: true }, { fly: false });
        // A meeting room's board: the lead's conversation with the team in that room.
        if (board?.room) {
          const open = openTeamIn(board.room);
          if (open)
            return useOfficeStore
              .getState()
              .focusOn({ agentId: open.leadId, conversationId: open.conversationId }, { fly: false });
          if (board.kind === 'meeting') return;
        }
        useOfficeStore.getState().openTeamBoard(team);
      };
      world.setTasks(useApp.getState().data?.tasks ?? []);
      world.setSelectedAgent(useOfficeStore.getState().selectedAgentId);
      Object.entries(useOfficeStore.getState().agentRuntime).forEach(([id, runtime]) =>
        world.updateAgentStatus(id, runtime.status)
      );
      visiting.current = new VisitDirector({
        startHelp: (visitor, host) => world.startHelp(visitor, host),
        endHelp: (visitor) => world.endHelp(visitor),
        get walks() {
          return world.walks;
        }
      });
      visiting.current.sync(consultVisits(useApp.getState().data?.tasks ?? [], Date.now()));
      meeting.current = new Set();
      syncTeams(world, useApp.getState().data?.teams ?? []);
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
      visiting.current = null;
    };
  }, [roster, modelsReady, selectAgent, syncTeams]);

  // The camera lock holds for the scene as it is now, and for one made again (after the roster).
  useEffect(() => {
    scene.current?.setCameraLocked(cameraLocked);
  }, [cameraLocked, loading, roster]);

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

  // Someone who asks a colleague a question walks over to their desk, and back once the colleague
  // has answered.
  useEffect(() => {
    if (!scene.current) return;
    scene.current.setTasks(tasks ?? []);
    visiting.current?.sync(visits);
  }, [tasks, visits]);

  // A visit that couldn't start (someone is already at that desk) tries again every second.
  useEffect(() => {
    const timer = setInterval(() => visiting.current?.retry(), 1000);
    return () => clearInterval(timer);
  }, []);

  // A team meeting gathers its people in the boardroom; its board shows the team's goal, then its tasks.
  useEffect(() => {
    if (scene.current) syncTeams(scene.current, teams ?? []);
  }, [teams, runs, syncTeams]);

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
  // People "Find a person" found keep their name tags at every zoom, wherever they are.
  const found = useOfficeStore((s) => s.mapHighlight);
  const tagged = useMemo(() => {
    const near = view ? taggedPeople(view.bounds, view.target, statuses, selectedAgentId) : [selectedAgentId];
    return [...new Set([...near, ...found])];
  }, [view, statuses, selectedAgentId, found]);
  useEffect(() => {
    scene.current?.highlightPeople(found);
  }, [found, loading, roster]);
  // The badge or bubble over each person: needs you, just finished, asking or answering a colleague,
  // or quietly working. The scene moves them with the people; React only redraws when one changes.
  const beacons = useOfficeStore((s) => s.beacons);
  const markers = useMemo(
    () =>
      markersFor({
        statuses,
        beacons,
        visits,
        nameOf: (id) => OFFICE_AGENTS.find((agent) => agent.id === id)?.name
      }),
    [statuses, beacons, visits]
  );
  const labelKey = `${view?.target.x.toFixed(1)}|${view?.target.z.toFixed(1)}|${tier}|${tagged.join(',')}|${selectedAgentId}|${loading}|${markerKey(markers)}`;
  useLayoutEffect(() => {
    scene.current?.setLabels(
      Array.from(labels.current?.querySelectorAll<HTMLElement>('[data-anchor]') ?? [])
    );
  }, [labelKey]);

  useLayoutEffect(() => {
    scene.current?.setPins(pin.current && coworkerCard && !focusMode ? [pin.current] : []);
  }, [coworkerCard, selectedAgentId, focusMode, loading, modelsReady, roster]);
  const selected = OFFICE_AGENTS.find((a) => a.id === selectedAgentId) ?? OFFICE_AGENTS[0];
  const thread = activeThread(conversations ?? [], selected.id, agentRuntime[selected.id]);
  const selectedRun = thread ? latestRun(runs ?? [], selected.id, thread.id) : undefined;
  const pendingRequest = Object.values(approvals).find((r) => r.conversationId === thread?.id);
  const selectedStatus = waitingStatus(Object.values(approvals), thread?.id) ?? selectedRun?.status;
  const latestResponse = useMemo(
    () =>
      [...(messages ?? [])]
        .reverse()
        .find(
          (m) =>
            m.conversationId === thread?.id &&
            m.role === 'assistant' &&
            m.content.trim() &&
            (!selectedRun || m.createdAt >= selectedRun.startedAt)
        )?.content,
    [messages, thread?.id, selectedRun?.startedAt]
  );
  const message = (ask = false) => {
    useOfficeStore.getState().openConversation('chat');
    if (ask)
      requestAnimationFrame(() =>
        document.querySelector<HTMLTextAreaElement>('.conversation-drawer textarea')?.focus()
      );
  };
  const viewDistrict: DistrictId = view ? districtAt(view.target) : 'commons';
  const here = view ? departmentHere(viewDistrict, view.target) : undefined;

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
  const navigation = useOfficeStore((s) => s.navigationRequest);
  useEffect(() => {
    if (!navigation) return;
    if (navigation.department) chooseDepartment(navigation.department);
    else if (navigation.overview) {
      setFocusDepartment(null);
      scene.current?.overview();
    }
  }, [navigation, modelsReady, roster]);
  const chooseRoom = (zone: ZoneId) => {
    setFocusDepartment(null);
    // The Files room opens the folder wall with the Files Agent.
    if (zone === 'files') useOfficeStore.getState().focusOn({ agentId: 'files-agent' });
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

  const coworkerPopover = coworkerCard && !focusMode && (
    <div
      ref={pin}
      data-agent-id={selectedAgentId}
      className="coworker-popover"
      role="dialog"
      aria-label={`${selected.name} coworker card`}
    >
      <button
        className="coworker-close"
        aria-label="Close coworker card"
        onClick={() => useOfficeStore.getState().closeCoworkerCard()}
      >
        ×
      </button>
      <ColleagueSummary agent={selected} run={selectedRun} />
      <div className="coworker-task-detail">
        <p className="coworker-specialty">{selected.description}</p>
        {selectedRun && (
          <p>
            <strong>
              {selectedRun.status === 'completed'
                ? latestResponse
                  ? 'Latest result'
                  : 'Latest task'
                : 'Current task'}
            </strong>
            <span>
              {(selectedRun.status === 'completed' ? latestResponse : selectedRun.error) ||
                selectedRun.summary ||
                agentRuntime[selected.id]?.currentTask ||
                'Conversation task'}
            </span>
          </p>
        )}
        {!selectedRun && latestResponse && (
          <p>
            <strong>Latest result</strong>
            <span>{latestResponse}</span>
          </p>
        )}
      </div>
      <div className="coworker-actions">
        <button
          onClick={() => {
            // A step goes to its work; a question is answered in the conversation.
            if (pendingRequest && thread && !pendingRequest.question) {
              const office = useOfficeStore.getState();
              office.closeCoworkerCard();
              office.focusWork(thread.id, pendingRequest.toolCallId);
            } else message();
          }}
        >
          {selectedStatus ? runLifecycle(selectedStatus).action : 'Message'}
        </button>
        <button onClick={() => message(true)}>Ask a question</button>
        <button onClick={() => useOfficeStore.getState().openConversation()}>More</button>
      </div>
    </div>
  );
  return (
    <section
      className={`office-viewport${focusMode ? ' focus-mode' : ''}${conversationOpen ? ' drawer-open' : ''}`}
      aria-label="Interactive AI office"
    >
      <div className="office-topbar" data-office-obstacle>
        <div className="office-directory">
          <span className="office-directory-mark" aria-hidden="true">
            Axon<span>.</span>
          </span>
          <DepartmentMenu current={focusDepartment} onChoose={chooseFromMenu} />
          <OfficeDirectory onChoose={chooseAgent} />
          <nav className="top-districts" aria-label="Office districts">
            <button
              onClick={() => {
                setFocusDepartment(null);
                scene.current?.overview();
              }}
            >
              All
            </button>
            <DistrictChips active={roster ? null : viewDistrict} onChoose={chooseDistrict} />
          </nav>
        </div>
        <div className="office-view-controls">
          <WaitingPill />
          {work && (
            <button
              onClick={work.toggle}
              className={work.open ? 'active' : ''}
              title={`${work.open ? 'Hide' : 'Show'} their work (${SHORTCUT_KEY}+J)`}
              aria-label="Work surface"
              aria-pressed={work.open}
            >
              <IconCode size={16} />
            </button>
          )}
          <button
            onClick={() => useOfficeStore.getState().setFocusMode(!focusMode)}
            aria-pressed={focusMode}
            aria-label="Focus mode"
          >
            <IconScan size={16} />
          </button>
          <NotificationBell />
          <AccountButton />
          <details className="office-apps">
            <summary aria-label="Apps menu">
              <IconLayoutGrid size={16} />
            </summary>
            <div className="office-apps-menu">
              <button aria-label="Open library" onClick={() => openOverlay('knowledge')}>
                <IconBook size={16} /> Library
              </button>
              <button
                aria-label={roster ? 'Office view' : 'Team view'}
                onClick={() => {
                  if (failed) setFailed(false);
                  else toggle3d();
                }}
              >
                {roster ? 'Office view' : 'Team view'}
              </button>
            </div>
          </details>
          <button onClick={() => openOverlay('settings')} title="Settings" aria-label="Office settings">
            <IconSettings size={16} />
          </button>
        </div>
      </div>

      <div className="office-navigation" data-office-obstacle aria-label="Team status">
        <div
          className="office-presence"
          title={`${OFFICE_AGENTS.length} coworkers · ${DISTRICTS.reduce((n, d) => n + d.departments.length, 0)} departments`}
        >
          <span className="office-presence-dot" />
          <GlobalWork />
        </div>
      </div>

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
                      {statuses[agent.id] === 'idle'
                        ? 'Available'
                        : statuses[agent.id] === 'waiting'
                          ? 'Needs you'
                          : (statuses[agent.id] ?? 'Available')}
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
            found={found}
            selectedId={selectedAgentId}
            statuses={statuses}
            markers={markers}
            loading={loading}
            onAgent={chooseAgent}
            bounds={view?.bounds ?? null}
            target={view?.target ?? { x: 0, z: 0 }}
            onPlace={(kind, target) =>
              kind === 'district' ? chooseDistrict(target as DistrictId) : chooseDepartment(target)
            }
          />
          {!loading && mapOpen && (
            <Minimap
              view={view?.bounds ?? null}
              working={working}
              selectedId={selectedAgentId}
              onLook={look}
            />
          )}
          {coworkerPopover}
          <div ref={hoverTip} className="office-hover-tip" role="tooltip" hidden />
          {/* Close up, the floor's own labels tilt and hide behind furniture: where you are, on screen. */}
          {!loading && view && tier === 'near' && (
            <nav className="office-breadcrumb" aria-label="Where you are" data-office-obstacle>
              <button onClick={() => chooseDistrict(viewDistrict)}>{districtById(viewDistrict).name}</button>
              {here && (
                <>
                  <span aria-hidden="true">›</span>
                  <button onClick={() => chooseDepartment(here.target)}>{here.title}</button>
                </>
              )}
            </nav>
          )}
          <div className="office-map-hint">
            <IconZoomIn size={13} />
            <span>
              {hovered
                ? `Select ${OFFICE_AGENTS.find((a) => a.id === hovered)?.name}`
                : 'Click anyone to start · Scroll to zoom · Drag to explore'}
            </span>
          </div>
        </div>
      )}

      {roster && coworkerPopover}
      <PlannerCard workOpen={work?.open} />
      <button
        className="ask-axon"
        data-office-obstacle
        title="Get help or automate work"
        onClick={() => useOfficeStore.getState().setCommandPaletteOpen(true)}
      >
        <IconSparkle size={14} />
        <strong>Ask Axon</strong>
        <kbd>{SHORTCUT_KEY}+K</kbd>
      </button>
      <div className="map-controls" data-office-obstacle aria-label="Map controls">
        <button onClick={() => setMapOpen(!mapOpen)} aria-pressed={mapOpen} aria-label="Toggle minimap">
          Map
        </button>
        <button
          onClick={() => setCameraLocked(!cameraLocked)}
          disabled={roster}
          aria-pressed={cameraLocked}
          aria-label={cameraLocked ? 'Unlock the camera' : 'Lock the camera'}
          title={
            cameraLocked
              ? 'Camera locked: drags and the wheel leave the view where it is. Click to unlock.'
              : 'Lock the camera, so drags and the wheel don’t move the view'
          }
        >
          {cameraLocked ? <IconLock size={15} /> : <IconUnlock size={15} />}
        </button>
        <button onClick={() => scene.current?.zoomBy(1 / 1.2)} disabled={roster} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => scene.current?.resetCamera()} disabled={roster} aria-label="Reset view">
          <IconRotateCcw size={16} />
        </button>
        <button onClick={() => scene.current?.zoomBy(1.2)} disabled={roster} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => scene.current?.overview()} disabled={roster} aria-label="Whole campus">
          <IconScan size={16} />
        </button>
      </div>
      <div className={`coworker-dock${dockCollapsed ? ' collapsed' : ''}`} data-office-obstacle>
        <button
          className="dock-toggle"
          onClick={() => useOfficeStore.getState().setDockCollapsed(!dockCollapsed)}
          aria-expanded={!dockCollapsed}
          aria-label="Toggle coworker dock"
        >
          {dockCollapsed ? 'Show team' : 'Hide team'}
        </button>
        <TeamStrip
          title={strip.title}
          people={strip.people}
          selectedId={selectedAgentId}
          onChoose={chooseAgent}
        />
      </div>
    </section>
  );
}
