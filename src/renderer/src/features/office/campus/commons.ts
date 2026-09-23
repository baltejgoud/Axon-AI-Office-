import type { LayoutBuilder } from './builder';

const HALF_PI = Math.PI / 2;
const FACE_FRONT = 0; // +z, toward the viewer
const FACE_BACK = Math.PI; // -z, toward the back wall
const FACE_RIGHT = HALF_PI; // +x
const FACE_LEFT = -HALF_PI; // -x

/** The core team's home desks. Ops Coordinator greets people at reception. */
export const CORE_HOME_DESKS: Readonly<Record<string, string>> = {
  'research-analyst': 'desk-analyst',
  writer: 'desk-writer',
  designer: 'desk-designer',
  'product-coach': 'desk-product',
  'knowledge-librarian': 'desk-librarian',
  'files-agent': 'desk-files',
  'marketing-strategist': 'desk-marketing',
  'ops-coordinator': 'desk-reception'
};

/** Label anchors and camera focus points for the Commons rooms. */
export const COMMONS_ROOMS = {
  chat: { x: -9.9, z: -6.6 },
  workspaces: { x: -2.0, z: -6.3 },
  knowledge: { x: 5.0, z: -6.4 },
  files: { x: 10.7, z: -5.2 },
  agents: { x: 0.2, z: 0.7 },
  cafe: { x: 10.2, z: 4.8 }
} as const;

/**
 * The Commons: the original office, kept exactly as it was (its behaviour is covered by the
 * simulation tests), with a reception desk added at the front. It sits at the centre of the campus.
 */
