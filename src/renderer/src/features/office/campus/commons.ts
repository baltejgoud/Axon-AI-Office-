import type { Vec2, ZoneId } from '../simulation/types';
import type { LayoutBuilder } from './builder';

const HALF_PI = Math.PI / 2;
const FACE_FRONT = 0; // +z, toward the viewer
const FACE_BACK = Math.PI; // -z, toward the back wall
const FACE_RIGHT = HALF_PI; // +x
const FACE_LEFT = -HALF_PI; // -x

/** The Commons' back wall, which the rooms along the back share. */
export const COMMONS_BACK_Z = -15;
/** Where the back rooms end: glass fronts with doors. */
const ROOM_FRONT_Z = -6;

/** The core team's home desks. The receptionist greets people at the front desk. */
export const CORE_HOME_DESKS: Readonly<Record<string, string>> = {
  receptionist: 'desk-reception',
  'research-analyst': 'desk-analyst',
  writer: 'desk-writer',
  designer: 'desk-designer',
  'product-coach': 'desk-product',
  'knowledge-librarian': 'desk-librarian',
  'files-agent': 'desk-files',
  'marketing-strategist': 'desk-marketing',
  'ops-coordinator': 'desk-ops'
};

/** Camera focus points for the Commons rooms. */
export const COMMONS_ROOMS: Readonly<Record<ZoneId, Vec2>> = {
  chat: { x: -15.4, z: -10.5 },
  workspaces: { x: -4.6, z: -10.5 },
  knowledge: { x: 6.8, z: -10.5 },
  files: { x: 15.8, z: -10.5 },
  agents: { x: -0.6, z: -0.3 },
  cafe: { x: 13.6, z: 1.5 },
  reception: { x: 0, z: 13.5 }
};

/** What each room's sign says. */
export const COMMONS_ROOM_NAMES: Readonly<Record<ZoneId, string>> = {
  chat: 'Lounge',
  workspaces: 'Planning',
  knowledge: 'Library',
  files: 'Files room',
  agents: 'Core team',
  cafe: 'Café',
  reception: 'Reception'
};

/** Where each room's sign hangs: the bottom centre of the panel, just outside its door. */
export const ROOM_SIGN_POINTS: Readonly<
  Record<Exclude<ZoneId, 'agents'>, { x: number; y: number; z: number }>
> = {
  chat: { x: -15.2, y: 2.45, z: -5.7 },
  workspaces: { x: -4.6, y: 2.45, z: -5.7 },
  knowledge: { x: 6.7, y: 2.45, z: -5.7 },
  files: { x: 15.6, y: 2.45, z: -5.7 },
  cafe: { x: 13.8, y: 2.45, z: 0.3 },
  reception: { x: 0, y: 2.45, z: 13.2 }
};

/** Click targets over the Files room's cabinet wall and the Library's shelves. */
export const FILES_HOTSPOT = { x: 15.8, z: -14.6, w: 6.8, d: 0.8, h: 2.4 } as const;
export const LIBRARY_HOTSPOT = { x: 6.65, z: -14.65, w: 10, d: 0.8, h: 2.6 } as const;

const CAFE_PICKUPS = ['cafe-machine', 'cafe-counter-1', 'cafe-counter-2'];

/** A glass wall along z with a 1.6 m door centred on `door`. */
function glassFront(b: LayoutBuilder, id: string, fromX: number, toX: number, door: number): void {
  b.wall(`${id}-s1`, 'glass', fromX, ROOM_FRONT_Z, door - 0.8, ROOM_FRONT_Z);
  b.wall(`${id}-s2`, 'glass', door + 0.8, ROOM_FRONT_Z, toX, ROOM_FRONT_Z);
}

/**
 * The Commons, 40 x 32 m at the centre of the campus. Along the back wall: the Lounge, two
 * Planning rooms, the Library and the Files room. In the middle: the collaboration corner, the core
 * team's pods and the café. At the front: the lobby and reception.
 */
