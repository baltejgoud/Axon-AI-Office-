import { LayoutBuilder, type DeskSetup, type FurnitureItem, type Wall } from '../campus/builder';
import { COMMONS_ROOMS, CORE_HOME_DESKS, buildCommons } from '../campus/commons';
import { DISTRICTS, boundsCentre, type Bounds, type DistrictId } from '../campus/districts';
import { buildDistricts } from '../campus/neighbourhoods';
import { OFFICE_AGENTS } from '../data/officeAgents';
import type { PointOfInterest, Vec2, ZoneId } from './types';

export type {
  DeskEquipment,
  DeskProp,
  DeskSetup,
  FurnitureItem,
  FurnitureKind,
  Wall,
  WallKind
} from '../campus/builder';

/**
 * The campus floor plan. The renderer builds furniture from this data and the pathfinder derives its
 * obstacles from the same data, so what people walk around is exactly what is drawn.
 * Units are metres; x runs along the back wall (left to right), z runs toward the viewer.
 */
export const ROOM = { minX: -62, maxX: 62, minZ: -38, maxZ: 38 } as const;
export const WALL_THICKNESS = 0.16;

const builder = new LayoutBuilder();
builder.wall('wall-back', 'solid', ROOM.minX, ROOM.minZ, ROOM.maxX, ROOM.minZ);
builder.wall('wall-left', 'solid', ROOM.minX, ROOM.minZ, ROOM.minX, ROOM.maxZ);
// The two walls nearest the viewer are cut low, dollhouse style, so nothing hides behind them.
builder.wall('wall-right', 'low', ROOM.maxX, ROOM.minZ, ROOM.maxX, ROOM.maxZ);
builder.wall('wall-front', 'low', ROOM.minX, ROOM.maxZ, ROOM.maxX, ROOM.maxZ);
buildCommons(builder);

// Specialists sit with their department, in catalog order.
const members: Record<string, string[]> = {};
for (const agent of OFFICE_AGENTS)
  if (agent.district !== 'commons') (members[agent.department] ??= []).push(agent.id);
const specialistDesks = buildDistricts(builder, members);
// Trees along the main corridors: landmarks that make the long walks pleasant.
const CORRIDOR_TREES: [number, number][] = [
  ...[-29, -20, -4, 4, 20, 29].flatMap((z): [number, number][] => [
    [-22.5, z],
    [22.5, z]
  ]),
  [31.5, -15],
  [44, -15],
  [55, -15],
  [31, 12],
  [42.5, 12],
  [54, 12]
];
for (const [x, z] of CORRIDOR_TREES)
  builder.item(`corridor-tree-${x}-${z}`, 'tree', x, z, 1.0, 1.0, { round: true });
const built = builder.finish();

export const WALLS: readonly Wall[] = builder.walls;
export const FURNITURE: readonly FurnitureItem[] = built.furniture;
export const POINTS_OF_INTEREST: readonly PointOfInterest[] = built.pois;
export const DESK_SETUPS: readonly DeskSetup[] = builder.setups;

const poiIndex = new Map(built.pois.map((poi) => [poi.id, poi]));

export function poiById(id: string): PointOfInterest {
  const poi = poiIndex.get(id);
  if (!poi) throw new Error(`Unknown point of interest: ${id}`);
  return poi;
}

/** Every coworker's own desk. */
export const HOME_DESKS: Readonly<Record<string, string>> = { ...CORE_HOME_DESKS, ...specialistDesks };

/** Label anchors and camera focus points for the Commons rooms. */
export const ZONE_ANCHORS: Readonly<Record<ZoneId, Vec2>> = COMMONS_ROOMS;

/** Where each district's card floats and where the camera frames it. */
export const DISTRICT_ANCHORS = Object.fromEntries(
  DISTRICTS.map((district) => [
    district.id,
    district.id === 'commons' ? { x: 0, z: 1 } : boundsCentre(district.bounds)
  ])
) as Readonly<Record<DistrictId, Vec2>>;

/** Where each department's label floats, and the floor it occupies. */
export const DEPARTMENT_ANCHORS: Readonly<Record<string, Vec2>> = Object.fromEntries(
  builder.departments.map((area) => [area.name, area.anchor])
);
export const DEPARTMENT_BOUNDS: Readonly<Record<string, Bounds>> = Object.fromEntries(
  builder.departments.map((area) => [area.name, area.bounds])
);
