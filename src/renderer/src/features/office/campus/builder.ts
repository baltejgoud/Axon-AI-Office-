import { yawTowards, type PointOfInterest, type PoiType, type Vec2, type ZoneId } from '../simulation/types';
import type { ScreenFlavor } from '../scene/room/materials';
import type { Bounds, DistrictId } from './districts';

export type WallKind = 'solid' | 'glass' | 'low';

export interface Wall {
  id: string;
  kind: WallKind;
  from: Vec2;
  to: Vec2;
  height: number;
}

export type FurnitureKind =
  | 'rug'
  | 'desk-pod'
  | 'desk'
  | 'office-chair'
  | 'meeting-chair'
  | 'round-table'
  | 'meeting-table'
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
  | 'low-cabinet'
  | 'reception-desk';

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

export type DeskEquipment = 'laptop' | 'laptop-monitor' | 'monitor';
export type DeskProp = 'mug' | 'notebook' | 'lamp' | 'plant' | 'folder' | 'books' | 'tablet' | 'pen-cup';

export interface DeskSetup {
  poiId: string;
  equipment: DeskEquipment;
  props: DeskProp[];
  flavor?: ScreenFlavor;
  /** Colour of the mug and small accents. */
  accent?: string;
}

export interface DepartmentArea {
  name: string;
  district: DistrictId;
  bounds: Bounds;
  /** Where its label floats and where the camera frames it. */
  anchor: Vec2;
}

export interface PoiTags {
  district?: DistrictId;
  department?: string;
}

const HEIGHTS: Record<WallKind, number> = { solid: 2.7, glass: 2.3, low: 0.32 };

const SEAT_FOOTPRINT: Partial<Record<FurnitureKind, number>> = {
  'office-chair': 0.56,
  'meeting-chair': 0.54,
  armchair: 0.85,
  stool: 0.4,
  'cafe-chair': 0.5
};

/**
 * Collects the office floor plan: walls, furniture, the spots people use and what sits on each
 * desk. The renderer draws exactly this data and the pathfinder derives its obstacles from it.
 */
export class LayoutBuilder {
  readonly walls: Wall[] = [];
  readonly furniture: FurnitureItem[] = [];
  readonly seatFurniture: FurnitureItem[] = [];
  readonly pois: PointOfInterest[] = [];
  readonly setups: DeskSetup[] = [];
  readonly departments: DepartmentArea[] = [];
  /** Standing spots beside home desks, facing the occupant, for coworkers who drop by. */
  private readonly visitSpots: [deskId: string, x: number, z: number][] = [];

  wall(id: string, kind: WallKind, x1: number, z1: number, x2: number, z2: number): void {
    this.walls.push({ id, kind, from: { x: x1, z: z1 }, to: { x: x2, z: z2 }, height: HEIGHTS[kind] });
  }

  item(
    id: string,
    kind: FurnitureKind,
    x: number,
    z: number,
    w: number,
    d: number,
    options: { rotation?: number; round?: boolean; blocks?: boolean } = {}
  ): FurnitureItem {
    const built: FurnitureItem = {
      id,
      kind,
      x,
      z,
      w,
      d,
      rotation: options.rotation ?? 0,
      round: options.round ?? false,
      blocks: options.blocks ?? true
    };
    this.furniture.push(built);
    return built;
  }

  rug(id: string, x: number, z: number, w: number, d: number): void {
    this.item(id, 'rug', x, z, w, d, { blocks: false });
  }

  plant(id: string, x: number, z: number, large = false): void {
    const size = large ? 0.62 : 0.48;
    this.item(id, large ? 'plant-large' : 'plant', x, z, size, size, { round: true });
  }

  seat(
    id: string,
    type: PoiType,
    zoneId: ZoneId,
    x: number,
    z: number,
    facing: number,
    approach: Vec2,
    furniture: FurnitureKind | null,
    group?: PointOfInterest['group'],
    tags: PoiTags = {}
  ): void {
    this.pois.push({
      id,
      type,
      zoneId,
      position: { x, z },
      facing,
      approach,
      seated: true,
      capacity: 1,
      group,
      ...tags
    });
    if (furniture) {
      const size = SEAT_FOOTPRINT[furniture] ?? 0.5;
      this.seatFurniture.push({
        id: `${id}-seat`,
        kind: furniture,
        x,
        z,
        w: size,
        d: size,
        rotation: facing,
        round: false,
        blocks: true
      });
    }
  }

  spot(
    id: string,
    type: PoiType,
    zoneId: ZoneId,
    x: number,
    z: number,
    facing: number,
    tags: PoiTags = {}
  ): void {
    const position = { x, z };
    this.pois.push({
      id,
      type,
      zoneId,
      position,
      facing,
      approach: position,
      seated: false,
      capacity: 1,
      ...tags
    });
  }

  /** Seats at a desk: the chair sits 0.35 m from the desk edge, approached from behind. */
  deskSeat(
    id: string,
    zoneId: ZoneId,
    x: number,
    z: number,
    facing: number,
    chair: FurnitureKind = 'office-chair',
    tags: PoiTags = {}
  ): void {
    const approach = { x: x - Math.sin(facing) * 0.68, z: z - Math.cos(facing) * 0.68 };
    this.seat(id, 'desk', zoneId, x, z, facing, approach, chair, undefined, tags);
  }

  visit(deskId: string, x: number, z: number): void {
    this.visitSpots.push([deskId, x, z]);
  }

  setup(setup: DeskSetup): void {
    this.setups.push(setup);
  }

  /** Resolves visit spots against their desks; call once, after every desk exists. */
  finish(): { furniture: FurnitureItem[]; pois: PointOfInterest[] } {
    const index = new Map(this.pois.map((poi) => [poi.id, poi]));
    for (const [deskId, x, z] of this.visitSpots) {
      const desk = index.get(deskId);
      if (!desk) throw new Error(`Visit spot for unknown desk ${deskId}`);
      const position = { x, z };
      this.pois.push({
        id: `visit-${deskId}`,
        type: 'visit',
        zoneId: desk.zoneId,
        position,
        facing: yawTowards(position, desk.position),
        approach: position,
        seated: false,
        capacity: 1,
        hostDeskId: deskId,
        district: desk.district,
        department: desk.department
      });
    }
    return { furniture: [...this.furniture, ...this.seatFurniture], pois: this.pois };
  }
}