export function buildCommons(b: LayoutBuilder): void {
  // Its back wall carries the rooms' screens, shelves and cabinets, and hides only the corridor behind.
  b.wall('commons-back', 'solid', -19.4, COMMONS_BACK_Z, 19.4, COMMONS_BACK_Z);
  b.wall('glass-lounge-e', 'glass', -11, COMMONS_BACK_Z, -11, ROOM_FRONT_Z);
  glassFront(b, 'glass-plan-a', -11, -4.6, -8);
  b.wall('glass-plan-a-e', 'glass', -4.6, COMMONS_BACK_Z, -4.6, ROOM_FRONT_Z);
  glassFront(b, 'glass-plan-b', -4.6, 1.4, -1.6);
  b.wall('glass-library-w', 'glass', 1.4, COMMONS_BACK_Z, 1.4, ROOM_FRONT_Z);
  glassFront(b, 'glass-library', 1.4, 12.2, 6.7);
  b.wall('glass-files-w', 'glass', 12.2, COMMONS_BACK_Z, 12.2, ROOM_FRONT_Z);
  glassFront(b, 'glass-files', 12.2, 19.4, 15.6);
  b.wall('glass-files-e', 'glass', 19.4, COMMONS_BACK_Z, 19.4, ROOM_FRONT_Z);

  buildLounge(b);
  buildPlanning(b);
  buildLibrary(b);
  buildFilesRoom(b);
  buildCollaboration(b);
  buildPods(b);
  buildCafe(b);
  buildLobby(b);
  setUpDesks(b);
}

/** Three sofas in a U round a coffee table, a bean-bag corner, and the Marketing Strategist's desk. */
function buildLounge(b: LayoutBuilder): void {
  b.rug('rug-lounge', -15.4, -10.6, 6.8, 6.0);
  b.item('sofa', 'sofa', -15.6, -13.9, 3.3, 0.95);
  b.item('sofa-left', 'sofa', -18.7, -10.4, 3.0, 0.95, { rotation: FACE_RIGHT });
  b.item('sofa-right', 'sofa', -12.4, -10.4, 3.0, 0.95, { rotation: FACE_LEFT });
  b.item('lounge-table', 'coffee-table', -15.6, -10.6, 0.9, 0.9, { round: true });
  b.item('lounge-lamp-1', 'floor-lamp', -19.0, -14.55, 0.35, 0.35, { round: true });
  b.item('lounge-lamp-2', 'floor-lamp', -13.45, -14.55, 0.35, 0.35, { round: true });
  b.item('lounge-bag-1', 'bean-bag', -18.5, -7.3, 0.9, 0.9, { round: true });
  b.item('lounge-bag-2', 'bean-bag', -17.3, -7.1, 0.9, 0.9, { round: true });
  b.plant('plant-lounge', -11.6, -6.6);
  b.item('board-lounge', 'whiteboard', -12.9, -6.4, 1.6, 0.1);
  b.item('desk-marketing-surface', 'desk', -12.1, -14.5, 1.4, 0.7);
  b.deskSeat('desk-marketing', 'chat', -12.1, -13.8, FACE_BACK);

  for (const [index, x] of [-16.7, -15.6, -14.5].entries())
    b.seat(`lounge-sofa-${index + 1}`, 'lounge', 'chat', x, -13.25, FACE_FRONT, { x, z: -12.65 }, null);
  for (const [index, z] of [-11.0, -9.8].entries()) {
    b.seat(`lounge-sofa-${index + 4}`, 'lounge', 'chat', -18.05, z, FACE_RIGHT, { x: -17.45, z }, null);
    b.seat(`lounge-sofa-${index + 6}`, 'lounge', 'chat', -13.05, z, FACE_LEFT, { x: -13.65, z }, null);
  }
}

