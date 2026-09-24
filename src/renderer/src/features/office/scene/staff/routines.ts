import { COFFEE_BAR, KITCHEN } from '../../campus/commons';
import type { Vec2 } from '../../simulation/types';

/**
 * The café's ambient staff: two chefs and a barista on looping, scripted routines. They are not
 * coworkers: not in the simulation, the roster, search or any count, and they only ever stand where
 * coworkers cannot walk (inside the kitchen, or in the barista's strip behind the bar). Pure logic;
 * StaffLayer draws them.
 */

export type StaffId = 'chef-grill' | 'chef-prep' | 'barista';
export type StaffAction = 'stir' | 'flip' | 'season' | 'chop' | 'plate' | 'wipe' | 'brew';
export type StaffTool = 'spatula' | 'pan' | 'knife' | 'plate' | 'cloth' | 'cup';

export interface StaffState {
  id: StaffId;
  x: number;
  z: number;
  /** Yaw; 0 faces +z (the café). */
  heading: number;
  action: StaffAction;
  walking: boolean;
  /** Metres per second while walking. */
  speed: number;
  /** The range's flames are lit. */
  cooking: boolean;
  holding: StaffTool | null;
}

export const STAFF_IDS: readonly StaffId[] = ['chef-grill', 'chef-prep', 'barista'];

/** Where the chefs work, in kitchen-local metres (x east, z toward the café). */
export const KITCHEN_SPOTS = {
  range: { x: -0.2, z: -1.2 },
  backCounter: { x: 0.95, z: -1.2 },
  prep: { x: -0.6, z: 1.2 },
  pass: { x: 0.6, z: 1.2 }
} as const;

const inKitchen = (spot: Vec2): Vec2 => ({ x: KITCHEN.x + spot.x, z: KITCHEN.z + spot.z });

/** The barista's line behind the counter, and where the two machines stand on it. */
const BARISTA_Z = COFFEE_BAR.z - COFFEE_BAR.d / 2 + 0.3;
export const MACHINES = { east: COFFEE_BAR.x + 1.2, west: COFFEE_BAR.x - 1.1 } as const;
/** Which machine serves each pickup: the one nearest it. */
const MACHINE_FOR: Readonly<Record<string, number>> = {
  'cafe-machine': MACHINES.east,
  'cafe-counter-1': MACHINES.east,
  'cafe-counter-2': MACHINES.west
};
const WIPE_SPOTS = [COFFEE_BAR.x - 0.5, COFFEE_BAR.x + 0.6];
const WALK = 1.2;
const BARISTA_WALK = 1.4;
const BREW_SECONDS = 5;
const WIPE_SECONDS = 5;
const FACE_CAFE = 0;
const FACE_RANGE = Math.PI;

interface Stop {
  at: Vec2;
  heading: number;
  action: StaffAction;
  seconds: number;
  holding: StaffTool | null;
  /** What they carry on the walk to this stop. */
  carrying?: StaffTool | null;
}

const GRILL: Stop[] = [
  { at: inKitchen(KITCHEN_SPOTS.range), heading: FACE_RANGE, action: 'stir', seconds: 6, holding: 'spatula' },
  { at: inKitchen(KITCHEN_SPOTS.range), heading: FACE_RANGE, action: 'flip', seconds: 2.4, holding: 'pan' },
  { at: inKitchen(KITCHEN_SPOTS.range), heading: FACE_RANGE, action: 'stir', seconds: 5, holding: 'spatula' },
  {
    at: inKitchen(KITCHEN_SPOTS.backCounter),
    heading: FACE_RANGE,
    action: 'season',
    seconds: 3,
    holding: null
  }
];

const PREP: Stop[] = [
  { at: inKitchen(KITCHEN_SPOTS.prep), heading: FACE_CAFE, action: 'chop', seconds: 8, holding: 'knife' },
  {
    at: inKitchen(KITCHEN_SPOTS.pass),
    heading: FACE_CAFE,
    action: 'plate',
    seconds: 5,
    holding: 'plate',
    carrying: 'plate'
  }
];

interface Walker {
  id: StaffId;
  state: StaffState;
}

/** Follows a loop of stops: walk to each, then work there for its time. */
class Loop {
  private index = 0;
  private left: number;
  constructor(
    private readonly walker: Walker,
    private readonly stops: readonly Stop[],
    private readonly still: boolean
  ) {
    this.left = stops[0].seconds;
    this.settle(stops[0]);
  }

