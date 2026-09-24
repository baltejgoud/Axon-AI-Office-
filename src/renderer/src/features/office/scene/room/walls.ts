import type { Bounds } from '../../campus/districts';
import { WALL_THICKNESS, type Wall } from '../../simulation/layout';

/** Drawn thickness of the walls round the edge of the campus: a solid diorama rim. */
export const PERIMETER_THICKNESS = 0.3;

/** Which side of the campus a wall runs along, if it runs along one: its outward normal. */
function perimeterNormal(wall: Wall, room: Bounds): { x: number; z: number } | null {
  const { from, to } = wall;
  if (from.x === to.x && from.x === room.minX) return { x: -1, z: 0 };
  if (from.x === to.x && from.x === room.maxX) return { x: 1, z: 0 };
  if (from.z === to.z && from.z === room.minZ) return { x: 0, z: -1 };
  if (from.z === to.z && from.z === room.maxZ) return { x: 0, z: 1 };
  return null;
}

/**
 * How thick a wall is drawn and how far its centre moves out of the campus. Perimeter walls grow
 * outward only, so their inner face (what people walk beside) stays where navigation expects it.
 */
export function wallSlab(wall: Wall, room: Bounds): { thickness: number; offset: number } {
  if (!perimeterNormal(wall, room)) return { thickness: WALL_THICKNESS, offset: 0 };
  return { thickness: PERIMETER_THICKNESS, offset: (PERIMETER_THICKNESS - WALL_THICKNESS) / 2 };
}

/** The outward direction of a perimeter wall (zero for walls inside the campus). */
export function wallOutward(wall: Wall, room: Bounds): { x: number; z: number } {
  return perimeterNormal(wall, room) ?? { x: 0, z: 0 };
}
