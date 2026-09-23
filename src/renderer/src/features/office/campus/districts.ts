import type { ScreenFlavor } from '../scene/room/materials';

export type DistrictId =
  'commons' | 'engineering' | 'product' | 'design' | 'leadership' | 'ai-data' | 'business' | 'people-ops';

/** Floor rectangle in metres; x runs along the back wall, z toward the viewer. */
export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type FloorKind =
  'oak' | 'carpet-blue' | 'carpet-sage' | 'carpet-grey' | 'concrete' | 'terrazzo' | 'walnut';

export interface District {
  id: DistrictId;
  name: string;
  short: string;
  /** Label and minimap colour; dark enough for white text and for text on white (AA). */
  color: string;
  bounds: Bounds;
  /** Department cells: columns along x, rows along z. */
  grid: [cols: number, rows: number];
  /** Catalog department (group) names, in layout order. */
  departments: string[];
  flavor: ScreenFlavor;
  equipment: 'laptop' | 'laptop-monitor' | 'monitor';
  floor: FloorKind;
}

/**
 * The campus: a 40 x 32 m Commons in the middle and seven districts around it, each at least
 * 2.5 m from its neighbours so the main corridors stay open.
 */
export const DISTRICTS: readonly District[] = [
  {
    id: 'commons',
    name: 'Commons',
    short: 'Commons',
    color: '#9a6414',
    bounds: { minX: -20, maxX: 20, minZ: -15, maxZ: 17 },
    grid: [1, 1],
    departments: [],
    flavor: 'document',
    equipment: 'laptop',
    floor: 'terrazzo'
  },
  {
    id: 'engineering',
    name: 'Engineering',
    short: 'Engineering',
    color: '#2f5bd3',
    bounds: { minX: -60, maxX: -25, minZ: -31, maxZ: 31 },
    grid: [3, 3],
    departments: [
      'Web & Frontend',
      'Backend & APIs',
      'Mobile',
      'Cloud & Infrastructure',
      'Security',
      'Architecture & General Engineering',
      'QA & Release',
      'Platforms & Enterprise',
      'Emerging Tech'
    ],
    flavor: 'code',
    equipment: 'laptop-monitor',
    floor: 'oak'
  },
  {
    id: 'product',
    name: 'Product & Delivery',
    short: 'Product',
    color: '#7c3aed',
    bounds: { minX: -16, maxX: 16, minZ: -36, maxZ: -17.5 },
    grid: [3, 1],
    departments: ['Product Management', 'Project Management', 'Engineering Management'],
    flavor: 'document',
    equipment: 'laptop',
    floor: 'carpet-blue'
  },
  {
    id: 'design',
    name: 'Design Studio',
    short: 'Design',
    color: '#c0267a',
    bounds: { minX: 25, maxX: 38, minZ: -36, maxZ: -19 },
    grid: [1, 1],
    departments: ['Design'],
    flavor: 'design',
    equipment: 'monitor',
    floor: 'concrete'
  },
  {
    id: 'leadership',
    name: 'Leadership Suite',
    short: 'Leadership',
    color: '#0f5e57',
    bounds: { minX: 41, maxX: 60, minZ: -36, maxZ: -19 },
    grid: [5, 2],
    departments: ['Executive Leadership'],
    flavor: 'document',
    equipment: 'laptop-monitor',
    floor: 'walnut'
  },
  {
    id: 'ai-data',
    name: 'AI & Data Lab',
    short: 'AI & Data',
    color: '#0e7490',
    bounds: { minX: 25, maxX: 60, minZ: -11, maxZ: 8 },
    grid: [1, 1],
    departments: ['AI, ML & Data'],
    flavor: 'data',
    equipment: 'laptop-monitor',
    floor: 'carpet-grey'
  },
  {
    id: 'business',
    name: 'Business',
    short: 'Business',
    color: '#b4461b',
    bounds: { minX: -16, maxX: 16, minZ: 19.5, maxZ: 36 },
    grid: [4, 1],
    departments: ['Sales Management', 'Marketing Management', 'Customer Success', 'Strategy & Innovation'],
    flavor: 'data',
    equipment: 'laptop',
    floor: 'carpet-blue'
  },
  {
    id: 'people-ops',
    name: 'People & Ops',
    short: 'People & Ops',
    color: '#3f7a3a',
    bounds: { minX: 25, maxX: 60, minZ: 16, maxZ: 36 },
    grid: [3, 1],
    departments: ['Operations Management', 'HR & People', 'General Management'],
    flavor: 'document',
    equipment: 'laptop',
    floor: 'carpet-sage'
  }
];

const byId = new Map(DISTRICTS.map((district) => [district.id, district]));
const byDepartment = new Map(
  DISTRICTS.flatMap((district) => district.departments.map((name) => [name, district.id] as const))
);

export function districtById(id: DistrictId): District {
  const district = byId.get(id);
  if (!district) throw new Error(`Unknown district: ${id}`);
  return district;
}

export function districtOf(department: string): DistrictId {
  const id = byDepartment.get(department);
  if (!id) throw new Error(`Department without a district: ${department}`);
  return id;
}

export const boundsCentre = (b: Bounds) => ({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
