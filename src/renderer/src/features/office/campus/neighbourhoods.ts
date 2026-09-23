import { hashString } from '../simulation/random';
import type { DeskProp, LayoutBuilder } from './builder';
import { DISTRICTS, type Bounds, type District } from './districts';
import { boardKind, decorateDepartment } from './decor';

const FACE_FRONT = 0;
const FACE_BACK = Math.PI;

/** Pod pitch: a 3.2 x 1.6 pod plus chairs, with at least 1.6 m of aisle on every side. */
const POD_PITCH_X = 4.8;
const POD_PITCH_Z = 5.2;
/** Space kept along each department's back edge for its whiteboard and label. */
const BACK_STRIP = 2.2;
const EDGE = 0.4;
/** Gap between department cells: the main corridors. */
const CELL_GAP = 2.6;
const PROPS: DeskProp[] = ['mug', 'notebook', 'plant', 'pen-cup', 'books', 'lamp', 'folder', 'tablet'];

export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Pods of four for `count` people in a w x d area: roughly the area's shape, never wider than fits,
 * and with enough columns that the rows (chairs included) fit the depth.
 */
export function podGrid(count: number, w: number, d: number): { cols: number; rows: number } {
  const pods = Math.max(1, Math.ceil(count / 4));
  // The outermost pods need no aisle on their outer side: n columns take 4.8n − 1.6 m.
  const maxCols = Math.max(1, Math.min(pods, Math.floor((w + 1.6) / POD_PITCH_X)));
  const depthOf = (rows: number) => rows * POD_PITCH_Z - 2.34;
  const ideal = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt((pods * w) / d))));
  for (let cols = ideal; cols <= maxCols; cols++) {
    const rows = Math.ceil(pods / cols);
    if (depthOf(rows) <= d) return { cols, rows };
  }
  return { cols: maxCols, rows: Math.ceil(pods / maxCols) };
}

/** Splits a district into its department cells, back row first, with corridors between them. */
export function departmentCells(district: District): Bounds[] {
  const [cols, rows] = district.grid;
  const { minX, maxX, minZ, maxZ } = district.bounds;
  const w = (maxX - minX - (cols - 1) * CELL_GAP) / cols;
  const d = (maxZ - minZ - (rows - 1) * CELL_GAP) / rows;
  return district.departments.map((_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = minX + col * (w + CELL_GAP);
    const z = minZ + row * (d + CELL_GAP);
    return { minX: x, maxX: x + w, minZ: z, maxZ: z + d };
  });
}

function deskProps(seatId: string): DeskProp[] {
  const hash = hashString(seatId);
  const count = 2 + (hash % 2);
  const picked: DeskProp[] = [];
  for (let i = 0; picked.length < count; i++) {
    const prop = PROPS[(hash >>> (i * 3)) % PROPS.length];
    if (!picked.includes(prop)) picked.push(prop);
    if (i > 12) break;
  }
  return picked;
}

/** One department's neighbourhood: a whiteboard corner at the back and pods of four in front. */
function packDepartment(
  b: LayoutBuilder,
  district: District,
  name: string,
  cell: Bounds,
  members: string[],
  index: number
): Record<string, string> {
  const key = slug(name);
  const tags = { district: district.id, department: name };
  const cx = (cell.minX + cell.maxX) / 2;
  b.departments.push({ name, district: district.id, bounds: cell, anchor: { x: cx, z: cell.minZ + 0.35 } });

  b.item(`wb-${key}`, boardKind(district, name), cx, cell.minZ + 0.35, 2.0, 0.1);
  if (name === 'Sales Management') b.item(`gong-${key}`, 'gong', cx + 1.55, cell.minZ + 0.45, 0.8, 0.4);
  if (name === 'Customer Success')
    b.item(`trophies-${key}`, 'trophy-shelf', cx + 1.55, cell.minZ + 0.45, 0.9, 0.35);
  b.spot(`wb-spot-${key}`, 'whiteboard', 'agents', cx, cell.minZ + 1.0, FACE_BACK, tags);
  b.spot(`open-${key}`, 'open-area', 'agents', cell.minX + 1.2, cell.minZ + 1.1, FACE_FRONT, tags);
  b.plant(`plant-${key}-nw`, cell.minX + 0.5, cell.minZ + 0.5, true);
  b.plant(`plant-${key}-ne`, cell.maxX - 0.5, cell.minZ + 0.5, true);
  b.plant(`plant-${key}-se`, cell.maxX - 0.5, cell.maxZ - 0.5);

  const region = {
    minX: cell.minX + EDGE,
    maxX: cell.maxX - EDGE,
    minZ: cell.minZ + BACK_STRIP,
    maxZ: cell.maxZ - EDGE
  };
  const { cols, rows } = podGrid(members.length, region.maxX - region.minX, region.maxZ - region.minZ);
  const centreX = (region.minX + region.maxX) / 2;
  const centreZ = (region.minZ + region.maxZ) / 2;
  b.rug(`rug-${key}`, centreX, centreZ, cols * POD_PITCH_X - 0.4, rows * POD_PITCH_Z - 0.6);

  const homes: Record<string, string> = {};
  let seatIndex = 0;
  const pods = Math.max(1, Math.ceil(members.length / 4));
  for (let pod = 0; pod < pods; pod++) {
    const x = centreX + ((pod % cols) - (cols - 1) / 2) * POD_PITCH_X;
    const z = centreZ + (Math.floor(pod / cols) - (rows - 1) / 2) * POD_PITCH_Z;
    b.item(`pod-${key}-${pod}`, 'desk-pod', x, z, 3.2, 1.6);
    for (const side of [-1, 1])
      for (const offset of [-0.8, 0.8]) {
        const id = `desk-${key}-${seatIndex}`;
        const facing = side < 0 ? FACE_FRONT : FACE_BACK;
        b.deskSeat(id, 'agents', x + offset, z + side * 1.15, facing, 'office-chair', tags);
        b.visit(id, x + offset, z + side * (1.15 + 0.68));
        b.setup({
          poiId: id,
          equipment: district.equipment,
          props: deskProps(id),
          flavor: district.flavor,
          accent: district.color
        });
        const member = members[seatIndex];
        if (member) homes[member] = id;
        seatIndex++;
      }
  }
  decorateDepartment(b, district, key, region, { centreX, centreZ, cols, rows }, index);
  return homes;
}

