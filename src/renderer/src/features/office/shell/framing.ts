import { DISTRICTS, boundsCentre, type Bounds, type DistrictId } from '../campus/districts';
import { DEPARTMENT_BOUNDS } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';

/** The order districts appear in the chips and the department menu. */
export const DISTRICT_ORDER: DistrictId[] = [
  'commons',
  'engineering',
  'ai-data',
  'design',
  'product',
  'business',
  'people-ops',
  'leadership'
];

export interface Frame {
  point: Vec2;
  span: number;
}

const frameOf = (bounds: Bounds, margin: number): Frame => ({
  point: boundsCentre(bounds),
  span: Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + margin
});

/** Camera framing that fits a whole district. */
export function districtFrame(id: DistrictId): Frame {
  const district = DISTRICTS.find((item) => item.id === id)!;
  return frameOf(district.bounds, id === 'engineering' ? -6 : 4);
}

/** Camera framing that fits one department's neighbourhood. */
export function departmentFrame(name: string): Frame | null {
  const bounds = DEPARTMENT_BOUNDS[name];
  return bounds ? frameOf(bounds, 3) : null;
}

/** The district a floor point belongs to: the one containing it, else the nearest. */
export function districtAt(point: Vec2): DistrictId {
  let best: DistrictId = 'commons';
  let bestDistance = Infinity;
  for (const district of DISTRICTS) {
    const { minX, maxX, minZ, maxZ } = district.bounds;
    const dx = Math.max(minX - point.x, 0, point.x - maxX);
    const dz = Math.max(minZ - point.z, 0, point.z - maxZ);
    const distance = Math.hypot(dx, dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = district.id;
    }
  }
  return best;
}

/** Label tier for how much floor is in view: districts from afar, departments, then people. */
export type LabelTier = 'far' | 'middle' | 'near';
export const labelTier = (view: Bounds | null): LabelTier => {
  if (!view) return 'middle';
  const width = view.maxX - view.minX;
  return width > 90 ? 'far' : width > 30 ? 'middle' : 'near';
};

/** A name short enough for a tag: "Backend Developer" becomes "Backend", but "AI Engineer" stays whole. */
export const shortName = (name: string) => {
  const base = name.replace(/ \([A-Z]+\)$/, '').replace(/^Chief (\w+) Officer$/, 'Chief $1');
  const trimmed = base.replace(/ (Developer|Engineer|Manager|Specialist)$/, '');
  return trimmed.length >= 4 ? trimmed : base;
};
