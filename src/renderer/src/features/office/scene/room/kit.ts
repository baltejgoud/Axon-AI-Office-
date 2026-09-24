import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, cylinder, box, mat, part, type MaterialOptions } from './materials';

/**
 * Small pieces shared by the furniture builders: seeded randomness, plants and books.
 * Same conventions as furniture.ts: centred on the footprint at floor level, front facing +z.
 */

export const BOOK_COLORS = [
  '#3d5a80',
  '#98c1d9',
  '#c9ada7',
  '#e0b36a',
  '#6d8b74',
  '#b5838d',
  '#e5e5e5',
  '#8d99ae',
  '#d4a373'
];

export function seeded(seed: number) {
  let state = Math.floor(Math.abs(seed) * 1000) % 2147483646 || 1;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
}

type Vec3 = [number, number, number];

// ---------------------------------------------------------------- style kit

const bevels = new Map<string, THREE.BufferGeometry>();

/**
 * A box with softly rounded edges, for anything made: desks, cabinets, counters, cushions. The
 * geometry is built at its true size (cached), so corners stay round however the box is proportioned.
 */
export function bevelBox(
  color: string,
  size: Vec3,
  position: Vec3,
  radius = 0.02,
  options?: MaterialOptions,
  segments = radius < 0.012 ? 1 : 2
): THREE.Mesh {
  const [w, h, d] = size.map((v) => Math.round(v * 1000) / 1000);
  const r = Math.max(0.001, Math.min(radius, Math.min(w, h, d) / 2 - 0.001));
  const key = `${w}|${h}|${d}|${r.toFixed(3)}|${segments}`;
  let geometry = bevels.get(key);
  if (!geometry) {
    geometry = new RoundedBoxGeometry(w, h, d, segments, r);
    bevels.set(key, geometry);
  }
  return part(geometry, mat(color, options), [1, 1, 1], position);
}

/** Soft goods share one material per roughness; their colour rides in the geometry. */
const paintMaterials = (roughness: number, depthPull?: number) =>
  mat('#ffffff', { vertexColors: true, roughness, depthPull });

/** A copy of `geometry` with every vertex in `color`. */
function painted(geometry: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const copy = geometry.clone();
  const count = copy.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  copy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return copy;
}

/**
 * `bevelBox` for the many-coloured things (fabrics, rugs, cushions): every colour shares one
 * material, so a room full of colours still draws in a single call once merged.
 */
export function paintedBox(
  color: string,
  size: Vec3,
  position: Vec3,
  radius = 0.02,
  roughness = 0.95,
  depthPull?: number
): THREE.Mesh {
  const shape = bevelBox('#ffffff', size, position, radius).geometry;
  return part(painted(shape, color), paintMaterials(roughness, depthPull), [1, 1, 1], position);
}

/** One material for everything faceted: its colours live in the geometry, so it all merges into one mesh. */
const facetMaterial = () => mat('#ffffff', { flat: true, vertexColors: true, roughness: 0.85 });

/**
 * A faceted copy of `geometry` in `color`: flat-shaded, each face a touch lighter or darker
 * (up to ±`variation` in lightness, seeded), for things that grow or are baked: leaves, fruit, bread.
 */
export function facet(
  geometry: THREE.BufferGeometry,
  color: string,
  variation = 0.06,
  seed = 1
): THREE.BufferGeometry {
  const faceted = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const random = seeded(seed * 7.31 + 1);
  const base = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl, THREE.SRGBColorSpace);
  const count = faceted.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const shade = new THREE.Color();
  for (let face = 0; face < count / 3; face++) {
    shade.setHSL(
      hsl.h,
      hsl.s,
      THREE.MathUtils.clamp(hsl.l + (random() * 2 - 1) * variation, 0, 1),
      THREE.SRGBColorSpace
    );
    for (let v = 0; v < 3; v++) shade.toArray(colors, (face * 3 + v) * 3);
  }
  faceted.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return faceted;
}

