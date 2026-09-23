import { yawTowards, type PointOfInterest, type PoiType, type Vec2, type ZoneId } from './types';

/**
 * The office floor plan. The renderer builds furniture from this data and the pathfinder derives its
 * obstacles from the same data, so what people walk around is exactly what is drawn.
 * Units are metres; x runs along the back wall (left to right), z runs toward the viewer.
 */
export const ROOM = { minX: -25, maxX: 13, minZ: -9, maxZ: 9 } as const;
export const WALL_THICKNESS = 0.16;

const HALF_PI = Math.PI / 2;
const FACE_FRONT = 0; // +z, toward the viewer
const FACE_BACK = Math.PI; // -z, toward the back wall
const FACE_RIGHT = HALF_PI; // +x
const FACE_LEFT = -HALF_PI; // -x

export type WallKind = 'solid' | 'glass' | 'low';

export interface Wall {
  id: string;
  kind: WallKind;
  from: Vec2;
  to: Vec2;
  height: number;
}

const wall = (id: string, kind: WallKind, x1: number, z1: number, x2: number, z2: number): Wall => ({
  id,
  kind,
  from: { x: x1, z: z1 },
  to: { x: x2, z: z2 },
  height: kind === 'solid' ? 2.7 : kind === 'glass' ? 2.3 : 0.32
});

export const WALLS: Wall[] = [
  wall('wall-back', 'solid', -25, -9, 13, -9),
  wall('wall-left', 'solid', -25, -9, -25, 9),
  // The two walls nearest the viewer are cut low, dollhouse style, so nothing hides behind them.
  wall('wall-right', 'low', 13, -9, 13, 9),
  wall('wall-front', 'low', -25, 9, 13, 9),
  wall('glass-lounge', 'glass', -13, -4.2, -8.6, -4.2),
  wall('glass-meeting-w', 'glass', -5.6, -9, -5.6, -3.6),
  wall('glass-meeting-s1', 'glass', -5.6, -3.6, -1.0, -3.6),
  wall('glass-meeting-s2', 'glass', 0.2, -3.6, 1.6, -3.6),
  wall('glass-library-w', 'glass', 1.6, -9, 1.6, -3.6),
  wall('glass-library-s1', 'glass', 1.6, -3.6, 3.0, -3.6),
  wall('glass-library-s2', 'glass', 5.0, -3.6, 8.4, -3.6),
  wall('glass-files-w', 'glass', 8.4, -9, 8.4, -1.6),
  wall('glass-files-s1', 'glass', 8.4, -1.6, 10.2, -1.6),
  wall('glass-files-s2', 'glass', 11.4, -1.6, 13, -1.6)
];

export type FurnitureKind =
  | 'rug'
  | 'desk-pod'
  | 'desk'
  | 'office-chair'
  | 'meeting-table'
  | 'meeting-chair'
  | 'round-table'
  | 'sofa'
  | 'armchair'
  | 'coffee-table'
  | 'side-table'
  | 'bookshelf'
  | 'printer'
  | 'file-cabinet'
  | 'cafe-counter'
  | 'cafe-island'
  | 'stool'
  | 'cafe-table'
  | 'cafe-chair'
  | 'whiteboard'
  | 'wall-screen'
  | 'plant'
  | 'plant-large'
  | 'credenza'
  | 'floor-lamp'
  | 'bench'
  | 'low-cabinet';

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  /** Size along the item's own x and z axes, before rotation. Diameter for round items. */
  w: number;
  d: number;
  /** Yaw. Rectangles only ever turn in quarter turns. Seats face this way. */
  rotation: number;
  round: boolean;
  /** Whether people must walk around it. Rugs and wall-mounted items do not block. */
  blocks: boolean;
}

const item = (
  id: string,
  kind: FurnitureKind,
  x: number,
  z: number,
  w: number,
  d: number,
  options: { rotation?: number; round?: boolean; blocks?: boolean } = {}
): FurnitureItem => ({
  id,
  kind,
  x,
  z,
  w,
  d,
  rotation: options.rotation ?? 0,
  round: options.round ?? false,
  blocks: options.blocks ?? true
});

const rug = (id: string, x: number, z: number, w: number, d: number) =>
  item(id, 'rug', x, z, w, d, { blocks: false });
const plant = (id: string, x: number, z: number, large = false) =>
  item(id, large ? 'plant-large' : 'plant', x, z, large ? 0.62 : 0.48, large ? 0.62 : 0.48, { round: true });

