import type { DeskEquipment, DeskProp } from './builder';

/**
 * Where things sit on a desk, in the seat's frame: the person sits at the origin looking toward +z,
 * x runs to their right. Rectangles are footprints on the desktop, in metres.
 */
export interface Placement {
  item:
    | DeskEquipment
    | DeskProp
    | 'keyboard'
    | 'mouse'
    | 'monitor'
    | 'monitor-left'
    | 'monitor-right'
    | 'lunch'
    | 'lunch-bowl';
  x: number;
  z: number;
  w: number;
  d: number;
  /** Yaw on the desk, radians; the footprint already covers the turned item. */
  turn: number;
}

export interface Surface {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the desktop above the floor. */
  top: number;
}

/** Half a pod in front of one seat, short of the divider down the middle. */
export const POD_DESK: Surface = { minX: -0.78, maxX: 0.78, minZ: 0.4, maxZ: 1.12, top: 0.765 };
/** A single 1.4 x 0.7 desk in one of the Commons rooms. */
export const SINGLE_DESK: Surface = { minX: -0.66, maxX: 0.66, minZ: 0.4, maxZ: 1.0, top: 0.765 };
/** An executive desk, 1.8 x 0.85. */
export const EXEC_DESK: Surface = { minX: -0.86, maxX: 0.86, minZ: 0.38, maxZ: 1.12, top: 0.776 };
/** The front desk's work surface, in front of the raised visitor counter. */
export const RECEPTION_DESK: Surface = { minX: -0.62, maxX: 0.62, minZ: 0.36, maxZ: 0.75, top: 0.762 };

/** The desktop a seat works at, from its spot id and district. */
export function surfaceOf(poiId: string, district?: string): Surface {
  if (poiId === 'desk-reception') return RECEPTION_DESK;
  if (district === 'leadership') return EXEC_DESK;
  if (['desk-marketing', 'desk-librarian', 'desk-files', 'desk-product'].includes(poiId)) return SINGLE_DESK;
  return POD_DESK;
}

/** Screens on the desk, drawn by the shared screen meshes. */
export const SCREENS_PER_SETUP: Readonly<Record<DeskEquipment, number>> = {
  laptop: 1,
  monitor: 1,
  'laptop-monitor': 2,
  'dual-monitor': 2
};

/** How much desk each prop covers, lying or standing on it. */
export const PROP_SIZE: Readonly<Record<DeskProp, [w: number, d: number]>> = {
  mug: [0.1, 0.09],
  notebook: [0.17, 0.22],
  lamp: [0.14, 0.2],
  plant: [0.16, 0.16],
  folder: [0.23, 0.3],
  books: [0.16, 0.22],
  tablet: [0.18, 0.24],
  'pen-cup': [0.07, 0.07],
  headphones: [0.19, 0.17],
  bottle: [0.08, 0.08],
  photo: [0.13, 0.07],
  'sticky-notes': [0.09, 0.09],
  succulent: [0.1, 0.1],
  figurine: [0.07, 0.07]
};

const MONITOR: [number, number] = [0.58, 0.2];
const rotatedBox = (w: number, d: number, turn: number): [number, number] => [
  Math.abs(w * Math.cos(turn)) + Math.abs(d * Math.sin(turn)),
  Math.abs(w * Math.sin(turn)) + Math.abs(d * Math.cos(turn))
];

/** Screens, keyboard and mouse for a setup, fitted to `surface`. */
export function equipmentPlacements(equipment: DeskEquipment, surface: Surface = POD_DESK): Placement[] {
  const front = surface.minZ;
  const back = surface.maxZ;
  const at = (item: Placement['item'], x: number, z: number, w: number, d: number, turn = 0): Placement => ({
    item,
    x,
    z,
    w,
    d,
    turn
  });
  switch (equipment) {
    case 'laptop':
      return [at('laptop', 0, front + 0.21, 0.34, 0.26), at('mouse', 0.3, front + 0.16, 0.19, 0.16)];
    case 'monitor': {
      const deep = back - front > 0.5;
      return [
        at('monitor', 0, deep ? back - 0.16 : back - 0.11, ...MONITOR),
        at('keyboard', 0, front + (deep ? 0.1 : 0.075), 0.38, 0.13),
        at('mouse', 0.32, front + (deep ? 0.12 : 0.085), 0.18, 0.15)
      ];
    }
    case 'laptop-monitor':
      return [
        at('laptop', -0.5, back - 0.29, 0.3, 0.26, 0.35),
        at('monitor', 0.14, back - 0.16, ...MONITOR),
        at('keyboard', 0.1, front + 0.1, 0.38, 0.13),
        at('mouse', 0.43, front + 0.12, 0.18, 0.15)
      ];
    case 'dual-monitor': {
      const turn = 0.28;
      const [w, d] = rotatedBox(MONITOR[0], MONITOR[1], turn);
      return [
        at('monitor-left', -0.32, back - 0.2, w, d, turn),
        at('monitor-right', 0.32, back - 0.2, w, d, -turn),
        at('keyboard', 0, front + 0.1, 0.38, 0.13),
        at('mouse', 0.33, front + 0.12, 0.18, 0.15)
      ];
    }
  }
}