/** Two glass meeting rooms. The Product Coach runs the first from the head of its table. */
function buildPlanning(b: LayoutBuilder): void {
  // Planning A
  b.rug('rug-meeting', -7.8, -10.5, 5.6, 7.0);
  b.item('meeting-table', 'meeting-table', -7.8, -10.9, 2.8, 1.3);
  b.item('meeting-screen', 'wall-screen', -7.6, -14.88, 2.2, 0.05, { blocks: false });
  b.item('meeting-whiteboard', 'whiteboard', -9.9, -14.45, 1.6, 0.1);
  b.plant('plant-meeting', -5.1, -14.45, true);
  for (const [index, x] of [-8.75, -7.8, -6.85].entries()) {
    const n = index + 1;
    b.seat(
      `meeting-n${n}`,
      'meeting',
      'workspaces',
      x,
      -11.95,
      FACE_FRONT,
      { x, z: -12.55 },
      'meeting-chair',
      'meeting-room'
    );
    b.seat(
      `meeting-s${n}`,
      'meeting',
      'workspaces',
      x,
      -9.85,
      FACE_BACK,
      { x, z: -9.25 },
      'meeting-chair',
      'meeting-room'
    );
  }
  b.seat(
    'meeting-w',
    'meeting',
    'workspaces',
    -9.6,
    -10.9,
    FACE_RIGHT,
    { x: -10.25, z: -10.9 },
    'meeting-chair',
    'meeting-room'
  );
  b.deskSeat('desk-product', 'workspaces', -6.0, -10.9, FACE_LEFT, 'meeting-chair');
  b.spot('meeting-wb', 'whiteboard', 'workspaces', -9.9, -13.85, FACE_BACK);

  // Planning B
  b.rug('rug-planning', -1.6, -10.5, 5.2, 7.0);
  b.item('planning-table', 'meeting-table', -1.6, -10.9, 2.6, 1.2);
  b.item('planning-screen', 'wall-screen', -1.8, -14.88, 2.0, 0.05, { blocks: false });
  b.item('planning-whiteboard', 'whiteboard', 0.4, -14.45, 1.0, 0.1);
  b.plant('plant-planning', -4.1, -14.45);
  for (const [index, x] of [-2.4, -1.6, -0.8].entries()) {
    const n = index + 1;
    b.seat(
      `planning-n${n}`,
      'meeting',
      'workspaces',
      x,
      -11.95,
      FACE_FRONT,
      { x, z: -12.55 },
      'meeting-chair',
      'planning-room'
    );
    b.seat(
      `planning-s${n}`,
      'meeting',
      'workspaces',
      x,
      -9.85,
      FACE_BACK,
      { x, z: -9.25 },
      'meeting-chair',
      'planning-room'
    );
  }
}

/** Tall shelves with a ladder, three reading nooks, a quiet table and the Librarian's desk. */
function buildLibrary(b: LayoutBuilder): void {
  b.rug('rug-library', 6.8, -10.4, 9.6, 7.0);
  b.item('library-shelf-1', 'bookshelf-tall', 4.0, -14.65, 4.6, 0.45);
  b.item('library-shelf-2', 'bookshelf-tall', 9.3, -14.65, 4.6, 0.45);
  // Reading nooks along the glass: an armchair and a lamp on a side table.
  for (const [index, z] of [-12.3, -10.2, -8.1].entries()) {
    const id = index ? `library-reading-${index + 1}` : 'library-reading';
    b.seat(id, 'lounge', 'knowledge', 2.1, z, FACE_RIGHT, { x: 2.85, z }, 'armchair');
    b.item(`library-lamp-${index + 1}`, 'side-table', 2.1, z + 1.05, 0.5, 0.5, { round: true });
  }
  b.item('library-table', 'meeting-table', 7.0, -10.4, 2.4, 1.1);
  for (const [index, [x, z, facing]] of (
    [
      [6.4, -11.5, FACE_FRONT],
      [7.6, -11.5, FACE_FRONT],
      [6.4, -9.3, FACE_BACK],
      [7.6, -9.3, FACE_BACK]
    ] as const
  ).entries())
    b.item(`library-chair-${index + 1}`, 'meeting-chair', x, z, 0.54, 0.54, { rotation: facing });
  b.item('desk-librarian-surface', 'desk', 11.5, -10.4, 1.4, 0.7, { rotation: HALF_PI });
  b.deskSeat('desk-librarian', 'knowledge', 10.8, -10.4, FACE_RIGHT);
  b.plant('plant-library', 11.7, -6.55, true);
  b.item('board-library', 'whiteboard', 10.0, -6.55, 1.6, 0.1);
  for (const [index, x] of [3.0, 5.2, 8.2, 10.4].entries())
    b.spot(`shelf-${index + 1}`, 'bookshelf', 'knowledge', x, -13.85, FACE_BACK);
}