const FIXED_FURNITURE: FurnitureItem[] = [
  // Lounge (Chat)
  rug('rug-lounge', -9.9, -6.5, 5.2, 3.8),
  item('sofa', 'sofa', -10.3, -8.4, 3.3, 0.95),
  item('lounge-table', 'coffee-table', -10.3, -6.2, 0.9, 0.9, { round: true }),
  item('lounge-lamp', 'floor-lamp', -12.45, -8.45, 0.35, 0.35, { round: true }),
  item('desk-marketing-surface', 'desk', -7.0, -8.5, 1.4, 0.7),
  plant('plant-lounge-1', -8.2, -8.45, true),
  plant('plant-lounge-2', -5.95, -4.6),
  // Meeting room (Workspaces)
  rug('rug-meeting', -2.0, -6.4, 5.6, 3.8),
  item('meeting-table', 'meeting-table', -2.0, -6.4, 3.8, 1.3),
  item('meeting-screen', 'wall-screen', -2.0, -8.88, 2.2, 0.05, { blocks: false }),
  item('meeting-whiteboard', 'whiteboard', -4.6, -8.45, 1.3, 0.1),
  plant('plant-meeting', 1.05, -8.4, true),
  // Library (Knowledge)
  rug('rug-library', 5.0, -6.3, 5.6, 4.4),
  item('bookshelf', 'bookshelf', 5.2, -8.7, 4.6, 0.45),
  item('library-side-table', 'side-table', 2.5, -6.35, 0.5, 0.5, { round: true }),
  item('desk-librarian-surface', 'desk', 7.8, -5.8, 1.4, 0.7, { rotation: HALF_PI }),
  plant('plant-library-1', 2.1, -8.45),
  plant('plant-library-2', 8.0, -8.45),
  // Files room
  item('printer', 'printer', 9.75, -8.5, 0.95, 0.62),
  item('desk-files-surface', 'desk', 11.75, -8.5, 1.4, 0.7),
  item('file-cabinets', 'file-cabinet', 12.5, -4.6, 0.7, 2.6),
  plant('plant-files', 9.0, -2.15),
  // Collaboration corner
  rug('rug-collab', -9.8, -0.5, 4.6, 4.2),
  item('collab-table', 'round-table', -9.8, -0.5, 1.5, 1.5, { round: true }),
  item('collab-whiteboard', 'whiteboard', -10.4, -3.75, 2.2, 0.1),
  item('collab-cabinet', 'low-cabinet', -6.5, 0.1, 0.5, 3.2),
  plant('plant-collab-1', -12.4, -3.55, true),
  plant('plant-collab-2', -12.4, 2.6),
  // Desk pods (Agents)
  rug('rug-pods', 0.2, 0.7, 10, 4.6),
  item('pod-a', 'desk-pod', -2.4, 0.7, 3.2, 1.6),
  item('pod-b', 'desk-pod', 2.8, 0.7, 3.2, 1.6),
  // Café
  item('cafe-counter', 'cafe-counter', 10.5, 1.95, 4.6, 0.65),
  item('cafe-island', 'cafe-island', 10.3, 4.35, 3.0, 0.8),
  item('cafe-table-1', 'cafe-table', 8.3, 7.35, 0.9, 0.9, { round: true }),
  item('cafe-table-2', 'cafe-table', 11.7, 7.35, 0.9, 0.9, { round: true }),
  plant('plant-cafe-1', 7.1, 1.9, true),
  plant('plant-cafe-2', 12.55, 5.9),
  // Entrance and front
  rug('rug-entry', -9.5, 7.6, 3.4, 1.6),
  item('entry-bench', 'bench', -12.55, 6.2, 0.5, 2.2),
  plant('plant-entry-1', -12.4, 4.2, true),
  plant('plant-entry-2', -7.2, 8.35),
  item('front-credenza', 'credenza', 1.8, 7.25, 5.6, 0.55)
];

const SEAT_FOOTPRINT: Partial<Record<FurnitureKind, number>> = {
  'office-chair': 0.56,
  'meeting-chair': 0.54,
  armchair: 0.85,
  stool: 0.4,
  'cafe-chair': 0.5
};

const pois: PointOfInterest[] = [];
const seatFurniture: FurnitureItem[] = [];

