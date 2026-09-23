import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, cylinder, box, mat, part } from './materials';

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

function leaf(
  color: string,
  size: [number, number, number],
  position: [number, number, number],
  tilt: [number, number, number]
) {
  return part(GEOMETRY.lowSphere, mat(color, { flat: true, roughness: 0.9 }), size, position, tilt);
}

/** A pot with a loose crown of leaves. `scale` 1 is a desk-side floor plant. */
export function plant(scale = 1, potColor: string = PALETTE.pot, seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = group(
    part(GEOMETRY.cone, mat(potColor), [0.36 * scale, 0.34 * scale, 0.36 * scale], [0, 0.17 * scale, 0]),
    cylinder('#5b4636', 0.16 * scale, 0.02, [0, 0.335 * scale, 0])
  );
  const count = 9;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.4;
    const reach = (0.14 + random() * 0.08) * scale;
    const height = (0.45 + random() * 0.35) * scale;
    g.add(
      leaf(
        [PALETTE.leaf, PALETTE.leafLight, PALETTE.leafDark][i % 3],
        [0.16 * scale, 0.09 * scale, 0.34 * scale],
        [Math.sin(angle) * reach, height, Math.cos(angle) * reach],
        [-0.7 - random() * 0.4, angle, 0]
      )
    );
  }
  g.add(leaf(PALETTE.leafLight, [0.2 * scale, 0.2 * scale, 0.2 * scale], [0, 0.72 * scale, 0], [0, 0, 0]));
  return g;
}

/** A tall statement plant with broad leaves on thin stems. */
export function largePlant(seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = group(
    part(GEOMETRY.cone, mat(PALETTE.clay), [0.5, 0.46, 0.5], [0, 0.23, 0]),
    cylinder('#4d3b2d', 0.22, 0.02, [0, 0.45, 0])
  );
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + random() * 0.5;
    const reach = 0.12 + random() * 0.22;
    const height = 0.7 + random() * 0.7;
    const stemX = Math.sin(angle) * reach * 0.5;
    const stemZ = Math.cos(angle) * reach * 0.5;
    g.add(
      part(
        GEOMETRY.cylinder,
        mat(PALETTE.leafDark),
        [0.02, height - 0.4, 0.02],
        [stemX, 0.45 + (height - 0.4) / 2, stemZ],
        [Math.cos(angle) * 0.2, 0, -Math.sin(angle) * 0.2]
      )
    );
    g.add(
      leaf(
        i % 2 ? PALETTE.leaf : PALETTE.leafLight,
        [0.34, 0.08, 0.42],
        [Math.sin(angle) * reach, height, Math.cos(angle) * reach],
        [-0.5 - random() * 0.5, angle, 0.2]
      )
    );
  }
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