/** A faceted solid placed like `part`: a unit `geometry` scaled to `size`. */
export function facetPart(
  geometry: THREE.BufferGeometry,
  color: string,
  size: Vec3,
  position: Vec3,
  rotation: Vec3 = [0, 0, 0],
  seed = 1,
  variation = 0.06
): THREE.Mesh {
  return part(facet(geometry, color, variation, seed), facetMaterial(), size, position, rotation);
}

const lathes = new Map<string, THREE.LatheGeometry>();

/** A turned shape from a profile of [radius, height] points, bottom to top: pots, cups, lamps, bottles. */
export function lathe(
  profile: readonly (readonly [number, number])[],
  color: string,
  position: Vec3 = [0, 0, 0],
  segments = 16,
  options?: MaterialOptions
): THREE.Mesh {
  const key = `${segments}|${profile.map((p) => p.join(',')).join(';')}`;
  let geometry = lathes.get(key);
  if (!geometry) {
    geometry = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r, y)),
      segments
    );
    lathes.set(key, geometry);
  }
  return part(geometry, mat(color, options), [1, 1, 1], position);
}

/** Low-poly solids shared by the small things: an 8-sided can, a 6-sided wheel and two faceted balls. */
export const LOW = {
  /** A soft blob (bean bags, cushions): round enough, a third of a full sphere's triangles. */
  blob: new THREE.SphereGeometry(0.5, 12, 8),
  can: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateZ(Math.PI / 2),
  gem: new THREE.IcosahedronGeometry(0.5, 0),
  ball: new THREE.IcosahedronGeometry(0.5, 1)
} as const;