function seat(
  id: string,
  type: PoiType,
  zoneId: ZoneId,
  x: number,
  z: number,
  facing: number,
  approach: Vec2,
  furniture: FurnitureKind | null,
  group?: PointOfInterest['group']
): void {
  pois.push({ id, type, zoneId, position: { x, z }, facing, approach, seated: true, capacity: 1, group });
  if (furniture) {
    const size = SEAT_FOOTPRINT[furniture] ?? 0.5;
    seatFurniture.push(item(`${id}-seat`, furniture, x, z, size, size, { rotation: facing }));
  }
}

function spot(id: string, type: PoiType, zoneId: ZoneId, x: number, z: number, facing: number): void {
  const position = { x, z };
  pois.push({ id, type, zoneId, position, facing, approach: position, seated: false, capacity: 1 });
}

/** Seats at a desk: the chair sits 0.35 m from the desk edge, approached from behind. */
function deskSeat(
  id: string,
  zoneId: ZoneId,
  x: number,
  z: number,
  facing: number,
  chair: FurnitureKind = 'office-chair'
) {
  const approach = { x: x - Math.sin(facing) * 0.68, z: z - Math.cos(facing) * 0.68 };
  seat(id, 'desk', zoneId, x, z, facing, approach, chair);
}

// New specialist wing: six four-person studios with generous shared aisles.
export const SPECIALIST_DESKS: string[] = [];
for (const [row, z] of [-6.0, -0.5, 5.0].entries()) {
  for (const [column, x] of [-21.5, -16.0].entries()) {
    const pod = `studio-${row}-${column}`;
    FIXED_FURNITURE.push(rug(`rug-${pod}`, x, z, 4.6, 4.5));
    FIXED_FURNITURE.push(item(pod, 'desk-pod', x, z, 3.2, 1.6));
    for (const side of [-1, 1])
      for (const offset of [-0.8, 0.8]) {
        const id = `desk-specialist-${SPECIALIST_DESKS.length}`;
        deskSeat(id, 'agents', x + offset, z + side * 1.15, side < 0 ? FACE_FRONT : FACE_BACK);
        SPECIALIST_DESKS.push(id);
      }
  }
}
FIXED_FURNITURE.push(
  plant('studio-plant-n', -18.75, -8.3, true),
  plant('studio-plant-s', -18.75, 8.3, true),
  item('studio-whiteboard', 'whiteboard', -18.6, -8.65, 2, 0.1)
);

// Desk pods: pod A (left) and pod B (right), two seats per side.
deskSeat('desk-analyst', 'agents', -3.2, -0.45, FACE_FRONT);
deskSeat('desk-pod-a-ne', 'agents', -1.6, -0.45, FACE_FRONT);
deskSeat('desk-pod-a-sw', 'agents', -3.2, 1.85, FACE_BACK);
deskSeat('desk-writer', 'agents', -1.6, 1.85, FACE_BACK);
deskSeat('desk-pod-b-nw', 'agents', 2.0, -0.45, FACE_FRONT);
deskSeat('desk-ops', 'agents', 3.6, -0.45, FACE_FRONT);
deskSeat('desk-designer', 'agents', 2.0, 1.85, FACE_BACK);
deskSeat('desk-pod-b-se', 'agents', 3.6, 1.85, FACE_BACK);
// Desks in the rooms.
deskSeat('desk-marketing', 'chat', -7.0, -7.8, FACE_BACK);
deskSeat('desk-librarian', 'knowledge', 7.1, -5.8, FACE_RIGHT);
deskSeat('desk-files', 'files', 11.75, -7.8, FACE_BACK);
deskSeat('desk-product', 'workspaces', 0.3, -6.4, FACE_LEFT, 'meeting-chair');

// Meeting room seats around the long table.
for (const [index, x] of [-3.2, -2.0, -0.8].entries()) {
  seat(
    `meeting-n${index + 1}`,
    'meeting',
    'workspaces',
    x,
    -7.45,
    FACE_FRONT,
    { x, z: -8.05 },
    'meeting-chair',
    'meeting-room'
  );
  seat(
    `meeting-s${index + 1}`,
    'meeting',
    'workspaces',
    x,
    -5.35,
    FACE_BACK,
    { x, z: -4.7 },
    'meeting-chair',
    'meeting-room'
  );
}
seat(
  'meeting-w',
  'meeting',
  'workspaces',
  -4.3,
  -6.4,
  FACE_RIGHT,
  { x: -4.95, z: -6.4 },
  'meeting-chair',
  'meeting-room'
);

