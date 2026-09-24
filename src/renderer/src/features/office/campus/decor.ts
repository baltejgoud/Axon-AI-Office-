import type { FurnitureKind, LayoutBuilder, PoiTags } from './builder';
import type { Bounds, District, DistrictId } from './districts';

/** Where a department's pods sit, so decor can use the floor around them. */
export interface PodBlock {
  centreX: number;
  centreZ: number;
  cols: number;
  rows: number;
}

type Strip = Bounds & { side: 'front' | 'back' | 'left' | 'right' };
export type Arrangement =
  | 'nook'
  | 'ping-pong'
  | 'racks'
  | 'data-wall'
  | 'lounge'
  | 'studio'
  | 'wellbeing'
  | 'tree'
  | 'games'
  | 'snacks'
  | 'tv-corner';

/** Floor each arrangement needs (along x, along z), including room to walk around it. */
const FOOTPRINT: Record<Arrangement, [number, number]> = {
  nook: [4.0, 2.9],
  'ping-pong': [4.4, 3.0],
  racks: [4.8, 2.6],
  'data-wall': [4.0, 3.4],
  lounge: [4.0, 3.2],
  studio: [4.0, 2.4],
  wellbeing: [4.0, 3.2],
  tree: [1.8, 1.8],
  games: [4.6, 3.0],
  snacks: [3.2, 2.2],
  'tv-corner': [3.4, 3.0]
};
/** Room between neighbouring arrangements in a strip. */
const GAP = 0.3;
/** Fillers (trees) per strip at most, once the wishes are in. */
const MAX_FILLERS = 1;

/** What a department's floor got, for the checks: its arrangements and its widest bare stretch. */
export interface DecorPlan {
  key: string;
  district: DistrictId;
  placed: Arrangement[];
  /** The widest open stretch left along any strip, in metres. */
  bare: number;
}

/** The whiteboard each department gets: some districts pin up something more their own. */
export function boardKind(district: District, department: string): FurnitureKind {
  if (district.id === 'product') return 'kanban-board';
  if (district.id === 'design' || department === 'Marketing Management') return 'mood-board';
  if (department === 'HR & People') return 'pinboard';
  return 'whiteboard';
}

/** Open floor around the pod block, keeping a 1 m walkway clear of the pods and chairs. */
export function freeStrips(region: Bounds, pods: PodBlock): Strip[] {
  const halfW = (pods.cols - 1) * 2.4 + 1.6 + 1.0;
  const halfD = (pods.rows - 1) * 2.6 + 1.43 + 1.0;
  const strips: Strip[] = [
    { side: 'front', minX: region.minX, maxX: region.maxX, minZ: pods.centreZ + halfD, maxZ: region.maxZ },
    { side: 'back', minX: region.minX, maxX: region.maxX, minZ: region.minZ, maxZ: pods.centreZ - halfD },
    { side: 'left', minX: region.minX, maxX: pods.centreX - halfW, minZ: region.minZ, maxZ: region.maxZ },
    { side: 'right', minX: pods.centreX + halfW, maxX: region.maxX, minZ: region.minZ, maxZ: region.maxZ }
  ];
  return strips.filter((s) => s.maxX - s.minX >= 1.8 && s.maxZ - s.minZ >= 1.8);
}

/**
 * What each district likes to have around, in order of preference, and what fills the rest.
 * Engineering, with the most open floor, gets its play corners, snacks and a TV corner first.
 */
function wishes(district: District, index: number): [Arrangement[], Arrangement[]] {
  switch (district.id) {
    case 'engineering':
      return [
        index % 2
          ? ['ping-pong', 'games', 'snacks', 'tv-corner', 'nook']
          : ['nook', 'games', 'snacks', 'tv-corner', 'ping-pong'],
        ['tree']
      ];
    case 'ai-data':
      return [['racks', 'data-wall', 'games', 'snacks', 'tv-corner', 'lounge'], ['tree']];
    case 'design':
      return [['studio', 'lounge', 'snacks'], ['tree']];
    case 'people-ops':
      return [['wellbeing', 'snacks', 'lounge'], ['tree']];
    case 'product':
      return [['snacks'], ['tree']];
    default:
      return [[], ['tree']];
  }
}

export interface Packed {
  placed: { arrangement: Arrangement; cx: number; cz: number }[];
  /** The open stretch between neighbours (and at each end) once spread evenly. */
  bare: number;
}

