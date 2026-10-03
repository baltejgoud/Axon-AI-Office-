import { roomName, type MeetingRoomId } from '../../../../../shared/rooms';
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
  'chief-of-staff': 'desk-chief',
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

/** Click targets over the Files room's cabinet wall and the Library's shelves. */
export const FILES_HOTSPOT = { x: 15.8, z: -14.6, w: 6.8, d: 0.8, h: 2.4 } as const;
export const LIBRARY_HOTSPOT = { x: 6.65, z: -14.65, w: 10, d: 0.8, h: 2.6 } as const;

/** Where coffee is picked up at the café bar. */
export const CAFE_PICKUPS = ['cafe-machine', 'cafe-counter-1', 'cafe-counter-2'] as const;

/** A glass wall along z with a 1.6 m door centred on `door`. */
function glassFront(b: LayoutBuilder, id: string, fromX: number, toX: number, door: number): void {
  b.wall(`${id}-s1`, 'glass', fromX, ROOM_FRONT_Z, door - 0.8, ROOM_FRONT_Z);
  b.wall(`${id}-s2`, 'glass', door + 0.8, ROOM_FRONT_Z, toX, ROOM_FRONT_Z);
}

/**
 * The Commons, 40 x 32 m at the centre of the campus. Along the back wall: the Lounge, meeting
 * Rooms 1 and 2, the Library and the Files room. In the middle: the boardroom with Rooms 3 and 4
 * in front of it, the core team's pods and the café. At the front: the lobby and reception.
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
  buildBoardroom(b);
  buildFrontRooms(b);
  buildPods(b);
  buildCafe(b);
  buildLobby(b);
  setUpDesks(b);
}

/**
 * The Lounge: a media wall on the back wall (a TV over a console with a PS5), three sofas in a U
 * open toward it round a coffee table, two bean bags in front of the screen for whoever is playing,
 * the office dog asleep in the corner, and the Marketing Strategist's desk. The TV faces the viewer,
 * so the game on it shows from the camera.
 */
function buildLounge(b: LayoutBuilder): void {
  b.rug('rug-lounge', -15.4, -10.6, 6.8, 6.0);
  b.item('media-console', 'media-console', -15.6, -14.55, 1.8, 0.45);
  b.item('sofa', 'sofa', -15.6, -7.7, 3.3, 0.95, { rotation: FACE_BACK });
  b.item('sofa-left', 'sofa', -18.7, -11.0, 3.0, 0.95, { rotation: FACE_RIGHT });
  b.item('sofa-right', 'sofa', -12.4, -11.0, 3.0, 0.95, { rotation: FACE_LEFT });
  b.item('lounge-table', 'coffee-table', -15.6, -10.6, 0.9, 0.9, { round: true });
  b.item('lounge-lamp-1', 'floor-lamp', -19.0, -14.55, 0.35, 0.35, { round: true });
  b.item('lounge-lamp-2', 'floor-lamp', -13.45, -14.55, 0.35, 0.35, { round: true });
  b.item('lounge-dog', 'dog-bed', -18.0, -13.95, 0.8, 0.8, { round: true });
  b.plant('plant-lounge', -11.6, -6.6);
  b.item('board-lounge', 'whiteboard', -12.9, -6.4, 1.6, 0.1);
  b.item('desk-marketing-surface', 'desk', -12.1, -14.5, 1.4, 0.7);
  b.deskSeat('desk-marketing', 'chat', -12.1, -13.8, FACE_BACK);

  // The main sofa faces the TV across the room; the side sofas face each other.
  for (const [index, x] of [-14.5, -15.6, -16.7].entries())
    b.seat(`lounge-sofa-${index + 1}`, 'lounge', 'chat', x, -8.35, FACE_BACK, { x, z: -8.95 }, null);
  for (const [index, z] of [-11.6, -10.4].entries()) {
    b.seat(`lounge-sofa-${index + 4}`, 'lounge', 'chat', -18.05, z, FACE_RIGHT, { x: -17.45, z }, null);
    b.seat(`lounge-sofa-${index + 6}`, 'lounge', 'chat', -13.05, z, FACE_LEFT, { x: -13.65, z }, null);
  }
  // Two bean bags in front of the screen: the players' seats.
  for (const [index, x] of [-16.3, -14.9].entries()) {
    b.item(`lounge-bag-${index + 1}`, 'bean-bag', x, -12.95, 0.9, 0.9, { round: true });
    b.seat(`game-seat-${index + 1}`, 'game-seat', 'chat', x, -12.95, FACE_BACK, { x, z: -12.15 }, null);
  }
}