// Round collaboration table.
seat(
  'collab-w',
  'meeting',
  'workspaces',
  -10.9,
  -0.5,
  FACE_RIGHT,
  { x: -11.55, z: -0.5 },
  'meeting-chair',
  'collab-table'
);
seat(
  'collab-e',
  'meeting',
  'workspaces',
  -8.7,
  -0.5,
  FACE_LEFT,
  { x: -8.05, z: -0.5 },
  'meeting-chair',
  'collab-table'
);
seat(
  'collab-n',
  'meeting',
  'workspaces',
  -9.8,
  -1.6,
  FACE_FRONT,
  { x: -9.8, z: -2.25 },
  'meeting-chair',
  'collab-table'
);
seat(
  'collab-s',
  'meeting',
  'workspaces',
  -9.8,
  0.6,
  FACE_BACK,
  { x: -9.8, z: 1.25 },
  'meeting-chair',
  'collab-table'
);

// Lounge and reading seats.
for (const [index, x] of [-11.3, -10.3, -9.3].entries())
  seat(`lounge-sofa-${index + 1}`, 'lounge', 'chat', x, -7.75, FACE_FRONT, { x, z: -7.15 }, null);
seat('lounge-armchair', 'lounge', 'chat', -12.2, -6.3, FACE_RIGHT, { x: -11.35, z: -6.3 }, 'armchair');
seat('library-reading', 'lounge', 'knowledge', 2.55, -5.3, FACE_RIGHT, { x: 3.3, z: -5.3 }, 'armchair');

// Café: pick-up spots at the counter, stools at the island, two small tables.
spot('cafe-machine', 'cafe', 'cafe', 11.9, 2.75, FACE_BACK);
spot('cafe-counter-1', 'cafe', 'cafe', 10.6, 2.75, FACE_BACK);
spot('cafe-counter-2', 'cafe', 'cafe', 9.35, 2.75, FACE_BACK);
for (const [index, x] of [9.3, 10.3, 11.3].entries())
  seat(`cafe-stool-${index + 1}`, 'cafe-seat', 'cafe', x, 5.2, FACE_BACK, { x, z: 5.85 }, 'stool');
seat('cafe-t1-a', 'cafe-seat', 'cafe', 7.55, 7.35, FACE_RIGHT, { x: 7.55, z: 6.6 }, 'cafe-chair');
seat('cafe-t1-b', 'cafe-seat', 'cafe', 9.05, 7.35, FACE_LEFT, { x: 9.05, z: 6.6 }, 'cafe-chair');
seat('cafe-t2-a', 'cafe-seat', 'cafe', 10.95, 7.35, FACE_RIGHT, { x: 10.95, z: 6.6 }, 'cafe-chair');
seat('cafe-t2-b', 'cafe-seat', 'cafe', 12.45, 7.35, FACE_LEFT, { x: 12.45, z: 6.6 }, 'cafe-chair');

// Standing spots.
spot('collab-wb-1', 'whiteboard', 'workspaces', -11.0, -3.1, FACE_BACK);
spot('collab-wb-2', 'whiteboard', 'workspaces', -9.8, -3.1, FACE_BACK);
spot('meeting-wb', 'whiteboard', 'workspaces', -4.6, -7.85, FACE_BACK);
spot('shelf-1', 'bookshelf', 'knowledge', 4.0, -7.95, FACE_BACK);
spot('shelf-2', 'bookshelf', 'knowledge', 6.4, -7.95, FACE_BACK);
spot('printer', 'printer', 'files', 9.75, -7.6, FACE_BACK);
spot('file-cabinet', 'files', 'files', 11.55, -4.6, FACE_RIGHT);
spot('open-window', 'open-area', 'workspaces', -12.2, 1.9, FACE_LEFT);
spot('open-cafe', 'open-area', 'cafe', 6.2, 5.2, Math.PI / 4);
spot('open-front', 'open-area', 'agents', -4.4, 5.4, FACE_FRONT);