/**
 * Lays arrangements along a strip's long side: the wishes that fit, in order, then up to two
 * fillers, spread evenly so no stretch of floor stays bare for long. Each arrangement keeps its
 * own orientation (fronts toward +z); only its place along the strip changes.
 */
export function packStrip(
  strip: Bounds,
  wanted: readonly Arrangement[],
  fillers: readonly Arrangement[],
  most = Infinity
): Packed {
  const alongX = strip.maxX - strip.minX >= strip.maxZ - strip.minZ;
  const length = alongX ? strip.maxX - strip.minX : strip.maxZ - strip.minZ;
  const breadth = alongX ? strip.maxZ - strip.minZ : strip.maxX - strip.minX;
  const along = (a: Arrangement) => (alongX ? FOOTPRINT[a][0] : FOOTPRINT[a][1]);
  const across = (a: Arrangement) => (alongX ? FOOTPRINT[a][1] : FOOTPRINT[a][0]);
  const chosen: Arrangement[] = [];
  let used = 0;
  const tryAdd = (a: Arrangement) => {
    const extra = along(a) + (chosen.length ? GAP : 0);
    if (across(a) > breadth || used + extra > length + 1e-9) return false;
    chosen.push(a);
    used += extra;
    return true;
  };
  for (const a of wanted) if (chosen.length < most) tryAdd(a);
  for (let n = 0; n < MAX_FILLERS;) {
    const before = chosen.length;
    for (const a of fillers) if (n < MAX_FILLERS && tryAdd(a)) n++;
    if (chosen.length === before) break;
  }
  const occupied = chosen.reduce((sum, a) => sum + along(a), 0);
  const spacing = (length - occupied) / (chosen.length + 1);
  const mid = alongX ? (strip.minZ + strip.maxZ) / 2 : (strip.minX + strip.maxX) / 2;
  let cursor = (alongX ? strip.minX : strip.minZ) + spacing;
  const placed = chosen.map((arrangement) => {
    const centre = cursor + along(arrangement) / 2;
    cursor += along(arrangement) + spacing;
    return alongX ? { arrangement, cx: centre, cz: mid } : { arrangement, cx: mid, cz: centre };
  });
  return { placed, bare: spacing };
}

/** The arrangements a department's strips get, largest strip first; each wish is used once. */
function planStrips(strips: Strip[], district: District, index: number): { strip: Strip; packed: Packed }[] {
  const [wanted, fillers] = wishes(district, index);
  const left = [...wanted];
  // Wishes are shared out: no strip takes more than its share while others stand empty.
  const share = Math.max(1, Math.ceil(wanted.length / Math.max(1, strips.length)));
  return strips.map((strip) => {
    const packed = packStrip(strip, left, fillers, share);
    for (const { arrangement } of packed.placed) {
      const at = left.indexOf(arrangement);
      if (at >= 0 && !fillers.includes(arrangement)) left.splice(at, 1);
    }
    return { strip, packed };
  });
}