/** Private glass offices for the executive team: five across, two rows, doors toward the viewer. */
function packLeadership(b: LayoutBuilder, district: District, members: string[]): Record<string, string> {
  const name = district.departments[0];
  const tags = { district: district.id, department: name };
  const { minX, maxX, minZ, maxZ } = district.bounds;
  const [cols, rows] = district.grid;
  const width = (maxX - minX) / cols;
  const depth = 7;
  const rowStarts = [minZ, maxZ - depth];
  b.departments.push({
    name,
    district: district.id,
    bounds: district.bounds,
    anchor: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
  });

  const homes: Record<string, string> = {};
  for (let row = 0; row < rows; row++) {
    const top = rowStarts[row];
    const bottom = top + depth;
    for (let col = 0; col <= cols; col++) {
      const x = minX + col * width;
      b.wall(`exec-side-${row}-${col}`, 'glass', x, top, x, bottom);
    }
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const left = minX + col * width;
      const cx = left + width / 2;
      // The back row backs onto the campus wall: panelled and hung with art. The front row stays glass.
      b.wall(`exec-back-${index}`, row === 0 ? 'solid' : 'glass', left, top, left + width, top);
      b.wall(`exec-front-${index}-a`, 'glass', left, bottom, cx - 0.6, bottom);
      b.wall(`exec-front-${index}-b`, 'glass', cx + 0.6, bottom, left + width, bottom);

      const id = `desk-exec-${index}`;
      b.item(`exec-rug-${index}`, 'exec-rug', cx, top + 3.9, 3.2, 5.4, { blocks: false });
      if (row === 0)
        b.item(`exec-art-${index}`, 'wall-art', cx, top + 0.1, width - 0.1, 0.04, { blocks: false });
      else b.item(`exec-art-${index}`, 'ledge-art', cx, top + 0.12, width - 0.4, 0.12, { blocks: false });
      b.item(`exec-credenza-${index}`, 'exec-credenza', cx, top + 0.4, 1.6, 0.45);
      b.item(`exec-desk-${index}`, 'exec-desk', cx, top + 2.9, 1.8, 0.85);
      b.deskSeat(id, 'agents', cx, top + 2.15, FACE_FRONT, 'exec-chair', tags);
      b.visit(id, cx, top + 3.9);
      // A pair of armchairs across a low table, clear of the walk from the door to the desk.
      b.item(`exec-armchair-${index}-1`, 'armchair', cx + 1.25, top + 4.45, 0.85, 0.85);
      b.item(`exec-armchair-${index}-2`, 'armchair', cx + 1.25, top + 6.15, 0.85, 0.85, {
        rotation: FACE_BACK
      });
      b.item(`exec-table-${index}`, 'coffee-table', cx + 1.25, top + 5.3, 0.6, 0.6, { round: true });
      b.plant(`plant-exec-${index}`, left + 0.45, top + 0.45, true);
      b.setup({
        poiId: id,
        equipment: district.equipment,
        props: deskProps(id),
        flavor: district.flavor,
        accent: district.color
      });
      const member = members[index];
      if (member) homes[member] = id;
    }
  }
  return homes;
}

/**
 * Lays out every district but the Commons. `members` maps a department to its coworkers in catalog
 * order; returns each coworker's home desk.
 */
export function buildDistricts(
  b: LayoutBuilder,
  members: Readonly<Record<string, string[]>>
): Record<string, string> {
  const homes: Record<string, string> = {};
  for (const district of DISTRICTS) {
    if (district.id === 'commons') continue;
    if (district.id === 'leadership') {
      Object.assign(homes, packLeadership(b, district, members[district.departments[0]] ?? []));
      continue;
    }
    const cells = departmentCells(district);
    district.departments.forEach((name, index) =>
      Object.assign(homes, packDepartment(b, district, name, cells[index], members[name] ?? [], index))
    );
  }
  return homes;
}