/** `a` blended toward `b` by `t`, in display (sRGB) terms, as a hex colour. */
export function blend(a: string, b: string, t: number): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [from, to] = [channels(a), channels(b)];
  return `#${from
    .map((v, i) =>
      Math.round(v + (to[i] - v) * t)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** A district's accent family: its colour, lighter and paler tints for fabric, and a deep shade for trim. */
export function tones(color: string): { base: string; light: string; pale: string; dark: string } {
  return {
    base: color,
    light: blend(color, '#ffffff', 0.3),
    pale: blend(color, '#ffffff', 0.62),
    dark: blend(color, '#1f2328', 0.3)
  };
}

/** No shadow from `object` or anything in it: small things cost shadow triangles and show none. */
export function noShadow<T extends THREE.Object3D>(object: T): T {
  object.traverse((child) => (child.castShadow = false));
  return object;
}

/**
 * A small potted plant for tables and shelves: three faceted tufts in a turned pot, a fifth of the
 * triangles of `plant` at the same size.
 */
export function pottedTuft(scale = 1, potColor: string = PALETTE.white, seed = 1): THREE.Group {
  const random = seeded(seed);
  const s = Math.round(scale * 1000) / 1000;
  const g = group(
    lathe(
      [
        [0, 0],
        [0.05 * s, 0],
        [0.065 * s, 0.1 * s],
        [0.07 * s, 0.105 * s],
        [0, 0.105 * s]
      ],
      potColor,
      [0, 0, 0],
      8,
      { roughness: 0.5 }
    )
  );
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + random();
    const size = (0.13 + random() * 0.05) * s;
    g.add(
      facetPart(
        LOW.gem,
        GREENS[(i + seed) % GREENS.length],
        [size, size * 1.1, size],
        [Math.sin(angle) * 0.04 * s, (0.16 + random() * 0.05) * s, Math.cos(angle) * 0.04 * s],
        [random(), random(), 0],
        seed + i
      )
    );
  }
  return g;
}

/** Greens for foliage, from shade to sun. */
export const GREENS = ['#3f8541', '#4f9a4a', '#5fae55', '#72bd62'] as const;
/** A crown or a shrub: a subdivided icosahedron, faceted. */
const CROWN = new THREE.IcosahedronGeometry(0.5, 1);
/** A crisper, chunkier solid for big leaves and rocks. */
const GEM = new THREE.IcosahedronGeometry(0.5, 0);

/**
 * A turned pot `radius` wide and `height` tall at the rim, with a lip and a foot, and soil just
 * under the rim. Returns the pot and its soil.
 */
export function pot(radius: number, height: number, color: string): THREE.Group {
  const r = Math.round(radius * 1000) / 1000;
  const h = Math.round(height * 1000) / 1000;
  return group(
    lathe(
      [
        [0, 0],
        [r * 0.72, 0],
        [r * 0.76, h * 0.06],
        [r * 0.96, h * 0.86],
        [r * 1.04, h * 0.88],
        [r * 1.04, h],
        [r * 0.9, h],
        [r * 0.88, h * 0.9],
        [0, h * 0.9]
      ],
      color,
      [0, 0, 0],
      18,
      { roughness: 0.7 }
    ),
    cylinder('#5b4636', r * 0.88, 0.01, [0, h * 0.905, 0], { roughness: 1 })
  );
}

/** A potted bush: a cluster of faceted crowns over a turned pot. `scale` 1 is a desk-side floor plant. */
export function plant(scale = 1, potColor: string = PALETTE.pot, seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = pot(0.18 * scale, 0.34 * scale, potColor);
  const count = 5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.6;
    const reach = (0.07 + random() * 0.06) * scale;
    const size = (0.2 + random() * 0.08) * scale;
    g.add(
      facetPart(
        CROWN,
        GREENS[Math.floor(random() * GREENS.length)],
        [size, size * 0.9, size],
        [Math.sin(angle) * reach, (0.42 + random() * 0.12) * scale, Math.cos(angle) * reach],
        [random(), random(), 0],
        seed * 13 + i
      )
    );
  }
  const top = 0.26 * scale;
  g.add(facetPart(CROWN, GREENS[2], [top, top * 0.9, top], [0, 0.6 * scale, 0], [0, random(), 0], seed * 17));
  return g;
}

/** A tall statement plant: a slim trunk and three chunky faceted crowns in a clay pot. */
export function largePlant(seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = pot(0.25, 0.44, PALETTE.clay);
  g.add(part(GEOMETRY.cylinder, mat('#6b4f36', { roughness: 0.9 }), [0.05, 0.9, 0.05], [0, 0.85, 0]));
  const crowns: [number, number, number][] = [
    [0.52, 1.05, 0.12],
    [0.46, 1.32, -0.1],
    [0.36, 1.56, 0.04]
  ];
  crowns.forEach(([size, y, offset], i) =>
    g.add(
      facetPart(
        GEM,
        GREENS[(i + Math.floor(random() * 2)) % GREENS.length],
        [size, size * 0.85, size],
        [offset * Math.cos(seed + i), y, offset * Math.sin(seed + i)],
        [random(), random() * 3, random()],
        seed * 5 + i,
        0.07
      )
    )
  );
  return g;
}

/**
 * Books standing along a shelf from `x` to `end` at height `y`, `depth` deep. Now and then a book
 * leans or leaves a gap, so rows never look stamped out.
 */
export function bookRow(
  g: THREE.Group,
  random: () => number,
  x: number,
  end: number,
  y: number,
  depth: number,
  z = 0.02
): void {
  while (x < end - 0.04) {
    const width = 0.03 + random() * 0.035;
    const bookHeight = 0.2 + random() * 0.12;
    const lean = random() < 0.08 ? 0.18 : 0;
    g.add(
      part(
        GEOMETRY.box,
        mat(BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)]),
        [width, bookHeight, depth],
        [x + width / 2, y + bookHeight / 2, z],
        [0, 0, lean]
      )
    );
    x += width + (random() < 0.12 ? 0.08 : 0.004);
  }
}

/** Open wooden shelving filled with books and the odd plant. */
export function bookshelf(itemDef: FurnitureItem, height = 2.2, shelves = 5): THREE.Group {
  const { w, d } = itemDef;
  const random = seeded(itemDef.x * 3 + itemDef.z);
  const g = group(box(PALETTE.wood, [w, height, 0.03], [0, height / 2, -d / 2 + 0.015]));
  const bays = Math.max(2, Math.round(w / 1.15));
  const bayWidth = w / bays;
  for (let i = 0; i <= bays; i++)
    g.add(box(PALETTE.wood, [0.04, height, d], [-w / 2 + i * bayWidth, height / 2, 0]));
  for (let s = 0; s <= shelves; s++)
    g.add(box(PALETTE.wood, [w, 0.03, d], [0, 0.04 + (s * (height - 0.08)) / shelves, 0]));
  for (let bay = 0; bay < bays; bay++) {
    for (let s = 0; s < shelves; s++) {
      const shelfY = 0.055 + (s * (height - 0.08)) / shelves;
      const x = -w / 2 + bay * bayWidth + 0.05;
      if (random() < 0.18) {
        const decor = plant(0.32, PALETTE.white, bay * 10 + s);
        decor.position.set(x + bayWidth / 2 - 0.05, shelfY, 0);
        g.add(decor);
        continue;
      }
      bookRow(g, random, x, x + bayWidth - 0.1, shelfY, d * 0.7);
    }
  }
  return g;
}

const steamMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.5,
  depthWrite: false
});

export interface CoffeeMachine {
  group: THREE.Group;
  /** The ready light, brighter while someone waits for a cup. */
  light: THREE.Mesh;
  /** Puffs above the spout, shown and animated while the machine is in use. */
  steam: THREE.Group;
}

/** An espresso machine with a ready light and a wisp of steam. */
export function coffeeMachine(): CoffeeMachine {
  const light = part(
    GEOMETRY.sphere,
    new THREE.MeshStandardMaterial({ color: '#5a3d12', emissive: '#f59e0b', emissiveIntensity: 0.4 }),
    [0.025, 0.025, 0.025],
    [0.1, 0.33, 0.185]
  );
  light.userData.dynamic = true;
  const steam = group();
  for (let i = 0; i < 3; i++) {
    const puff = part(GEOMETRY.lowSphere, steamMaterial, [0.06, 0.06, 0.06], [0, 0, 0]);
    puff.castShadow = false;
    puff.receiveShadow = false;
    puff.userData.dynamic = true;
    puff.userData.phase = i / 3;
    steam.add(puff);
  }
  steam.position.set(0, 0.5, 0.12);
  steam.visible = false;
  const g = group(
    box(PALETTE.black, [0.34, 0.42, 0.36], [0, 0.21, 0], { roughness: 0.4 }),
    box('#555b64', [0.36, 0.04, 0.38], [0, 0.44, 0], { roughness: 0.4, metalness: 0.3 }),
    box('#15181c', [0.22, 0.14, 0.02], [0, 0.18, 0.18]),
    box(PALETTE.metal, [0.2, 0.02, 0.12], [0, 0.04, 0.14], { metalness: 0.5 }),
    light,
    steam
  );
  return { group: g, light, steam };
}

/** Steam rising from a machine in use: each puff climbs 0.4 m, swells and fades, then starts over. */
export function animateSteam(steam: THREE.Object3D, busy: boolean, elapsed: number): void {
  steam.visible = busy;
  if (!busy) return;
  for (const puff of steam.children) {
    const t = (elapsed / 1.6 + (puff.userData.phase as number)) % 1;
    const size = 0.04 + 0.1 * Math.sin(Math.PI * t);
    puff.position.set(Math.sin(t * 5 + (puff.userData.phase as number) * 9) * 0.03, t * 0.4, 0);
    puff.scale.setScalar(size);
  }
}