function place(
  b: LayoutBuilder,
  id: (name: string) => string,
  arrangement: Arrangement,
  cx: number,
  cz: number,
  tags: PoiTags
): void {
  switch (arrangement) {
    case 'nook':
      b.rug(id('rug'), cx, cz, 3.4, 2.4);
      b.item(id('sofa'), 'sofa', cx, cz - 0.65, 2.2, 0.85);
      b.item(id('table'), 'coffee-table', cx, cz + 0.45, 0.8, 0.8, { round: true });
      b.plant(id('plant'), cx + 1.6, cz - 0.7, true);
      return;
    case 'ping-pong':
      b.rug(id('rug'), cx, cz, 4.0, 2.8);
      b.item(id('table'), 'ping-pong', cx, cz, 2.74, 1.52);
      return;
    case 'racks':
      for (let i = 0; i < 6; i++)
        b.item(id(`rack-${i}`), 'server-rack', cx + (i - 2.5) * 0.68, cz - 0.2, 0.62, 1.0);
      return;
    case 'data-wall':
      b.item(id('wall'), 'data-wall', cx, cz - 0.9, 3.0, 0.3);
      b.item(id('bag-1'), 'bean-bag', cx - 0.8, cz + 0.6, 0.9, 0.9, { round: true });
      b.item(id('bag-2'), 'bean-bag', cx + 0.8, cz + 0.6, 0.9, 0.9, { round: true });
      return;
    case 'lounge':
    case 'wellbeing':
      b.rug(id('rug'), cx, cz, 3.4, 2.5);
      b.item(id('bag-1'), 'bean-bag', cx - 1.05, cz - 0.3, 0.9, 0.9, { round: true });
      b.item(id('bag-2'), 'bean-bag', cx + 0.1, cz + 0.45, 0.9, 0.9, { round: true });
      b.item(id('bag-3'), 'bean-bag', cx + 1.15, cz - 0.35, 0.9, 0.9, { round: true });
      if (arrangement === 'wellbeing') b.item(id('cooler'), 'water-cooler', cx + 1.6, cz + 0.85, 0.36, 0.36);
      else b.plant(id('plant'), cx - 1.5, cz + 0.8, true);
      return;
    case 'studio':
      b.item(id('drafting'), 'drafting-table', cx - 0.6, cz, 1.3, 0.9);
      b.item(id('tree'), 'tree', cx + 1.2, cz, 1.0, 1.0, { round: true });
      return;
    case 'tree':
      b.item(id('tree'), 'tree', cx, cz, 1.0, 1.0, { round: true });
      return;
    case 'games': {
      // Foosball for two (one at each side of the table), an arcade cabinet and a dartboard.
      b.rug(id('rug'), cx, cz, 4.3, 2.7);
      const fx = cx - 0.8;
      const fz = cz + 0.1;
      b.item(id('foosball'), 'foosball', fx, fz, 1.2, 0.7, {
        busyWith: [id('foosball-1'), id('foosball-2')]
      });
      b.spot(id('foosball-1'), 'play', 'agents', fx, fz - 0.78, 0, tags);
      b.spot(id('foosball-2'), 'play', 'agents', fx, fz + 0.78, Math.PI, tags);
      b.item(id('arcade'), 'arcade', cx + 1.2, cz - 0.7, 0.7, 0.75, { busyWith: [id('arcade-player')] });
      b.spot(id('arcade-player'), 'play', 'agents', cx + 1.2, cz + 0.2, Math.PI, tags);
      b.item(id('dartboard'), 'dartboard', cx - 2.0, cz - 0.95, 0.45, 0.3);
      return;
    }
    case 'snacks':
      b.item(id('vending'), 'vending-machine', cx - 0.8, cz - 0.4, 0.9, 0.8);
      b.item(id('shelf'), 'snack-shelf', cx + 0.5, cz - 0.55, 1.2, 0.45);
      return;
    case 'tv-corner':
      b.rug(id('rug'), cx, cz, 3.0, 2.6);
      b.item(id('tv'), 'tv-corner', cx, cz - 1.0, 1.4, 0.4);
      b.item(id('bag-1'), 'bean-bag', cx - 0.6, cz + 0.45, 0.9, 0.9, { round: true });
      b.item(id('bag-2'), 'bean-bag', cx + 0.6, cz + 0.45, 0.9, 0.9, { round: true });
      b.plant(id('plant'), cx + 1.35, cz - 1.0);
  }
}

/**
 * Gives a department's neighbourhood its character in the floor around its pods: play corners,
 * snacks and a TV corner in Engineering, server racks and a data wall in the AI lab, a drafting
 * corner in Design, a wellbeing corner in People & Ops, and trees wherever there is room.
 */
export function decorateDepartment(
  b: LayoutBuilder,
  district: District,
  key: string,
  region: Bounds,
  pods: PodBlock,
  index: number,
  tags: PoiTags = {}
): DecorPlan {
  const strips = freeStrips(region, pods).sort(
    (a, c) => (c.maxX - c.minX) * (c.maxZ - c.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ)
  );
  const plan: DecorPlan = { key, district: district.id, placed: [], bare: 0 };
  let filler = 0;
  for (const { packed } of planStrips(strips, district, index)) {
    plan.bare = Math.max(plan.bare, packed.bare);
    for (const { arrangement, cx, cz } of packed.placed) {
      const name = arrangement === 'tree' ? `tree-${++filler}` : arrangement;
      place(b, (part) => `${key}-${name}-${part}`, arrangement, cx, cz, tags);
      plan.placed.push(arrangement);
    }
  }
  return plan;
}