// A standing spot beside each home desk, facing its occupant, for coworkers who drop by.
const VISIT_SPOTS: [string, number, number][] = [
  ...SPECIALIST_DESKS.map((id): [string, number, number] => {
    const desk = pois.find((poi) => poi.id === id)!;
    return [id, desk.approach.x, desk.approach.z];
  }),
  ['desk-analyst', -2.4, -1.05],
  ['desk-writer', -2.4, 2.45],
  ['desk-designer', 2.8, 2.45],
  ['desk-ops', 2.8, -1.05],
  ['desk-librarian', 6.3, -4.85],
  ['desk-marketing', -7.95, -7.2],
  ['desk-files', 10.85, -7.1],
  ['desk-product', 1.0, -5.35]
];

export const POINTS_OF_INTEREST: readonly PointOfInterest[] = pois;
export const FURNITURE: readonly FurnitureItem[] = [...FIXED_FURNITURE, ...seatFurniture];

const poiIndex = new Map(pois.map((poi) => [poi.id, poi]));

for (const [deskId, x, z] of VISIT_SPOTS) {
  const desk = poiIndex.get(deskId)!;
  const position = { x, z };
  const visit: PointOfInterest = {
    id: `visit-${deskId}`,
    type: 'visit',
    zoneId: desk.zoneId,
    position,
    facing: yawTowards(position, desk.position),
    approach: position,
    seated: false,
    capacity: 1,
    hostDeskId: deskId
  };
  pois.push(visit);
  poiIndex.set(visit.id, visit);
}

export function poiById(id: string): PointOfInterest {
  const poi = poiIndex.get(id);
  if (!poi) throw new Error(`Unknown point of interest: ${id}`);
  return poi;
}

export const HOME_DESKS: Readonly<Record<string, string>> = {
  'research-analyst': 'desk-analyst',
  writer: 'desk-writer',
  designer: 'desk-designer',
  'product-coach': 'desk-product',
  'knowledge-librarian': 'desk-librarian',
  'files-agent': 'desk-files',
  'marketing-strategist': 'desk-marketing',
  'ops-coordinator': 'desk-ops'
};

export type DeskEquipment = 'laptop' | 'laptop-monitor' | 'monitor';
export type DeskProp = 'mug' | 'notebook' | 'lamp' | 'plant' | 'folder' | 'books' | 'tablet' | 'pen-cup';

export interface DeskSetup {
  poiId: string;
  equipment: DeskEquipment;
  props: DeskProp[];
}

/** What sits on each desk. Varied on purpose so the pods look lived in. */
export const DESK_SETUPS: readonly DeskSetup[] = [
  ...SPECIALIST_DESKS.map((poiId, index): DeskSetup => ({
    poiId,
    equipment: 'laptop-monitor',
    props: index % 2 ? ['mug', 'notebook'] : ['plant', 'pen-cup']
  })),
  { poiId: 'desk-analyst', equipment: 'laptop-monitor', props: ['mug', 'notebook'] },
  { poiId: 'desk-pod-a-ne', equipment: 'monitor', props: ['notebook'] },
  { poiId: 'desk-pod-a-sw', equipment: 'laptop', props: ['books'] },
  { poiId: 'desk-writer', equipment: 'laptop', props: ['notebook', 'pen-cup', 'mug'] },
  { poiId: 'desk-pod-b-nw', equipment: 'monitor', props: ['plant'] },
  { poiId: 'desk-ops', equipment: 'laptop-monitor', props: ['folder', 'mug'] },
  { poiId: 'desk-designer', equipment: 'laptop-monitor', props: ['tablet', 'plant'] },
  { poiId: 'desk-pod-b-se', equipment: 'laptop', props: ['mug'] },
  { poiId: 'desk-marketing', equipment: 'laptop', props: ['lamp', 'notebook', 'mug'] },
  { poiId: 'desk-product', equipment: 'laptop', props: ['notebook'] },
  { poiId: 'desk-librarian', equipment: 'laptop-monitor', props: ['books', 'lamp'] },
  { poiId: 'desk-files', equipment: 'laptop-monitor', props: ['folder', 'pen-cup'] }
];

/** Label anchors and camera focus points for each department. */
export const ZONE_ANCHORS: Readonly<Record<ZoneId, Vec2>> = {
  chat: { x: -9.9, z: -6.6 },
  workspaces: { x: -2.0, z: -6.3 },
  knowledge: { x: 5.0, z: -6.4 },
  files: { x: 10.7, z: -5.2 },
  agents: { x: -18.5, z: -0.5 },
  cafe: { x: 10.2, z: 4.8 }
};
