import {
  ACTIVITY_DURATIONS,
  AGENT_PROFILES,
  MEETING_DURATION,
  specialistProfile,
  type AgentProfile,
  type AmbientActivity
} from './agentProfiles';
import { FURNITURE, HOME_DESKS, POINTS_OF_INTEREST, WALLS, poiById } from './layout';
import { NavGrid, obstaclesFrom } from './navigation';
import { Random, hashString } from './random';
import type { DistrictId } from '../campus/districts';
import { nearestCoffee, stationSpots } from '../campus/coffee';
import {
  distance,
  yawTowards,
  type AgentBehaviorState,
  type AgentView,
  type HeldItem,
  type PointOfInterest,
  type ScreenState,
  type TaskStatus,
  type Vec2
} from './types';

export const WALK_SPEED = 1.15;
const TASK_WALK_FACTOR = 1.35;
const SIT_DOWN_SECONDS = 0.75;
const STAND_UP_SECONDS = 0.65;
/** Longest slice of time simulated in one step; a stalled frame never teleports anyone. */
const MAX_STEP = 0.1;

type DoKind =
  | 'desk'
  | 'coffee'
  | 'meeting'
  | 'whiteboard'
  | 'reading'
  | 'waiting'
  | 'sitting'
  | 'idle'
  | 'visit'
  | 'celebrating'
  | 'thinking';

type Step =
  | { type: 'goto'; poiId: string; fast?: boolean }
  | { type: 'leave' }
  | { type: 'do'; kind: DoKind; seconds: number | null }
  | { type: 'hold'; item: HeldItem | null };

type PlanKind = AmbientActivity | 'task' | 'wrap-up' | 'meeting' | 'return' | 'initial' | 'help';

interface Plan {
  kind: PlanKind;
  steps: Step[];
}

type Motion =
  | { kind: 'still' }
  | { kind: 'walk'; path: Vec2[]; fast: boolean }
  | {
      kind: 'transition';
      from: Vec2;
      to: Vec2;
      fromSit: number;
      toSit: number;
      elapsed: number;
      seconds: number;
    };

interface Meeting {
  id: number;
  seats: Map<string, string>;
  formedAt: number;
  endsAt: number | null;
  speakerId: string | null;
  speakerUntil: number;
}

interface AgentState {
  id: string;
  profile: AgentProfile;
  home: string;
  rng: Random;
  position: Vec2;
  heading: number;
  sit: number;
  poiId: string | null;
  reservations: Set<string>;
  plan: Plan;
  stepIndex: number;
  stepStarted: boolean;
  stepEndsAt: number | null;
  motion: Motion;
  heldItem: HeldItem | null;
  deskMode: 'typing' | 'reading' | 'thinking';
  deskModeUntil: number;
  onTask: boolean;
  taskStatus: TaskStatus;
  statusSeen: boolean;
  speed: number;
  blockedFor: number;
  meetingId: number | null;
  visitHostId: string | null;
  /** When a visitor found the host away; they wait a moment before heading back. */
  hostMissedAt: number | null;
  visitorSpeaks: boolean;
  turnUntil: number;
  behavior: AgentBehaviorState;
  /** Their neighbourhood; undefined for the core team in the Commons. */
  district?: DistrictId;
  department?: string;
  nearCommons: boolean;
  /** Where they get coffee: 'cafe', or the id of their district's nearest coffee station. */
  coffee: string;
}

export interface SimulationOptions {
  agentIds: readonly string[];
  seed?: number;
  homeDesks?: Readonly<Record<string, string>>;
  /** Honour the OS "reduce motion" setting: everyone stays at their desk, work starts in place. */
  reducedMotion?: boolean;
  /** Most people away from their desks at once (real tasks never wait for this). */
  maxAway?: number;
}

const CAFE_PICKUP = ['cafe-machine', 'cafe-counter-1', 'cafe-counter-2'];
/** Plans that take someone away from their desk; counted against the away budget. */
const OUTINGS = new Set<PlanKind>([
  'coffee',
  'lounge',
  'whiteboard',
  'bookshelf',
  'printer',
  'cabinet',
  'idle',
  'visit',
  'meeting'
]);
/** Seconds a visitor waits at an empty desk before heading back. */
const HOST_AWAY_WAIT = 3;
/** Specialists this close to the café may use the Commons; nobody hikes the whole campus for coffee. */
const COMMONS_REACH = 35;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Ambient office life plus the visible side of real Axon tasks. Pure logic, no rendering:
 * the scene reads `view()` every frame. Real task status always outranks ambient behaviour.
 */
export class OfficeSimulation {
  readonly grid: NavGrid;
  time = 0;
  private readonly agents = new Map<string, AgentState>();
  private readonly occupancy = new Map<string, Set<string>>();
  private readonly rng: Random;
  private readonly reducedMotion: boolean;
  private readonly maxAway: number;
  /** Rebuilt after every step: who sits where, who stands where, who is visiting whom. */
  private seatedAt = new Map<string, AgentState>();
  private standingAt = new Map<string, string[]>();
  private visitors = new Map<string, AgentState>();
  private meeting: Meeting | null = null;
  private meetingCount = 0;
  private nextMeetingCheck: number;