  private settle(stop: Stop): void {
    const s = this.walker.state;
    s.x = stop.at.x;
    s.z = stop.at.z;
    s.heading = stop.heading;
    s.action = stop.action;
    s.holding = stop.holding;
    s.walking = false;
    s.speed = 0;
  }

  update(dt: number): void {
    if (this.still) return;
    const s = this.walker.state;
    const stop = this.stops[this.index];
    const gap = Math.hypot(stop.at.x - s.x, stop.at.z - s.z);
    if (gap > 1e-3) {
      const step = Math.min(gap, WALK * dt);
      s.heading = Math.atan2(stop.at.x - s.x, stop.at.z - s.z);
      s.x += ((stop.at.x - s.x) / gap) * step;
      s.z += ((stop.at.z - s.z) / gap) * step;
      s.walking = true;
      s.speed = WALK;
      s.holding = stop.carrying ?? null;
      if (step >= gap - 1e-9) this.settle(stop);
      return;
    }
    this.settle(stop);
    this.left -= dt;
    if (this.left > 0) return;
    this.index = (this.index + 1) % this.stops.length;
    this.left = this.stops[this.index].seconds;
  }
}

/**
 * The barista: wipes the bar, moving between two places along it, until a coworker waits at a
 * pickup; then walks to the machine nearest that pickup and pulls a shot. Each coffee break is
 * served once, however long its owner lingers at the counter.
 */
class Barista {
  private mode: 'wipe' | 'serve' = 'wipe';
  private wipeAt = 0;
  private left = WIPE_SECONDS;
  private machine = MACHINES.east;
  private readonly served = new Set<string>();
  constructor(
    private readonly walker: Walker,
    private readonly still: boolean
  ) {
    Object.assign(walker.state, {
      x: WIPE_SPOTS[0],
      z: BARISTA_Z,
      heading: FACE_CAFE,
      action: 'wipe',
      holding: 'cloth'
    });
  }

  update(dt: number, waiting: readonly string[]): void {
    if (this.still) return;
    for (const spot of [...this.served]) if (!waiting.includes(spot)) this.served.delete(spot);
    const s = this.walker.state;
    if (this.mode === 'wipe') {
      const next = waiting.find((spot) => MACHINE_FOR[spot] !== undefined && !this.served.has(spot));
      if (next) {
        this.served.add(next);
        this.mode = 'serve';
        this.machine = MACHINE_FOR[next];
        this.left = BREW_SECONDS;
      }
    }
    const target = this.mode === 'serve' ? this.machine : WIPE_SPOTS[this.wipeAt];
    const gap = Math.abs(target - s.x);
    if (gap > 1e-3) {
      const step = Math.min(gap, BARISTA_WALK * dt);
      s.x += Math.sign(target - s.x) * step;
      s.heading = Math.sign(target - s.x || 1) * (Math.PI / 2);
      s.walking = true;
      s.speed = BARISTA_WALK;
      if (step < gap - 1e-9) return;
      s.x = target;
    }
    s.walking = false;
    s.speed = 0;
    s.heading = FACE_CAFE;
    s.action = this.mode === 'serve' ? 'brew' : 'wipe';
    s.holding = this.mode === 'serve' ? 'cup' : 'cloth';
    this.left -= dt;
    if (this.left > 0) return;
    if (this.mode === 'serve') this.mode = 'wipe';
    else this.wipeAt = (this.wipeAt + 1) % WIPE_SPOTS.length;
    this.left = WIPE_SECONDS;
  }
}

export class StaffRoutines {
  private readonly walkers: Walker[];
  private readonly grill: Loop;
  private readonly prep: Loop;
  private readonly barista: Barista;

  constructor(reducedMotion = false) {
    const walker = (id: StaffId): Walker => ({
      id,
      state: {
        id,
        x: 0,
        z: 0,
        heading: 0,
        action: 'wipe',
        walking: false,
        speed: 0,
        cooking: id === 'chef-grill',
        holding: null
      }
    });
    this.walkers = STAFF_IDS.map(walker);
    this.grill = new Loop(this.walkers[0], GRILL, reducedMotion);
    this.prep = new Loop(this.walkers[1], PREP, reducedMotion);
    this.barista = new Barista(this.walkers[2], reducedMotion);
  }

  /** Advances everyone by `dt`; `waiting` lists the café pickups where a coworker stands. */
  update(dt: number, waiting: readonly string[]): readonly StaffState[] {
    this.grill.update(dt);
    this.prep.update(dt);
    this.barista.update(dt, waiting);
    return this.walkers.map((w) => ({ ...w.state }));
  }
}
