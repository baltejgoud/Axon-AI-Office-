import type { Vec2 } from '../simulation/types';
import type { LayoutBuilder } from './builder';
import type { DistrictId } from './districts';

export interface CoffeeStation {
  id: string;
  district: DistrictId;
  x: number;
  z: number;
  /** Yaw of the counter's front. People stand on that side to pick up a cup. */
  rotation: number;
}

/**
 * A small coffee counter in every district, so a break never means a hike to the café. Each stands
 * at the edge of its district, in the open floor or corridor beside it. Engineering, 62 m deep,
 * has one at each end.
 */
export const COFFEE_STATIONS: readonly CoffeeStation[] = [
  { id: 'coffee-engineering-north', district: 'engineering', x: -42.5, z: -37.2, rotation: 0 },
  { id: 'coffee-engineering-south', district: 'engineering', x: -42.5, z: 37.2, rotation: Math.PI },
  { id: 'coffee-product', district: 'product', x: -19.3, z: -27, rotation: Math.PI / 2 },
  { id: 'coffee-business', district: 'business', x: -19.3, z: 27.5, rotation: Math.PI / 2 },
  { id: 'coffee-design', district: 'design', x: 30, z: -14.6, rotation: Math.PI },
  { id: 'coffee-leadership', district: 'leadership', x: 50, z: -14.6, rotation: Math.PI },
  { id: 'coffee-ai-data', district: 'ai-data', x: 36, z: 11.0, rotation: Math.PI },
  { id: 'coffee-people-ops', district: 'people-ops', x: 48, z: 13.0, rotation: 0 }
];

/** Spot ids of a station: two pickups at the counter, then two places to stand and chat. */
export function stationSpots(id: string): [pickup1: string, pickup2: string, stand1: string, stand2: string] {
  return [`${id}-pickup-1`, `${id}-pickup-2`, `${id}-stand-1`, `${id}-stand-2`];
}

/**
 * Where someone working at `from` goes for coffee: the café, or the closest station in their own
 * district, whichever is nearer in a straight line. Districts are open floor, so that matches the walk.
 */
export function nearestCoffee(from: Vec2, cafe: Vec2, district?: DistrictId): string {
  let best = 'cafe';
  let bestDistance = Math.hypot(cafe.x - from.x, cafe.z - from.z);
  for (const station of COFFEE_STATIONS) {
    if (district && station.district !== district) continue;
    const distance = Math.hypot(station.x - from.x, station.z - from.z);
    if (distance < bestDistance) {
      best = station.id;
      bestDistance = distance;
    }
  }
  return best;
}

/** A station's counter and its four spots, turned to face its district. */
export function buildCoffeeStations(b: LayoutBuilder): void {
  for (const station of COFFEE_STATIONS) {
    const { id, district, x, z, rotation } = station;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    // Counter-local (lx along the counter, lz out of its front) to floor coordinates.
    const at = (lx: number, lz: number) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });
    const [pickup1, pickup2, stand1, stand2] = stationSpots(id);
    b.item(id, 'coffee-station', x, z, 1.6, 0.6, { rotation, busyWith: [pickup1, pickup2] });
    const tags = { district };
    const spot = (spotId: string, type: 'cafe' | 'cafe-stand', lx: number, lz: number, facing: number) => {
      const p = at(lx, lz);
      b.spot(spotId, type, 'cafe', p.x, p.z, rotation + facing, tags);
    };
    spot(pickup1, 'cafe', -0.45, 0.9, Math.PI);
    spot(pickup2, 'cafe', 0.45, 0.9, Math.PI);
    spot(stand1, 'cafe-stand', -0.4, 1.8, Math.PI / 2);
    spot(stand2, 'cafe-stand', 0.4, 1.8, -Math.PI / 2);
  }
}