  constructor(options: SimulationOptions) {
    this.grid = new NavGrid(obstaclesFrom(WALLS, FURNITURE));
    const seed = options.seed ?? 1;
    this.rng = new Random(hashString(`meetings:${seed}`));
    this.reducedMotion = options.reducedMotion ?? false;
    this.maxAway = options.maxAway ?? 12;
    const cafe = poiById('cafe-machine').position;
    this.nextMeetingCheck = this.rng.range(60, 100);
    for (const id of options.agentIds) {
      const profile = AGENT_PROFILES[id] ?? specialistProfile(id);
      const home = options.homeDesks?.[id] ?? HOME_DESKS[id];
      if (!home) continue;
      const homeSpot = poiById(home);
      const agent: AgentState = {
        id,
        profile,
        home,
        rng: new Random(hashString(`${seed}:${id}`)),
        position: { ...poiById(home).position },
        heading: poiById(home).facing,
        sit: 0,
        poiId: null,
        reservations: new Set(),
        plan: { kind: 'initial', steps: [] },
        stepIndex: 0,
        stepStarted: false,
        stepEndsAt: null,
        motion: { kind: 'still' },
        heldItem: null,
        deskMode: 'typing',
        deskModeUntil: 0,
        onTask: false,
        taskStatus: 'idle',
        statusSeen: false,
        speed: 0,
        blockedFor: 0,
        meetingId: null,
        visitHostId: null,
        hostMissedAt: null,
        visitorSpeaks: true,
        turnUntil: 0,
        behavior: 'idle',
        district: homeSpot.district,
        department: homeSpot.department,
        nearCommons: !homeSpot.district || distance(homeSpot.position, cafe) <= COMMONS_REACH,
        coffee: nearestCoffee(homeSpot.position, cafe, homeSpot.district)
      };
      this.agents.set(id, agent);
      this.placeInitial(agent);
    }
  }

  // ---------------------------------------------------------------- public API

  get agentIds(): string[] {
    return [...this.agents.keys()];
  }

  step(dt: number): void {
    const slice = Math.min(Math.max(dt, 0), MAX_STEP);
    if (!slice) return;
    this.time += slice;
    this.updateMeeting();
    for (const agent of this.agents.values()) this.advance(agent, slice);
    this.reindex();
  }