export function buildCommons(b: LayoutBuilder): void {
  // Its back wall carries the rooms' screens, shelves and art, and hides only the corridor behind.
  b.wall('commons-back', 'solid', -13.4, -9, 13.4, -9);
  b.wall('glass-lounge', 'glass', -13, -4.2, -8.6, -4.2);
  b.wall('glass-meeting-w', 'glass', -5.6, -9, -5.6, -3.6);
  b.wall('glass-meeting-s1', 'glass', -5.6, -3.6, -1.0, -3.6);
  b.wall('glass-meeting-s2', 'glass', 0.2, -3.6, 1.6, -3.6);
  b.wall('glass-library-w', 'glass', 1.6, -9, 1.6, -3.6);
  b.wall('glass-library-s1', 'glass', 1.6, -3.6, 3.0, -3.6);
  b.wall('glass-library-s2', 'glass', 5.0, -3.6, 8.4, -3.6);
  b.wall('glass-files-w', 'glass', 8.4, -9, 8.4, -1.6);
  b.wall('glass-files-s1', 'glass', 8.4, -1.6, 10.2, -1.6);
  b.wall('glass-files-s2', 'glass', 11.4, -1.6, 13, -1.6);
  b.wall('glass-files-e', 'glass', 13, -9, 13, -1.6);

  // Lounge (Chat)
  b.rug('rug-lounge', -9.9, -6.5, 5.2, 3.8);
  b.item('sofa', 'sofa', -10.3, -8.4, 3.3, 0.95);
  b.item('lounge-table', 'coffee-table', -10.3, -6.2, 0.9, 0.9, { round: true });
  b.item('lounge-lamp', 'floor-lamp', -12.45, -8.45, 0.35, 0.35, { round: true });
  b.item('desk-marketing-surface', 'desk', -7.0, -8.5, 1.4, 0.7);
  b.plant('plant-lounge-1', -8.2, -8.45, true);
  b.plant('plant-lounge-2', -5.95, -4.6);
  // Meeting room (Workspaces)
  b.rug('rug-meeting', -2.0, -6.4, 5.6, 3.8);
  b.item('meeting-table', 'meeting-table', -2.0, -6.4, 3.8, 1.3);
  b.item('meeting-screen', 'wall-screen', -2.0, -8.88, 2.2, 0.05, { blocks: false });
  b.item('meeting-whiteboard', 'whiteboard', -4.6, -8.45, 1.3, 0.1);
  b.plant('plant-meeting', 1.05, -8.4, true);
  // Library (Knowledge)
  b.rug('rug-library', 5.0, -6.3, 5.6, 4.4);
  b.item('bookshelf', 'bookshelf', 5.2, -8.7, 4.6, 0.45);
  b.item('library-side-table', 'side-table', 2.5, -6.35, 0.5, 0.5, { round: true });
  b.item('desk-librarian-surface', 'desk', 7.8, -5.8, 1.4, 0.7, { rotation: HALF_PI });
  b.plant('plant-library-1', 2.1, -8.45);
  b.plant('plant-library-2', 8.0, -8.45);
  // Files room
  b.item('printer', 'printer', 9.75, -8.5, 0.95, 0.62);
  b.item('desk-files-surface', 'desk', 11.75, -8.5, 1.4, 0.7);
  b.item('file-cabinets', 'file-cabinet', 12.5, -4.6, 0.7, 2.6);
  b.plant('plant-files', 9.0, -2.15);
  // Collaboration corner
  b.rug('rug-collab', -9.8, -0.5, 4.6, 4.2);
  b.item('collab-table', 'round-table', -9.8, -0.5, 1.5, 1.5, { round: true });
  b.item('collab-whiteboard', 'whiteboard', -10.4, -3.75, 2.2, 0.1);
  b.item('collab-cabinet', 'low-cabinet', -6.5, 0.1, 0.5, 3.2);
  b.plant('plant-collab-1', -12.4, -3.55, true);
  b.plant('plant-collab-2', -12.4, 2.6);
  // Desk pods (the core team)
  b.rug('rug-pods', 0.2, 0.7, 10, 4.6);
  b.item('pod-a', 'desk-pod', -2.4, 0.7, 3.2, 1.6);
  b.item('pod-b', 'desk-pod', 2.8, 0.7, 3.2, 1.6);
  // Café
  b.item('cafe-counter', 'cafe-counter', 10.5, 1.95, 4.6, 0.65);
  b.item('cafe-island', 'cafe-island', 10.3, 4.35, 3.0, 0.8);
  b.item('cafe-table-1', 'cafe-table', 8.3, 7.35, 0.9, 0.9, { round: true });
  b.item('cafe-table-2', 'cafe-table', 11.7, 7.35, 0.9, 0.9, { round: true });
  b.plant('plant-cafe-1', 7.1, 1.9, true);
  b.plant('plant-cafe-2', 12.55, 5.9);
  // Entrance and front
  b.rug('rug-entry', -9.5, 7.6, 3.4, 1.6);
  b.item('entry-bench', 'bench', -12.55, 6.2, 0.5, 2.2);
  b.plant('plant-entry-1', -12.4, 4.2, true);
  b.plant('plant-entry-2', -7.2, 8.35);
  b.item('front-credenza', 'credenza', 1.8, 7.25, 5.6, 0.55);
  // Reception, where visitors arrive from the front of the campus.
  b.item('reception-counter', 'reception-desk', -9.5, 10.9, 2.6, 0.75);
  b.plant('plant-reception', -12.0, 10.9, true);

  // Desk pods: pod A (left) and pod B (right), two seats per side.
  b.deskSeat('desk-analyst', 'agents', -3.2, -0.45, FACE_FRONT);
  b.deskSeat('desk-pod-a-ne', 'agents', -1.6, -0.45, FACE_FRONT);
  b.deskSeat('desk-pod-a-sw', 'agents', -3.2, 1.85, FACE_BACK);
  b.deskSeat('desk-writer', 'agents', -1.6, 1.85, FACE_BACK);
  b.deskSeat('desk-pod-b-nw', 'agents', 2.0, -0.45, FACE_FRONT);
  b.deskSeat('desk-ops', 'agents', 3.6, -0.45, FACE_FRONT);
  b.deskSeat('desk-designer', 'agents', 2.0, 1.85, FACE_BACK);
  b.deskSeat('desk-pod-b-se', 'agents', 3.6, 1.85, FACE_BACK);
  // Desks in the rooms.
  b.deskSeat('desk-marketing', 'chat', -7.0, -7.8, FACE_BACK);
  b.deskSeat('desk-librarian', 'knowledge', 7.1, -5.8, FACE_RIGHT);
  b.deskSeat('desk-files', 'files', 11.75, -7.8, FACE_BACK);
  b.deskSeat('desk-product', 'workspaces', 0.3, -6.4, FACE_LEFT, 'meeting-chair');
  b.deskSeat('desk-reception', 'chat', -9.5, 10.2, FACE_FRONT);

  // Meeting room seats around the long table.
  for (const [index, x] of [-3.2, -2.0, -0.8].entries()) {
    b.seat(
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
    b.seat(
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
  b.seat(
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
  b.seat(
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
  b.seat(
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
  b.seat(
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
  b.seat(
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
    b.seat(`lounge-sofa-${index + 1}`, 'lounge', 'chat', x, -7.75, FACE_FRONT, { x, z: -7.15 }, null);
  b.seat('lounge-armchair', 'lounge', 'chat', -12.2, -6.3, FACE_RIGHT, { x: -11.35, z: -6.3 }, 'armchair');
  b.seat('library-reading', 'lounge', 'knowledge', 2.55, -5.3, FACE_RIGHT, { x: 3.3, z: -5.3 }, 'armchair');

  // Café: pick-up spots at the counter, stools at the island, two small tables.
  b.spot('cafe-machine', 'cafe', 'cafe', 11.9, 2.75, FACE_BACK);
  b.spot('cafe-counter-1', 'cafe', 'cafe', 10.6, 2.75, FACE_BACK);
  b.spot('cafe-counter-2', 'cafe', 'cafe', 9.35, 2.75, FACE_BACK);
  for (const [index, x] of [9.3, 10.3, 11.3].entries())
    b.seat(`cafe-stool-${index + 1}`, 'cafe-seat', 'cafe', x, 5.2, FACE_BACK, { x, z: 5.85 }, 'stool');
  b.seat('cafe-t1-a', 'cafe-seat', 'cafe', 7.55, 7.35, FACE_RIGHT, { x: 7.55, z: 6.6 }, 'cafe-chair');
  b.seat('cafe-t1-b', 'cafe-seat', 'cafe', 9.05, 7.35, FACE_LEFT, { x: 9.05, z: 6.6 }, 'cafe-chair');
  b.seat('cafe-t2-a', 'cafe-seat', 'cafe', 10.95, 7.35, FACE_RIGHT, { x: 10.95, z: 6.6 }, 'cafe-chair');
  b.seat('cafe-t2-b', 'cafe-seat', 'cafe', 12.45, 7.35, FACE_LEFT, { x: 12.45, z: 6.6 }, 'cafe-chair');

  // Standing spots.
  b.spot('collab-wb-1', 'whiteboard', 'workspaces', -11.0, -3.1, FACE_BACK);
  b.spot('collab-wb-2', 'whiteboard', 'workspaces', -9.8, -3.1, FACE_BACK);
  b.spot('meeting-wb', 'whiteboard', 'workspaces', -4.6, -7.85, FACE_BACK);
  b.spot('shelf-1', 'bookshelf', 'knowledge', 4.0, -7.95, FACE_BACK);
  b.spot('shelf-2', 'bookshelf', 'knowledge', 6.4, -7.95, FACE_BACK);
  b.spot('printer', 'printer', 'files', 9.75, -7.6, FACE_BACK);
  b.spot('file-cabinet', 'files', 'files', 11.55, -4.6, FACE_RIGHT);
  b.spot('open-window', 'open-area', 'workspaces', -12.2, 1.9, FACE_LEFT);
  b.spot('open-cafe', 'open-area', 'cafe', 6.2, 5.2, Math.PI / 4);
  b.spot('open-front', 'open-area', 'agents', -4.4, 5.4, FACE_FRONT);

  // A standing spot beside each home desk, facing its occupant, for coworkers who drop by.
  for (const [deskId, x, z] of [
    ['desk-analyst', -2.4, -1.05],
    ['desk-writer', -2.4, 2.45],
    ['desk-designer', 2.8, 2.45],
    ['desk-ops', 2.8, -1.05],
    ['desk-librarian', 6.3, -4.85],
    ['desk-marketing', -7.95, -7.2],
    ['desk-files', 10.85, -7.1],
    ['desk-product', 1.0, -5.35],
    ['desk-reception', -9.5, 11.95]
  ] as const)
    b.visit(deskId, x, z);

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
      accent: '#64748b'
    }
  ] as const;
  for (const setup of setups) b.setup({ ...setup, props: [...setup.props] });
}