/** A wall of cabinets, the printer, a sorting table and the Files Agent's desk. */
function buildFilesRoom(b: LayoutBuilder): void {
  b.rug('rug-files', 15.8, -10.5, 6.4, 6.5);
  b.item('file-cabinets', 'cabinet-wall', FILES_HOTSPOT.x, FILES_HOTSPOT.z, 6.8, 0.6);
  b.spot('file-cabinet', 'files', 'files', 15.8, -13.6, FACE_BACK);
  b.item('printer', 'printer', 12.8, -9.2, 0.95, 0.62, { rotation: FACE_RIGHT, busyWith: ['printer'] });
  b.spot('printer', 'printer', 'files', 13.75, -9.2, FACE_LEFT);
  b.item('sorting-table', 'sorting-table', 15.6, -11.2, 1.6, 0.8);
  b.item('desk-files-surface', 'desk', 18.7, -9.2, 1.4, 0.7, { rotation: HALF_PI });
  b.deskSeat('desk-files', 'files', 18.0, -9.2, FACE_RIGHT);
  b.plant('plant-files', 19.0, -6.6);
  b.item('board-files', 'whiteboard', 13.4, -6.55, 1.4, 0.1);
}

/** A round table and a whiteboard for quick get-togethers. */
function buildCollaboration(b: LayoutBuilder): void {
  b.rug('rug-collab', -15.8, -0.4, 4.6, 4.2);
  b.item('collab-table', 'round-table', -15.8, -0.4, 1.5, 1.5, { round: true });
  b.item('collab-whiteboard', 'whiteboard', -16.4, -3.65, 2.2, 0.1);
  b.item('collab-cabinet', 'low-cabinet', -12.5, 0.0, 0.5, 3.2);
  b.plant('plant-collab-1', -19.0, -3.5, true);
  b.plant('plant-collab-2', -19.0, 2.6);
  const at = (id: string, x: number, z: number, facing: number, approach: Vec2) =>
    b.seat(id, 'meeting', 'workspaces', x, z, facing, approach, 'meeting-chair', 'collab-table');
  at('collab-w', -16.9, -0.4, FACE_RIGHT, { x: -17.55, z: -0.4 });
  at('collab-e', -14.7, -0.4, FACE_LEFT, { x: -14.05, z: -0.4 });
  at('collab-n', -15.8, -1.5, FACE_FRONT, { x: -15.8, z: -2.15 });
  at('collab-s', -15.8, 0.7, FACE_BACK, { x: -15.8, z: 1.35 });
  b.spot('collab-wb-1', 'whiteboard', 'workspaces', -17.0, -3.0, FACE_BACK);
  b.spot('collab-wb-2', 'whiteboard', 'workspaces', -15.8, -3.0, FACE_BACK);
  b.spot('open-window', 'open-area', 'workspaces', -19.0, 1.0, FACE_LEFT);
}

/** The core team's two pods of four. */
function buildPods(b: LayoutBuilder): void {
  b.rug('rug-pods', -0.6, -0.3, 10.4, 5.0);
  const pods = [
    { id: 'pod-a', x: -3.2, seats: ['desk-analyst', 'desk-pod-a-ne', 'desk-pod-a-sw', 'desk-writer'] },
    { id: 'pod-b', x: 2.0, seats: ['desk-pod-b-nw', 'desk-ops', 'desk-designer', 'desk-pod-b-se'] }
  ];
  const z = -0.3;
  for (const pod of pods) {
    b.item(pod.id, 'desk-pod', pod.x, z, 3.2, 1.6);
    const [nw, ne, sw, se] = pod.seats;
    b.deskSeat(nw, 'agents', pod.x - 0.8, z - 1.15, FACE_FRONT);
    b.deskSeat(ne, 'agents', pod.x + 0.8, z - 1.15, FACE_FRONT);
    b.deskSeat(sw, 'agents', pod.x - 0.8, z + 1.15, FACE_BACK);
    b.deskSeat(se, 'agents', pod.x + 0.8, z + 1.15, FACE_BACK);
  }
  // A standing spot beside each core desk, facing its occupant, for coworkers who drop by.
  b.visit('desk-analyst', -3.2, -2.05);
  b.visit('desk-writer', -3.2, 1.45);
  b.visit('desk-designer', 2.0, 1.45);
  b.visit('desk-ops', 2.0, -2.05);
}