  /** People currently away from their own desk for something other than real work. */
  awayCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) if (this.isAway(agent)) count++;
    return count;
  }

  private isAway(agent: AgentState): boolean {
    return !agent.onTask && (OUTINGS.has(agent.plan.kind) || agent.poiId !== agent.home);
  }

  private reindex(): void {
    this.seatedAt = new Map();
    this.standingAt = new Map();
    this.visitors = new Map();
    for (const agent of this.agents.values()) {
      if (!agent.poiId) continue;
      if (agent.sit >= 0.6) this.seatedAt.set(agent.poiId, agent);
      const list = this.standingAt.get(agent.poiId);
      if (list) list.push(agent.id);
      else this.standingAt.set(agent.poiId, [agent.id]);
      const step = agent.plan.steps[agent.stepIndex];
      if (agent.visitHostId && step?.type === 'do' && step.kind === 'visit') {
        const host = this.agents.get(agent.visitHostId);
        if (host && agent.poiId === `visit-${host.home}`) this.visitors.set(host.id, agent);
      }
    }
  }

  /**
   * Feed the office store's real task status. The first report for an agent is treated as the
   * state the office opened in: a running task starts at the desk, a finished one is not replayed.
   */
  setTaskStatus(agentId: string, status: TaskStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const initial = !agent.statusSeen;
    agent.statusSeen = true;
    if (!initial && status === agent.taskStatus) return;
    agent.taskStatus = status;

    if (status === 'working' || status === 'waiting') {
      if (agent.onTask) return;
      agent.onTask = true;
      this.cancelPlan(agent);
      if (initial || this.reducedMotion) this.placeAtHome(agent);
      this.setPlan(agent, this.taskPlan(agent));
      return;
    }

    if (!agent.onTask) return;
    agent.onTask = false;
    const steps: Step[] = [];
    if (agent.poiId !== agent.home) steps.push({ type: 'leave' }, { type: 'goto', poiId: agent.home });
    if (status === 'completed') steps.push({ type: 'do', kind: 'celebrating', seconds: 2.4 });
    if (status === 'error') steps.push({ type: 'do', kind: 'thinking', seconds: 3 });
    steps.push({ type: 'do', kind: 'desk', seconds: agent.rng.range(5, 10) });
    this.cancelPlan(agent);
    this.setPlan(agent, { kind: 'wrap-up', steps });
  }

  /**
   * A colleague walks over to someone's desk to help with their task, and stays until `endHelp`.
   * Real work, so it is not held back by the away budget; refused with reduced motion, while the
   * helper has a task of their own, or when someone already stands at that desk.
   */
  startHelp(helperId: string, hostId: string): boolean {
    const helper = this.agents.get(helperId);
    const host = this.agents.get(hostId);
    if (!helper || !host || helper === host || this.reducedMotion || helper.onTask) return false;
    if (helper.plan.kind === 'help' && helper.visitHostId === host.id) return true;
    const spot = `visit-${host.home}`;
    if (!this.hasRoom(spot, helper)) return false;
    this.cancelPlan(helper);
    this.reserve(helper, spot);
    helper.visitHostId = host.id;
    helper.visitorSpeaks = true;
    helper.turnUntil = 0;
    const carry: Step[] = helper.profile.prop ? [{ type: 'hold', item: helper.profile.prop }] : [];
    this.setPlan(helper, {
      kind: 'help',
      steps: [{ type: 'leave' }, ...carry, { type: 'goto', poiId: spot }, this.doing('visit', null)]
    });
    return true;
  }

  /** The help is over: back to their own desk. */
  endHelp(helperId: string): void {
    const helper = this.agents.get(helperId);
    if (!helper || helper.plan.kind !== 'help') return;
    this.cancelPlan(helper);
    this.setPlan(helper, this.deskPlan(helper, helper.rng.range(20, 60)));
  }

  /** Start a specific ambient activity now. Ignored while a real task is running. */
  requestActivity(agentId: string, activity: AmbientActivity): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.onTask) return false;
    this.cancelPlan(agent);
    const plan = this.ambientPlan(agent, activity);
    this.setPlan(agent, plan ?? this.choosePlan(agent));
    return plan !== null;
  }

  view(agentId: string): AgentView | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      position: { ...agent.position },
      heading: agent.heading,
      behavior: agent.behavior,
      sit: agent.sit,
      speed: agent.motion.kind === 'walk' ? agent.speed : 0,
      heldItem: agent.heldItem,
      attention: this.attentionOf(agent),
      poiId: agent.poiId,
      onTask: agent.onTask
    };
  }

  views(): AgentView[] {
    return this.agentIds.map((id) => this.view(id)!);
  }

  screenState(deskPoiId: string): ScreenState {
    const agent = this.seatedAt.get(deskPoiId);
    if (!agent) return 'off';
    return agent.onTask ? 'active' : 'on';
  }

  occupantsOf(poiId: string): string[] {
    return this.standingAt.get(poiId) ?? [];
  }

  // ---------------------------------------------------------------- placement

  private placeInitial(agent: AgentState): void {
    const scene = this.reducedMotion ? ({ kind: 'desk' } as const) : agent.profile.initial;
    const { rng } = agent;
    if (scene.kind !== 'desk' && scene.kind !== 'walking-home' && !this.hasRoom(scene.poiId, agent)) {
      this.placeAtHome(agent);
      this.setPlan(agent, this.deskPlan(agent, rng.range(20, 90)));
      return;
    }
    switch (scene.kind) {
      case 'desk':
        this.placeAtHome(agent);
        this.setPlan(agent, this.deskPlan(agent, rng.range(20, 90)));
        return;
      case 'coffee':
        this.placeAt(agent, scene.poiId);
        agent.heldItem = 'cup';
        this.setPlan(agent, {
          kind: 'coffee',
          steps: [this.doing('coffee', rng.range(8, 18)), { type: 'leave' }]
        });
        return;
      case 'whiteboard':
        this.placeAt(agent, scene.poiId);
        this.setPlan(agent, {
          kind: 'whiteboard',
          steps: [this.doing('whiteboard', rng.range(10, 25)), { type: 'leave' }]
        });
        return;
      case 'bookshelf':
        this.placeAt(agent, scene.poiId);
        agent.heldItem = 'book';
        this.setPlan(agent, {
          kind: 'bookshelf',
          steps: [this.doing('reading', rng.range(6, 14)), { type: 'leave' }]
        });
        return;
      case 'lounge':
        this.placeAt(agent, scene.poiId);
        this.setPlan(agent, {
          kind: 'lounge',
          steps: [this.doing('sitting', rng.range(12, 30)), { type: 'leave' }]
        });
        return;
      case 'walking-home': {
        const start = poiById(scene.fromPoiId).approach;
        agent.position = { ...start };
        agent.heading = yawTowards(start, poiById(agent.home).approach);
        this.setPlan(agent, {
          kind: 'return',
          steps: [{ type: 'goto', poiId: agent.home }, this.doing('desk', rng.range(45, 110))]
        });
      }
    }
  }

  private placeAt(agent: AgentState, poiId: string): void {
    const poi = poiById(poiId);
    this.reserve(agent, poiId);
    agent.position = { ...poi.position };
    agent.heading = poi.facing;
    agent.sit = poi.seated ? 1 : 0;
    agent.poiId = poiId;
    agent.motion = { kind: 'still' };
  }

  private placeAtHome(agent: AgentState): void {
    if (agent.poiId) this.release(agent, agent.poiId);
    agent.poiId = null;
    agent.heldItem = null;
    this.placeAt(agent, agent.home);
  }

  // ---------------------------------------------------------------- reservations

  private hasRoom(poiId: string, agent?: AgentState): boolean {
    const holders = this.occupancy.get(poiId);
    if (!holders) return true;
    if (agent && holders.has(agent.id)) return true;
    return holders.size < poiById(poiId).capacity;
  }

  private reserve(agent: AgentState, poiId: string): void {
    let holders = this.occupancy.get(poiId);
    if (!holders) this.occupancy.set(poiId, (holders = new Set()));
    holders.add(agent.id);
    agent.reservations.add(poiId);
  }

  private release(agent: AgentState, poiId: string): void {
    this.occupancy.get(poiId)?.delete(agent.id);
    agent.reservations.delete(poiId);
  }

  private freeSpots(ids: readonly string[], agent: AgentState): string[] {
    return ids.filter((id) => this.hasRoom(id, agent));
  }

  private poisOfType(predicate: (poi: PointOfInterest) => boolean): string[] {
    return POINTS_OF_INTEREST.filter(predicate).map((poi) => poi.id);
  }

  // ---------------------------------------------------------------- plans

  private doing(kind: DoKind, seconds: number | null): Step {
    return { type: 'do', kind, seconds };
  }

  private deskPlan(agent: AgentState, seconds: number): Plan {
    if (agent.poiId === agent.home) return { kind: 'desk', steps: [this.doing('desk', seconds)] };
    return {
      kind: 'return',
      steps: [{ type: 'leave' }, { type: 'goto', poiId: agent.home }, this.doing('desk', seconds)]
    };
  }

  private taskPlan(agent: AgentState): Plan {
    if (agent.poiId === agent.home) return { kind: 'task', steps: [this.doing('desk', null)] };
    return {
      kind: 'task',
      steps: [{ type: 'leave' }, { type: 'goto', poiId: agent.home, fast: true }, this.doing('desk', null)]
    };
  }

  private choosePlan(agent: AgentState): Plan {
    if (agent.onTask) return this.taskPlan(agent);
    const [min, max] = ACTIVITY_DURATIONS.desk;
    // Back from an outing: settle in for a proper stint before the next one.
    if (this.reducedMotion || agent.poiId !== agent.home)
      return this.deskPlan(agent, agent.rng.range(45, 110));
    // The office is busy enough: keep working and look again later.
    if (this.awayCount() >= this.maxAway) return this.deskPlan(agent, agent.rng.range(min, max));
    const activity = agent.rng.weighted(agent.profile.weights);
    return this.ambientPlan(agent, activity) ?? this.deskPlan(agent, agent.rng.range(min, max));
  }

  /** Builds and reserves an ambient outing, or returns null when every suitable spot is taken. */
  private ambientPlan(agent: AgentState, activity: AmbientActivity): Plan | null {
    const { rng } = agent;
    const [min, max] = ACTIVITY_DURATIONS[activity];
    const duration = rng.range(min, max);
    const leave: Step = { type: 'leave' };
    const claim = (candidates: string[]): string | null => {
      const free = this.freeSpots(candidates, agent);
      if (!free.length) return null;
      const chosen = rng.pick(free);
      this.reserve(agent, chosen);
      return chosen;
    };

    const commonsOnly: AmbientActivity[] = ['lounge', 'bookshelf', 'printer', 'cabinet'];
    if (commonsOnly.includes(activity) && !agent.nearCommons) return null;
    switch (activity) {
      case 'desk':
        return this.deskPlan(agent, duration);
      case 'coffee': {
        // The café, or their district's coffee station: pick up a cup, then sit or stand with it.
        const station = agent.coffee === 'cafe' ? null : stationSpots(agent.coffee);
        const pickup = this.freeSpots(station ? station.slice(0, 2) : CAFE_PICKUP, agent)[0];
        if (!pickup) return null;
        this.reserve(agent, pickup);
        const steps: Step[] = [
          leave,
          { type: 'goto', poiId: pickup },
          this.doing('waiting', rng.range(4, 7)),
          { type: 'hold', item: 'cup' }
        ];
        const seat = !rng.chance(0.5)
          ? null
          : station
            ? claim(station.slice(2))
            : claim(this.poisOfType((poi) => poi.type === 'cafe-seat'));
        if (seat)
          steps.push(
            leave,
            { type: 'goto', poiId: seat },
            this.doing('coffee', Math.max(8, duration - 8)),
            leave
          );
        else steps.push(this.doing('coffee', rng.range(6, 14)), leave);
        return { kind: 'coffee', steps };
      }
      case 'lounge': {
        const seats = this.poisOfType(
          (poi) => poi.type === 'lounge' && (poi.zoneId === 'chat' || agent.id === 'knowledge-librarian')
        );
        const seat = claim(seats);
        if (!seat) return null;
        const carry: Step[] =
          agent.profile.prop === 'tablet' || agent.profile.prop === 'book'
            ? [{ type: 'hold', item: agent.profile.prop }]
            : [];
        return {
          kind: 'lounge',
          steps: [
            leave,
            ...carry,
            { type: 'goto', poiId: seat },
            this.doing(carry.length ? 'reading' : 'sitting', duration),
            leave
          ]
        };
      }
      case 'whiteboard': {
        const spot = claim(
          this.poisOfType((poi) => poi.type === 'whiteboard' && poi.district === agent.district)
        );
        if (!spot) return null;
        return {
          kind: 'whiteboard',
          steps: [leave, { type: 'goto', poiId: spot }, this.doing('whiteboard', duration), leave]
        };
      }
      case 'bookshelf': {
        const spot = claim(this.poisOfType((poi) => poi.type === 'bookshelf'));
        if (!spot) return null;
        return {
          kind: 'bookshelf',
          steps: [
            leave,
            { type: 'goto', poiId: spot },
            { type: 'hold', item: 'book' },
            this.doing('reading', duration),
            leave
          ]
        };
      }
      case 'printer': {
        const spot = claim(['printer']);
        if (!spot) return null;
        return {
          kind: 'printer',
          steps: [
            leave,
            { type: 'goto', poiId: spot },
            this.doing('waiting', duration * 0.6),
            { type: 'hold', item: 'folder' },
            this.doing('reading', duration * 0.4),
            leave
          ]
        };
      }
      case 'cabinet': {
        const spot = claim(['file-cabinet']);
        if (!spot) return null;
        return {
          kind: 'cabinet',
          steps: [
            leave,
            { type: 'goto', poiId: spot },
            { type: 'hold', item: 'folder' },
            this.doing('reading', duration),
            leave
          ]
        };
      }
      case 'idle': {
        const spot = claim(
          this.poisOfType((poi) => poi.type === 'open-area' && poi.district === agent.district)
        );
        if (!spot) return null;
        return {
          kind: 'idle',
          steps: [leave, { type: 'goto', poiId: spot }, this.doing('idle', duration), leave]
        };
      }
      case 'visit': {
        const hosts = [...this.agents.values()].filter(
          (host) =>
            host !== agent &&
            host.department === agent.department &&
            this.canBeVisited(host) &&
            this.hasRoom(`visit-${host.home}`, agent)
        );
        if (!hosts.length) return null;
        const host = rng.pick(hosts);
        const spot = `visit-${host.home}`;
        this.reserve(agent, spot);
        agent.visitHostId = host.id;
        agent.visitorSpeaks = true;
        agent.turnUntil = 0;
        const carry: Step[] = agent.profile.prop ? [{ type: 'hold', item: agent.profile.prop }] : [];
        return {
          kind: 'visit',
          steps: [leave, ...carry, { type: 'goto', poiId: spot }, this.doing('visit', duration), leave]
        };
      }
    }
  }

  private setPlan(agent: AgentState, plan: Plan): void {
    const first = plan.steps[0];
    if (first?.type === 'goto' && agent.poiId && agent.poiId !== first.poiId)
      plan.steps.unshift({ type: 'leave' });
    agent.plan = plan;
    agent.stepIndex = 0;
    agent.stepStarted = false;
    agent.stepEndsAt = null;
  }

  /** Drops the current plan. Keeps the spot the agent physically occupies; the next plan leaves it. */
  private cancelPlan(agent: AgentState): void {
    for (const poiId of [...agent.reservations]) if (poiId !== agent.poiId) this.release(agent, poiId);
    if (agent.motion.kind === 'walk') agent.motion = { kind: 'still' };
    // Half-way out of a chair: sit back down; the next plan stands up again if it needs to.
    if (agent.motion.kind === 'transition' && agent.motion.toSit === 0 && agent.poiId) {
      const seat = poiById(agent.poiId).position;
      agent.motion = {
        kind: 'transition',
        from: { ...agent.position },
        to: { ...seat },
        fromSit: agent.sit,
        toSit: 1,
        elapsed: 0,
        seconds: SIT_DOWN_SECONDS * Math.max(0.3, 1 - agent.sit)
      };
    }
    agent.meetingId = null;
    agent.visitHostId = null;
    agent.hostMissedAt = null;
  }

  // ---------------------------------------------------------------- meetings and visits

  /** Quietly working at their own desk: not on a real task, not mid-outing, not already busy. */
  private settledAtDesk(agent: AgentState): boolean {
    const step = agent.plan.steps[agent.stepIndex];
    return (
      !agent.onTask &&
      agent.poiId === agent.home &&
      agent.sit > 0.95 &&
      (agent.plan.kind === 'desk' || agent.plan.kind === 'return') &&
      step?.type === 'do' &&
      step.kind === 'desk' &&
      agent.meetingId === null &&
      agent.visitHostId === null
    );
  }

  private canBeVisited(host: AgentState): boolean {
    if (!this.settledAtDesk(host)) return false;
    for (const other of this.agents.values()) if (other.visitHostId === host.id) return false;
    return true;
  }

  private hostIsAvailable(visitor: AgentState): boolean {
    const host = visitor.visitHostId ? this.agents.get(visitor.visitHostId) : undefined;
    return !!host && !host.onTask && host.poiId === host.home && host.meetingId === null;
  }

  /** Who is standing at this person's desk for a chat (as of the last step). */
  private visitorOf(host: AgentState): AgentState | null {
    const visitor = this.visitors.get(host.id);
    if (!visitor || visitor.visitHostId !== host.id) return null;
    return visitor;
  }

  private availableForMeeting(agent: AgentState): boolean {
    return this.settledAtDesk(agent) && !this.visitorOf(agent);
  }

  private updateMeeting(): void {
    if (!this.reducedMotion && !this.meeting && this.time >= this.nextMeetingCheck) {
      this.nextMeetingCheck = this.time + this.rng.range(150, 260);
      if (this.rng.chance(0.7)) this.startMeeting();
    }
    const meeting = this.meeting;
    if (!meeting) return;
    const participants = [...meeting.seats.keys()]
      .map((id) => this.agents.get(id)!)
      .filter((agent) => agent.meetingId === meeting.id);
    const seated = participants.filter(
      (agent) => agent.poiId === meeting.seats.get(agent.id) && agent.sit > 0.95
    );

    const ended =
      (participants.length < 2 && this.time - meeting.formedAt > 3) ||
      (meeting.endsAt !== null && this.time >= meeting.endsAt);
    if (ended) {
      for (const agent of participants) agent.meetingId = null;
      this.meeting = null;
      return;
    }
    if (
      meeting.endsAt === null &&
      (seated.length === participants.length || this.time - meeting.formedAt > 35)
    )
      meeting.endsAt = this.time + this.rng.range(...MEETING_DURATION);
    if (
      seated.length &&
      (this.time >= meeting.speakerUntil || !seated.some((a) => a.id === meeting.speakerId))
    ) {
      meeting.speakerId = this.rng.pick(seated).id;
      meeting.speakerUntil = this.time + this.rng.range(4, 8);
    }
  }

  /** Pulls two or three people who are quietly working into a meeting. Purely visual. */
  private startMeeting(): void {
    const pool = [...this.agents.values()].filter(
      (agent) => agent.profile.meetingAffinity > 0 && this.availableForMeeting(agent)
    );
    if (pool.length < 2) return;
    const count = Math.min(pool.length, this.rng.chance(0.45) ? 3 : 2);
    if (this.awayCount() + count > this.maxAway) return;
    const chosen: AgentState[] = [];
    while (chosen.length < count) {
      const weights = Object.fromEntries(pool.map((agent) => [agent.id, agent.profile.meetingAffinity]));
      const pickedId = this.rng.weighted(weights);
      const picked = pool.splice(
        pool.findIndex((agent) => agent.id === pickedId),
        1
      )[0];
      chosen.push(picked);
    }
    const coachHome = chosen.find((agent) => agent.home === 'desk-product');
    // The Product Coach hosts from the head of the Planning A table; otherwise any meeting space.
    const venue = coachHome
      ? 'meeting-room'
      : this.rng.weighted({ 'planning-room': 40, 'meeting-room': 30, 'collab-table': 30 });
    const free = this.poisOfType((poi) => poi.group === venue && this.hasRoom(poi.id));
    const needed = chosen.filter((agent) => !(venue === 'meeting-room' && agent === coachHome));
    if (free.length < needed.length) return;

    const meeting: Meeting = {
      id: ++this.meetingCount,
      seats: new Map(),
      formedAt: this.time,
      endsAt: null,
      speakerId: null,
      speakerUntil: 0
    };
    const seats = [...free];
    for (const agent of chosen) {
      this.cancelPlan(agent);
      agent.meetingId = meeting.id;
      if (venue === 'meeting-room' && agent === coachHome) {
        meeting.seats.set(agent.id, agent.home);
        this.setPlan(agent, { kind: 'meeting', steps: [this.doing('meeting', null)] });
        continue;
      }
      const seat = seats.splice(Math.floor(this.rng.next() * seats.length), 1)[0];
      this.reserve(agent, seat);
      meeting.seats.set(agent.id, seat);
      const carry: Step[] = agent.profile.prop ? [{ type: 'hold', item: agent.profile.prop }] : [];
      this.setPlan(agent, {
        kind: 'meeting',
        steps: [
          { type: 'leave' },
          ...carry,
          { type: 'goto', poiId: seat },
          this.doing('meeting', null),
          { type: 'leave' }
        ]
      });
    }
    this.meeting = meeting;
  }

  private attentionOf(agent: AgentState): Vec2 | null {
    const meeting = this.meeting;
    if (meeting && agent.meetingId === meeting.id && agent.sit > 0.9) {
      const speaker = meeting.speakerId ? this.agents.get(meeting.speakerId) : undefined;
      if (speaker && speaker !== agent) return { ...speaker.position };
      const other = [...meeting.seats.keys()].find((id) => id !== agent.id);
      return other ? { ...this.agents.get(other)!.position } : null;
    }
    const step = agent.plan.steps[agent.stepIndex];
    if (step?.type === 'do' && step.kind === 'visit' && agent.visitHostId) {
      const host = this.agents.get(agent.visitHostId);
      return host ? { ...host.position } : null;
    }
    const visitor = this.visitorOf(agent);
    return visitor ? { ...visitor.position } : null;
  }

  // ---------------------------------------------------------------- per-frame update

  private advance(agent: AgentState, dt: number): void {
    this.updateMotion(agent, dt);
    for (let guard = 0; guard < 10; guard++) {
      const step = agent.plan.steps[agent.stepIndex];
      if (!step) {
        this.setPlan(agent, this.choosePlan(agent));
        continue;
      }
      if (!agent.stepStarted) {
        agent.stepStarted = true;
        this.startStep(agent, step);
      }
      if (!this.isStepDone(agent, step)) break;
      agent.stepIndex++;
      agent.stepStarted = false;
    }
    this.updateHeading(agent, dt);
    agent.behavior = this.behaviorOf(agent);
  }

  private startStep(agent: AgentState, step: Step): void {
    switch (step.type) {
      case 'goto': {
        if (agent.poiId === step.poiId) return;
        const poi = poiById(step.poiId);
        this.reserve(agent, poi.id);
        const path = this.grid.findPath(agent.position, poi.approach);
        if (!path) {
          // Unreachable should never happen with a valid layout; arrive rather than freeze.
          agent.position = { ...poi.approach };
          this.arrive(agent, poi);
          return;
        }
        agent.motion = { kind: 'walk', path: path.slice(1), fast: !!step.fast };
        return;
      }
      case 'leave': {
        if (!agent.poiId) return;
        const poi = poiById(agent.poiId);
        if (poi.seated || agent.sit > 0.01) {
          agent.motion = {
            kind: 'transition',
            from: { ...agent.position },
            to: { ...poi.approach },
            fromSit: agent.sit,
            toSit: 0,
            elapsed: 0,
            seconds: STAND_UP_SECONDS * Math.max(0.3, agent.sit)
          };
          return;
        }
        this.release(agent, agent.poiId);
        agent.poiId = null;
        return;
      }
      case 'do':
        agent.stepEndsAt = step.seconds === null ? null : this.time + step.seconds;
        agent.hostMissedAt = null;
        if (step.kind === 'desk') {
          agent.deskMode = 'typing';
          agent.deskModeUntil = this.time + agent.rng.range(4, 12);
        }
        return;
      case 'hold':
        agent.heldItem = step.item;
    }
  }

  private isStepDone(agent: AgentState, step: Step): boolean {
    switch (step.type) {
      case 'goto':
        return agent.motion.kind === 'still' && agent.poiId === step.poiId;
      case 'leave':
        return agent.motion.kind === 'still' && agent.poiId === null;
      case 'hold':
        return true;
      case 'do':
        if (step.kind === 'meeting') return agent.meetingId === null;
        if (step.kind === 'visit' && agent.plan.kind !== 'help' && !this.hostIsAvailable(agent)) {
          // Nobody at the desk: look around for a moment, then head back.
          agent.hostMissedAt ??= this.time;
          return this.time - agent.hostMissedAt >= HOST_AWAY_WAIT;
        }
        if (step.seconds === null) return step.kind === 'desk' && !agent.onTask;
        return this.time >= (agent.stepEndsAt ?? 0);
    }
  }

  private arrive(agent: AgentState, poi: PointOfInterest): void {
    agent.poiId = poi.id;
    if (!poi.seated) {
      agent.motion = { kind: 'still' };
      agent.position = { ...poi.position };
      return;
    }
    agent.motion = {
      kind: 'transition',
      from: { ...agent.position },
      to: { ...poi.position },
      fromSit: agent.sit,
      toSit: 1,
      elapsed: 0,
      seconds: SIT_DOWN_SECONDS
    };
  }

  private updateMotion(agent: AgentState, dt: number): void {
    const motion = agent.motion;
    if (motion.kind === 'transition') {
      motion.elapsed += dt;
      const t = Math.min(1, motion.elapsed / motion.seconds);
      const eased = smoothstep(t);
      agent.position = {
        x: lerp(motion.from.x, motion.to.x, eased),
        z: lerp(motion.from.z, motion.to.z, eased)
      };
      agent.sit = lerp(motion.fromSit, motion.toSit, eased);
      if (t < 1) return;
      agent.motion = { kind: 'still' };
      if (motion.toSit === 0 && agent.poiId) {
        this.release(agent, agent.poiId);
        agent.poiId = null;
      }
      if (motion.toSit === 1 && agent.poiId === agent.home) agent.heldItem = null;
      return;
    }
    if (motion.kind !== 'walk') {
      agent.speed = 0;
      return;
    }

    const target = motion.path[0];
    if (!target) {
      const step = agent.plan.steps[agent.stepIndex];
      if (step?.type === 'goto') this.arrive(agent, poiById(step.poiId));
      else agent.motion = { kind: 'still' };
      agent.speed = 0;
      return;
    }
    const pace = WALK_SPEED * agent.profile.pace * (motion.fast ? TASK_WALK_FACTOR : 1);
    agent.speed = pace * this.makeWay(agent, target, dt);
    let budget = agent.speed * dt;
    while (budget > 0 && motion.path.length) {
      const next = motion.path[0];
      const gap = distance(agent.position, next);
      if (gap <= budget) {
        agent.position = { ...next };
        motion.path.shift();
        budget -= gap;
      } else {
        agent.position = {
          x: agent.position.x + ((next.x - agent.position.x) / gap) * budget,
          z: agent.position.z + ((next.z - agent.position.z) / gap) * budget
        };
        budget = 0;
      }
    }
  }

  /**
   * Someone standing or walking in the way: slow down and step aside, away from them, where the
   * floor allows. Only if there is no room to step aside, wait briefly and then carry on.
   * Returns the share of walking speed to keep.
   */
  private makeWay(agent: AgentState, target: Vec2, dt: number): number {
    const gap = distance(agent.position, target);
    if (gap < 1e-6) return 1;
    const dirX = (target.x - agent.position.x) / gap;
    const dirZ = (target.z - agent.position.z) / gap;
    const rightX = -dirZ;
    const rightZ = dirX;
    let factor = 1;
    let side = 0;
    let closest = Infinity;
    for (const other of this.agents.values()) {
      if (other === agent || other.sit > 0.5) continue;
      const dx = other.position.x - agent.position.x;
      const dz = other.position.z - agent.position.z;
      const ahead = dx * dirX + dz * dirZ;
      const lateral = dx * rightX + dz * rightZ;
      if (ahead <= 0 || ahead > 1.2 || Math.abs(lateral) > 0.55) continue;
      factor = Math.min(factor, Math.min(1, Math.max(0, (ahead - 0.45) / 0.5)));
      if (ahead < closest) {
        closest = ahead;
        side = lateral > 0 ? -1 : 1;
      }
    }
    // Near a waypoint (doorways, corners) stepping aside would circle it forever; just yield there.
    if (side && gap > 0.6) {
      const step = 0.7 * dt * side;
      const aside = { x: agent.position.x + rightX * step, z: agent.position.z + rightZ * step };
      if (this.grid.isFree(aside) && this.grid.isClearLine(aside, target)) {
        agent.position = aside;
        factor = Math.max(factor, 0.4);
      }
    }
    agent.blockedFor = factor < 0.1 ? agent.blockedFor + dt : 0;
    return agent.blockedFor > 1.5 ? 1 : factor;
  }

  private updateHeading(agent: AgentState, dt: number): void {
    let target: number | null = null;
    let rate = 7;
    if (agent.motion.kind === 'walk' && agent.motion.path.length) {
      const next = agent.motion.path[0];
      if (distance(agent.position, next) > 0.05) target = yawTowards(agent.position, next);
      rate = 9;
    } else if (agent.poiId) {
      target = poiById(agent.poiId).facing;
      rate = agent.motion.kind === 'transition' ? 10 : 6;
    }
    if (target === null) return;
    agent.heading = wrapAngle(agent.heading + wrapAngle(target - agent.heading) * (1 - Math.exp(-rate * dt)));
  }

  private behaviorOf(agent: AgentState): AgentBehaviorState {
    if (agent.motion.kind === 'walk') return 'walking';
    if (agent.motion.kind === 'transition') return 'idle';
    const step = agent.plan.steps[agent.stepIndex];
    if (step?.type !== 'do') return 'idle';
    switch (step.kind) {
      case 'desk': {
        const visitor = this.visitorOf(agent);
        if (visitor) return visitor.visitorSpeaks ? 'meeting' : 'talking';
        if (this.time >= agent.deskModeUntil) this.nextDeskMode(agent);
        return agent.deskMode;
      }
      case 'meeting':
        return this.meeting?.speakerId === agent.id ? 'talking' : 'meeting';
      case 'visit':
        // A social visit to an empty desk is a wait; helping someone at work is a conversation.
        if (agent.plan.kind !== 'help' && !this.hostIsAvailable(agent)) return 'waiting';
        if (this.time >= agent.turnUntil) {
          agent.visitorSpeaks = !agent.visitorSpeaks;
          agent.turnUntil = this.time + agent.rng.range(3, 6);
        }
        return agent.visitorSpeaks ? 'talking' : 'idle';
      case 'sitting':
        return 'sitting';
      default:
        return step.kind;
    }
  }

  /** At a desk people type, pause to read, sometimes sit back and think. Real work types more. */
  private nextDeskMode(agent: AgentState): void {
    const { rng, onTask } = agent;
    if (agent.deskMode === 'typing') {
      agent.deskMode = rng.chance(onTask ? 0.25 : 0.35) ? 'thinking' : 'reading';
      agent.deskModeUntil =
        this.time +
        (agent.deskMode === 'thinking' ? rng.range(2, 4) : onTask ? rng.range(3, 6) : rng.range(4, 9));
      return;
    }
    agent.deskMode = 'typing';
    agent.deskModeUntil = this.time + (onTask ? rng.range(10, 22) : rng.range(7, 16));
  }
}