export type { MeetingRoomId };

export interface MeetingRoom {
  id: MeetingRoomId;
  name: string;
  /** Its chairs in the order a team fills them, the lead's first. */
  seats: readonly string[];
  /** The board that shows its team's goal and progress. */
  boardItemId: string;
  /** Where the camera looks to show it. */
  focus: Vec2;
}

/** A six-seat room's chairs: three a side of the table, nearest the viewer's middle first. */
const sixSeats = (id: string): string[] => [`${id}-n2`, `${id}-s2`, `${id}-n1`, `${id}-s1`, `${id}-n3`, `${id}-s3`];

/** Rooms 3 and 4: in front of the boardroom, sharing its front glass as their back wall. */
const FRONT_ROOMS = { back: 4.2, front: 8.8, table: 6.5, xs: [-16.2, -10.2] } as const;

/**
 * A glass room for six: three chairs a side of a table, a screen on the back wall and a whiteboard,
 * its door in the middle of the front glass.
 */
function buildSixSeater(
  b: LayoutBuilder,
  id: string,
  room: MeetingRoomId,
  x: number,
  table: number,
  ids: { table: string; screen: string; board: string; screenZ: number; boardAt: [number, number, number] }
): void {
  b.rug(`rug-${id}`, x, table, 4.6, 3.8);
  b.item(ids.table, 'meeting-table', x, table, 2.6, 1.2);
  b.item(ids.screen, 'wall-screen', x, ids.screenZ, 2.0, 0.05, { blocks: false });
  const [bx, bz, rotation] = ids.boardAt;
  b.item(ids.board, 'whiteboard', bx, bz, 1.4, 0.1, { rotation });
  for (const [index, offset] of [-0.8, 0, 0.8].entries()) {
    const n = index + 1;
    const cx = x + offset;
    b.seat(`${id}-n${n}`, 'meeting', 'workspaces', cx, table - 1.05, FACE_FRONT, { x: cx, z: table - 1.65 }, 'meeting-chair', room);
    b.seat(`${id}-s${n}`, 'meeting', 'workspaces', cx, table + 1.05, FACE_BACK, { x: cx, z: table + 1.65 }, 'meeting-chair', room);
  }
}

/** Rooms 1 and 2, along the back wall between the Lounge and the Library. */
function buildPlanning(b: LayoutBuilder): void {
  buildSixSeater(b, 'room-1', 'room-1', -7.8, -10.9, {
    table: 'meeting-table',
    screen: 'meeting-screen',
    board: 'meeting-whiteboard',
    screenZ: -14.88,
    boardAt: [-9.9, -14.45, 0]
  });
  b.plant('plant-meeting', -5.1, -14.45, true);
  b.spot('meeting-wb', 'whiteboard', 'workspaces', -9.9, -13.85, FACE_BACK);

  buildSixSeater(b, 'room-2', 'room-2', -1.6, -10.9, {
    table: 'planning-table',
    screen: 'planning-screen',
    board: 'planning-whiteboard',
    screenZ: -14.88,
    boardAt: [0.4, -14.45, 0]
  });
  b.plant('plant-planning', -4.1, -14.45);
}

/**
 * Rooms 3 and 4, in the open floor between the boardroom and the lobby: glass on three sides, the
 * boardroom's glass behind, doors toward the lobby, each whiteboard on its west wall facing in.
 */