/** Counter and pastry case, an island with stools, six small tables and a long communal table. */
function buildCafe(b: LayoutBuilder): void {
  b.item('cafe-counter', 'cafe-counter', 14.0, -3.6, 4.6, 0.65, { busyWith: CAFE_PICKUPS });
  b.item('pastry-case', 'pastry-case', 17.5, -3.6, 1.4, 0.6);
  b.spot('cafe-machine', 'cafe', 'cafe', 15.4, -2.8, FACE_BACK);
  b.spot('cafe-counter-1', 'cafe', 'cafe', 14.1, -2.8, FACE_BACK);
  b.spot('cafe-counter-2', 'cafe', 'cafe', 12.85, -2.8, FACE_BACK);
  b.item('cafe-island', 'cafe-island', 13.8, -1.0, 3.0, 0.8);
  for (const [index, x] of [12.8, 13.8, 14.8].entries())
    b.seat(`cafe-stool-${index + 1}`, 'cafe-seat', 'cafe', x, -0.15, FACE_BACK, { x, z: 0.5 }, 'stool');

  let table = 0;
  for (const z of [2.0, 4.6])
    for (const x of [9.6, 12.4, 15.2]) {
      const id = `cafe-t${++table}`;
      b.item(`cafe-table-${table}`, 'cafe-table', x, z, 0.9, 0.9, { round: true });
      b.item(`cafe-pendant-${table}`, 'pendant-lamp', x, z, 0.3, 0.3, { round: true, blocks: false });
      b.seat(
        `${id}-a`,
        'cafe-seat',
        'cafe',
        x - 0.75,
        z,
        FACE_RIGHT,
        { x: x - 0.75, z: z - 0.75 },
        'cafe-chair'
      );
      b.seat(
        `${id}-b`,
        'cafe-seat',
        'cafe',
        x + 0.75,
        z,
        FACE_LEFT,
        { x: x + 0.75, z: z - 0.75 },
        'cafe-chair'
      );
    }
  b.item('cafe-communal', 'meeting-table', 18.3, 1.8, 4.4, 1.0, { rotation: HALF_PI });
  for (const [index, z] of [0.4, 1.4, 2.4, 3.4].entries())
    b.seat(`cafe-c${index + 1}`, 'cafe-seat', 'cafe', 17.5, z, FACE_RIGHT, { x: 16.85, z }, 'cafe-chair');
  b.plant('plant-cafe-1', 8.2, -3.6, true);
  b.plant('plant-cafe-2', 19.0, 5.6);
  b.spot('open-cafe', 'open-area', 'cafe', 8.4, 6.4, FACE_FRONT);
}

