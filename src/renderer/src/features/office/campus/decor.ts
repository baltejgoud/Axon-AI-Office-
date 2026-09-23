import type { FurnitureKind, LayoutBuilder } from './builder';
import type { Bounds, District } from './districts';

/** Where a department's pods sit, so decor can use the floor around them. */
export interface PodBlock {
  centreX: number;
  centreZ: number;
  cols: number;
  rows: number;
}

type Strip = Bounds & { side: 'front' | 'back' | 'left' | 'right' };
type Arrangement = 'nook' | 'ping-pong' | 'racks' | 'data-wall' | 'lounge' | 'studio' | 'wellbeing' | 'tree';

/** Floor each arrangement needs, including room to walk around it. */
const FOOTPRINT: Record<Arrangement, [number, number]> = {
  nook: [4.0, 2.9],
  'ping-pong': [4.4, 3.0],
  racks: [4.8, 2.6],
  'data-wall': [4.0, 3.4],
  lounge: [4.0, 3.2],
  studio: [4.0, 2.4],
  wellbeing: [4.0, 3.2],
  tree: [1.8, 1.8]
};

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

const OPPOSITE = { front: 'back', back: 'front', left: 'right', right: 'left' } as const;

function fits(strip: Strip, arrangement: Arrangement): boolean {
  const [w, d] = FOOTPRINT[arrangement];
  return strip.maxX - strip.minX >= w && strip.maxZ - strip.minZ >= d;
}

/** What each district likes to have around: first choice, then what goes in the opposite strip. */
function wishes(district: District, index: number): [Arrangement[], Arrangement[]] {
  switch (district.id) {
    case 'engineering':
      return [index % 2 ? ['ping-pong', 'nook', 'tree'] : ['nook', 'ping-pong', 'tree'], ['tree']];
    case 'ai-data':
      return [
        ['racks', 'tree'],
        ['data-wall', 'lounge', 'tree']
      ];
    case 'design':
      return [
        ['studio', 'lounge', 'tree'],
        ['lounge', 'tree']
      ];
    case 'people-ops':
      return [['wellbeing', 'lounge', 'tree'], ['tree']];
    default:
      return [['tree'], []];
  }
}

function place(b: LayoutBuilder, key: string, arrangement: Arrangement, strip: Strip): void {
  const cx = (strip.minX + strip.maxX) / 2;
  const cz = (strip.minZ + strip.maxZ) / 2;
  const id = (name: string) => `${key}-${name}`;
  switch (arrangement) {
    case 'nook':
      b.rug(id('nook-rug'), cx, cz, 3.4, 2.4);
      b.item(id('nook-sofa'), 'sofa', cx, cz - 0.65, 2.2, 0.85);
      b.item(id('nook-table'), 'coffee-table', cx, cz + 0.45, 0.8, 0.8, { round: true });
      b.plant(id('nook-plant'), cx + 1.6, cz - 0.7, true);
      return;
    case 'ping-pong':
      b.rug(id('pong-rug'), cx, cz, 4.0, 2.8);
      b.item(id('pong'), 'ping-pong', cx, cz, 2.74, 1.52);
      return;
    case 'racks': {
      const count = Math.min(6, Math.floor((strip.maxX - strip.minX - 1.2) / 0.68));
      for (let i = 0; i < count; i++)
        b.item(id(`rack-${i}`), 'server-rack', cx + (i - (count - 1) / 2) * 0.68, cz - 0.2, 0.62, 1.0);
      return;
    }
    case 'data-wall':
      b.item(id('data-wall'), 'data-wall', cx, cz - 0.9, 3.0, 0.3);
      b.item(id('data-bag-1'), 'bean-bag', cx - 0.8, cz + 0.6, 0.9, 0.9, { round: true });
      b.item(id('data-bag-2'), 'bean-bag', cx + 0.8, cz + 0.6, 0.9, 0.9, { round: true });
      return;
    case 'lounge':
    case 'wellbeing':
      b.rug(id('lounge-rug'), cx, cz, 3.4, 2.5);
      b.item(id('bag-1'), 'bean-bag', cx - 1.05, cz - 0.3, 0.9, 0.9, { round: true });
      b.item(id('bag-2'), 'bean-bag', cx + 0.1, cz + 0.45, 0.9, 0.9, { round: true });
      b.item(id('bag-3'), 'bean-bag', cx + 1.15, cz - 0.35, 0.9, 0.9, { round: true });
      if (arrangement === 'wellbeing') b.item(id('cooler'), 'water-cooler', cx + 1.6, cz + 0.85, 0.36, 0.36);
      else b.plant(id('lounge-plant'), cx - 1.5, cz + 0.8, true);
      return;
    case 'studio':
      b.item(id('drafting'), 'drafting-table', cx - 0.6, cz, 1.3, 0.9);
      b.item(id('studio-tree'), 'tree', cx + 1.2, cz, 1.0, 1.0, { round: true });
      return;
    case 'tree':
      b.item(id('tree'), 'tree', cx, cz, 1.0, 1.0, { round: true });
  }
}

/**
 * Gives a department's neighbourhood its character in the floor around its pods: a break nook or
 * ping-pong in Engineering, server racks and a data wall in the AI lab, a drafting corner in Design,
 * a wellbeing corner in People & Ops, and trees wherever there is room.
 */
export function decorateDepartment(
  b: LayoutBuilder,
  district: District,
  key: string,
  region: Bounds,
  pods: PodBlock,
  index: number
): void {
  const strips = freeStrips(region, pods).sort(
    (a, c) => (c.maxX - c.minX) * (c.maxZ - c.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ)
  );
  if (!strips.length) return;
  const [first, second] = wishes(district, index);
  // The first wish that fits anywhere, in the largest strip that holds it.
  let primary: Strip | undefined;
  let choice: Arrangement | undefined;
  for (const wish of first) {
    primary = strips.find((strip) => fits(strip, wish));
    if (primary) {
      choice = wish;
      break;
    }
  }
  if (!primary || !choice) return;
  place(b, `${key}-a`, choice, primary);
  const opposite = strips.find((strip) => strip.side === OPPOSITE[primary!.side]);
  if (!opposite) return;
  const next = second.find((arrangement) => fits(opposite, arrangement));
  if (next) place(b, `${key}-b`, next, opposite);
}