function buildFrontRooms(b: LayoutBuilder): void {
  const { back, front, table, xs } = FRONT_ROOMS;
  const walls = [BOARDROOM.west, (BOARDROOM.west + BOARDROOM.east) / 2, BOARDROOM.east];
  for (const [index, x] of walls.entries()) b.wall(`glass-front-rooms-${index}`, 'glass', x, back, x, front);
  for (const [index, cx] of xs.entries()) {
    const n = index + 3;
    const [west, east] = [walls[index], walls[index + 1]];
    b.wall(`glass-room-${n}-s1`, 'glass', west, front, cx - 0.8, front);
    b.wall(`glass-room-${n}-s2`, 'glass', cx + 0.8, front, east, front);
    buildSixSeater(b, `room-${n}`, `room-${n}` as MeetingRoomId, cx, table, {
      table: `room-${n}-table`,
      screen: `room-${n}-screen`,
      board: `room-${n}-whiteboard`,
      screenZ: back + 0.06,
      boardAt: [west + 0.15, table, FACE_RIGHT]
    });
    b.plant(`plant-room-${n}`, east - 0.4, back + 0.4);
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

/** The boardroom's walls: x from its west wall to its door wall, z from its back wall to its front. */
const BOARDROOM = { west: -19.2, east: -7.2, back: -4.0, front: 4.2, door: 0.1 } as const;
/** Along the boardroom table: six chairs a side, nearest the head first. */
const BOARDROOM_XS = [-15.9, -14.7, -13.5, -12.3, -11.1, -9.9];

/** The boardroom's chairs as a team fills them: the lead's at the head, then both sides from the head down. */
export const BOARDROOM_SEATS: readonly string[] = [
  'boardroom-head',
  ...BOARDROOM_XS.flatMap((_, i) => [`boardroom-n${i + 1}`, `boardroom-s${i + 1}`])
];

/** Every meeting room, the boardroom first: twelve and the lead there, six in each of the others. */
export const MEETING_ROOMS: readonly MeetingRoom[] = (
  [
    { id: 'boardroom', seats: BOARDROOM_SEATS, boardItemId: 'boardroom-whiteboard', focus: { x: -13.2, z: 0.1 } },
    { id: 'room-1', seats: sixSeats('room-1'), boardItemId: 'meeting-whiteboard', focus: { x: -7.8, z: -10.5 } },
    { id: 'room-2', seats: sixSeats('room-2'), boardItemId: 'planning-whiteboard', focus: { x: -1.6, z: -10.5 } },
    { id: 'room-3', seats: sixSeats('room-3'), boardItemId: 'room-3-whiteboard', focus: { x: -16.2, z: 6.5 } },
    { id: 'room-4', seats: sixSeats('room-4'), boardItemId: 'room-4-whiteboard', focus: { x: -10.2, z: 6.5 } }
  ] as const
).map((room) => ({ ...room, name: roomName(room.id) }));

export const meetingRoom = (id: MeetingRoomId): MeetingRoom =>
  MEETING_ROOMS.find((room) => room.id === id) ?? MEETING_ROOMS[0];

/**
 * The boardroom, where the Chief of Staff gathers a team: a glass room with one long table for twelve
 * and the lead's chair at its head, the plan on the screen on its back wall, and a whiteboard. When no
 * team is meeting, the office's own meetings use it too.
 */
function buildBoardroom(b: LayoutBuilder): void {
  const { west, east, back, front, door } = BOARDROOM;
  b.wall('glass-boardroom-n', 'glass', west, back, east, back);
  b.wall('glass-boardroom-s', 'glass', west, front, east, front);
  b.wall('glass-boardroom-w', 'glass', west, back, west, front);
  b.wall('glass-boardroom-e1', 'glass', east, back, east, door - 0.8);
  b.wall('glass-boardroom-e2', 'glass', east, door + 0.8, east, front);
  b.rug('rug-boardroom', -13.0, door, 11.2, 7.4);
  b.item('boardroom-table', 'meeting-table', -13.0, door, 7.2, 1.6);
  b.item('boardroom-screen', 'wall-screen', -13.0, back + 0.05, 3.0, 0.05, { blocks: false });
  b.item('boardroom-whiteboard', 'whiteboard', -9.0, back + 0.15, 1.6, 0.1);
  b.spot('boardroom-wb', 'whiteboard', 'workspaces', -9.0, back + 0.75, FACE_BACK);
  b.plant('plant-boardroom-1', west + 0.4, back + 0.4, true);
  b.plant('plant-boardroom-2', west + 0.4, front - 0.4);
  b.seat('boardroom-head', 'meeting', 'workspaces', -17.15, door, FACE_RIGHT, { x: -17.8, z: door }, 'meeting-chair', 'boardroom');
  for (const [index, x] of BOARDROOM_XS.entries()) {
    const n = index + 1;
    b.seat(`boardroom-n${n}`, 'meeting', 'workspaces', x, door - 1.05, FACE_FRONT, { x, z: door - 1.65 }, 'meeting-chair', 'boardroom');
    b.seat(`boardroom-s${n}`, 'meeting', 'workspaces', x, door + 1.05, FACE_BACK, { x, z: door + 1.65 }, 'meeting-chair', 'boardroom');
  }
}

/** The core team's two pods of four. */
function buildPods(b: LayoutBuilder): void {
  b.rug('rug-pods', -0.6, -0.3, 10.4, 5.0);
  const pods = [
    { id: 'pod-a', x: -3.2, seats: ['desk-analyst', 'desk-product', 'desk-pod-a-sw', 'desk-chief'] },
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
  b.visit('desk-product', -1.5, -2.05);
  b.visit('desk-chief', -3.2, 1.45);
  b.visit('desk-designer', 2.0, 1.45);
  b.visit('desk-ops', 2.0, -2.05);
}

/** The coffee bar: its counter keeps the old front line, with the barista's strip behind it. */
export const COFFEE_BAR = { x: 14.0, z: -3.875, w: 4.6, d: 1.2 } as const;
/** The open kitchen at the café's east end, from the bar to the Commons' edge. */
export const KITCHEN = { x: 18.06, z: -1.75, w: 3.48, d: 4.4 } as const;

/**
 * A coffee bar with the bakery counter at its west end, the open kitchen at the east end, an island
 * with stools, six small tables and a long communal table. Behind the bar the walkway to the Files
 * room stays open; the barista's strip and the kitchen are furniture as far as walking goes, so
 * nobody wanders in where the staff work.
 */
function buildCafe(b: LayoutBuilder): void {
  b.item('cafe-counter', 'coffee-bar', COFFEE_BAR.x, COFFEE_BAR.z, COFFEE_BAR.w, COFFEE_BAR.d, {
    busyWith: [...CAFE_PICKUPS]
  });
  b.item('bakery-counter', 'bakery-counter', 10.85, -3.6, 1.5, 0.65);
  b.item('open-kitchen', 'open-kitchen', KITCHEN.x, KITCHEN.z, KITCHEN.w, KITCHEN.d);
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
  b.item('cafe-communal', 'meeting-table', 18.3, 3.6, 4.4, 1.0, { rotation: HALF_PI });
  for (const [index, z] of [2.2, 3.2, 4.2, 5.2].entries())
    b.seat(`cafe-c${index + 1}`, 'cafe-seat', 'cafe', 17.5, z, FACE_RIGHT, { x: 16.85, z }, 'cafe-chair');
  b.plant('plant-cafe-1', 8.2, -3.6, true);
  b.plant('plant-cafe-2', 19.3, 6.9);
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
    // The west corner sits further forward, leaving an aisle in front of Rooms 3 and 4.
    const z = side < 0 ? 12.2 : 11.0;
    b.rug(`rug-waiting-${key}`, x, z, 4.2, 2.6);
    b.item(`waiting-chair-${key}-1`, 'armchair', x - 1.2, z, 0.85, 0.85, { rotation: FACE_RIGHT });
    b.item(`waiting-chair-${key}-2`, 'armchair', x + 1.2, z, 0.85, 0.85, { rotation: FACE_LEFT });
    b.item(`waiting-table-${key}`, 'coffee-table', x, z, 0.9, 0.9, { round: true });
    b.item(`lobby-tree-${key}`, 'tree', side * 17.5, side < 0 ? 12.4 : 9.0, 1.0, 1.0, { round: true });
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

  // What sits on each desk. Varied on purpose so the pods look lived in.
  const setups = [
    {
      poiId: 'desk-analyst',
      equipment: 'laptop-monitor',
      props: ['mug', 'notebook'],
      flavor: 'data',
      accent: '#2563eb'
    },
    {
      poiId: 'desk-product',
      equipment: 'laptop-monitor',
      props: ['notebook', 'sticky-notes'],
      flavor: 'document',
      accent: '#f97316'
    },
    { poiId: 'desk-pod-a-sw', equipment: 'laptop', props: ['books'] },
    {
      poiId: 'desk-chief',
      equipment: 'laptop-monitor',
      props: ['folder', 'notebook', 'mug'],
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