/** The entrance: reception, two waiting corners, benches, bikes and coats. */
function buildLobby(b: LayoutBuilder): void {
  b.rug('rug-reception', 0, 13.4, 8.0, 4.4);
  b.rug('rug-entry', 0, 16.3, 3.6, 1.2);
  b.item('reception-counter', 'reception-desk', 0, 13.2, 3.2, 0.8);
  for (const side of [-1, 1]) {
    const x = side * 10;
    const key = side < 0 ? 'west' : 'east';
    b.rug(`rug-waiting-${key}`, x, 11.0, 4.2, 2.6);
    b.item(`waiting-chair-${key}-1`, 'armchair', x - 1.2, 11.0, 0.85, 0.85, { rotation: FACE_RIGHT });
    b.item(`waiting-chair-${key}-2`, 'armchair', x + 1.2, 11.0, 0.85, 0.85, { rotation: FACE_LEFT });
    b.item(`waiting-table-${key}`, 'coffee-table', x, 11.0, 0.9, 0.9, { round: true });
    b.item(`lobby-tree-${key}`, 'tree', side * 17.5, 9.0, 1.0, 1.0, { round: true });
    b.item(`lobby-planter-${key}`, 'planter', side * 13.2, 16.5, 2.0, 0.5);
  }
  b.deskSeat('desk-reception', 'reception', 0, 12.5, FACE_FRONT);
  b.visit('desk-reception', 0, 14.25);
  // The day's plan, behind the front desk and clear of the Reception sign.
  b.item('board-today', 'whiteboard', 2.4, 11.0, 2.0, 0.1);
  b.plant('plant-reception', -2.6, 13.0, true);
  b.item('coat-rack', 'coat-rack', -3.6, 11.4, 0.5, 0.5, { round: true });
  b.item('lobby-bench-1', 'bench', -7.5, 15.9, 2.2, 0.5);
  b.item('lobby-bench-2', 'bench', 7.5, 15.9, 2.2, 0.5);
  b.item('bike-rack', 'bike-rack', -15.5, 15.6, 2.4, 0.8);
  b.plant('plant-lobby-1', -10.2, 15.9, true);
  b.plant('plant-lobby-2', 10.2, 15.9, true);
  b.spot('open-front', 'open-area', 'agents', -6.5, 9.0, FACE_FRONT);
}

/** Visit spots for the room desks, and what sits on every core desk. */
function setUpDesks(b: LayoutBuilder): void {
  b.visit('desk-librarian', 10.0, -9.45);
  b.visit('desk-marketing', -13.1, -12.9);
  b.visit('desk-files', 17.2, -8.05);
  b.visit('desk-product', -5.4, -9.4);

  // What sits on each desk. Varied on purpose so the pods look lived in.
  const setups = [
    {
      poiId: 'desk-analyst',
      equipment: 'laptop-monitor',
      props: ['mug', 'notebook'],
      flavor: 'data',
      accent: '#2563eb'
    },
    { poiId: 'desk-pod-a-ne', equipment: 'monitor', props: ['notebook'] },
    { poiId: 'desk-pod-a-sw', equipment: 'laptop', props: ['books'] },
    {
      poiId: 'desk-writer',
      equipment: 'laptop',
      props: ['notebook', 'pen-cup', 'mug'],
      flavor: 'document',
      accent: '#8b5cf6'
    },
    { poiId: 'desk-pod-b-nw', equipment: 'monitor', props: ['plant'] },
    {
      poiId: 'desk-ops',
      equipment: 'laptop-monitor',
      props: ['folder', 'mug'],
      flavor: 'data',
      accent: '#64748b'
    },
    {
      poiId: 'desk-designer',
      equipment: 'laptop-monitor',
      props: ['tablet', 'plant'],
      flavor: 'design',
      accent: '#ec4899'
    },
    { poiId: 'desk-pod-b-se', equipment: 'laptop', props: ['mug'] },
    {
      poiId: 'desk-marketing',
      equipment: 'laptop',
      props: ['lamp', 'notebook', 'mug'],
      flavor: 'design',
      accent: '#eab308'
    },
    { poiId: 'desk-product', equipment: 'laptop', props: ['notebook'], flavor: 'document' },
    {
      poiId: 'desk-librarian',
      equipment: 'laptop-monitor',
      props: ['books', 'lamp'],
      flavor: 'document',
      accent: '#0d9488'
    },
    { poiId: 'desk-files', equipment: 'laptop-monitor', props: ['folder', 'pen-cup'], accent: '#10b981' },
    {
      poiId: 'desk-reception',
      equipment: 'monitor',
      props: ['plant', 'notebook'],
      flavor: 'document',
      accent: '#e11d48'
    }
  ] as const;
  for (const setup of setups) b.setup({ ...setup, props: [...setup.props] });
}