const GAP = 0.02;
const overlaps = (a: Placement, b: Placement) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + GAP * 2 && Math.abs(a.z - b.z) * 2 < a.d + b.d + GAP * 2;

/**
 * Personal things around the equipment: each prop takes the first free place along the outer edge
 * of its side (alternating left and right), front to back. Props that find no room are left off.
 */
export function propPlacements(
  equipment: DeskEquipment,
  props: readonly DeskProp[],
  surface: Surface = POD_DESK
): Placement[] {
  const taken = equipmentPlacements(equipment, surface);
  const placed: Placement[] = [];
  props.forEach((prop, index) => {
    const [w, d] = PROP_SIZE[prop];
    const side = index % 2 === 0 ? -1 : 1;
    const xs: number[] = [];
    for (let x = surface.maxX - w / 2; x >= surface.minX + w / 2 - 1e-9; x -= 0.03) xs.push(side * x);
    const zs: number[] = [];
    for (let z = surface.minZ + d / 2; z <= surface.maxZ - d / 2 + 1e-9; z += 0.03) zs.push(z);
    for (const x of xs)
      for (const z of zs) {
        const candidate: Placement = { item: prop, x, z, w, d, turn: 0 };
        if (taken.some((other) => overlaps(candidate, other))) continue;
        const turn = ((index * 0.37) % 0.3) - 0.15;
        placed.push({ ...candidate, turn: prop === 'photo' ? side * 0.35 : turn });
        taken.push(candidate);
        return;
      }
  });
  return placed;
}

/** A lunch bowl with a drink beside it, or the bowl alone on a full desk. */
export const LUNCH_SIZE = { lunch: [0.24, 0.16], 'lunch-bowl': [0.15, 0.15] } as const;
/** Lunch goes within easy reach: beside the keyboard, never out by the desk's far corners. */
const LUNCH_REACH = 0.62;

/**
 * Where lunch goes on a desk: the free place nearest the person's left hand, clear of the screens,
 * keyboard, mouse and their own things; the bowl alone if there is no room for a drink too. Null
 * when the desk is too full even for that.
 */
export function lunchPlacement(
  equipment: DeskEquipment,
  props: readonly DeskProp[],
  surface: Surface = POD_DESK
): Placement | null {
  const taken = [...equipmentPlacements(equipment, surface), ...propPlacements(equipment, props, surface)];
  return fitLunch('lunch', taken, surface) ?? fitLunch('lunch-bowl', taken, surface);
}

function fitLunch(item: 'lunch' | 'lunch-bowl', taken: Placement[], surface: Surface): Placement | null {
  const [w, d] = LUNCH_SIZE[item];
  const reach = Math.min(LUNCH_REACH, surface.maxX) - w / 2;
  const from = Math.max(-reach, surface.minX + w / 2);
  const hand = { x: -0.3, z: surface.minZ };
  let best: Placement | null = null;
  let nearest = Infinity;
  for (let x = from; x <= reach + 1e-9; x += 0.02)
    for (let z = surface.minZ + d / 2; z <= surface.maxZ - d / 2 + 1e-9; z += 0.02) {
      const candidate: Placement = { item, x, z, w, d, turn: 0 };
      if (taken.some((other) => overlaps(candidate, other))) continue;
      const distance = Math.hypot(x - hand.x, z - hand.z);
      if (distance < nearest) {
        nearest = distance;
        best = candidate;
      }
    }
  return best;
}
