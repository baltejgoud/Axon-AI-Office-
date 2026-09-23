import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { bookshelf, coffeeMachine, group, plant, seeded, type CoffeeMachine } from './kit';
import { GEOMETRY, PALETTE, box, cylinder, lampGlow, mat, part } from './materials';

/**
 * The Commons' bigger rooms: tall library shelves, the Files room's cabinet wall, the café's pastry
 * case and pendant lights, and the lobby's bikes and coats.
 * Same conventions as furniture.ts: centred on the footprint at floor level, front facing +z.
 */

const BRASS = { metalness: 0.6, roughness: 0.35 } as const;

/** Library shelving that reaches toward the ceiling, with a brass rail and a rolling ladder. */
export function bookshelfTall(item: FurnitureItem): THREE.Group {
  const height = 2.6;
  const g = bookshelf(item, height, 6);
  const { w, d } = item;
  g.add(cylinder('#b8914f', 0.012, w - 0.1, [0, 2.35, d / 2 + 0.06], BRASS).rotateZ(Math.PI / 2));
  // The ladder leans on the rail at a bay chosen by the shelf's position.
  const random = seeded(item.x * 7 + item.z * 3);
  const x = -w / 2 + 0.6 + random() * (w - 1.2);
  const ladder = group();
  const rise = 2.4;
  for (const side of [-0.2, 0.2])
    ladder.add(box(PALETTE.woodDark, [0.04, rise, 0.04], [side, rise / 2, 0]));
  for (let i = 0; i < 7; i++) ladder.add(box(PALETTE.woodDark, [0.4, 0.025, 0.035], [0, 0.3 + i * 0.3, 0]));
  ladder.add(cylinder(PALETTE.darkMetal, 0.03, 0.03, [-0.2, 0.02, 0]), cylinder(PALETTE.darkMetal, 0.03, 0.03, [0.2, 0.02, 0]));
  ladder.position.set(x, 0, d / 2 + 0.42);
  ladder.rotation.x = -0.17;
  g.add(ladder);
  return g;
}

/** Floor-to-ceiling drawer units along the Files room's back wall, labelled like an archive. */
export function cabinetWall(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const height = 2.4;
  const units = Math.max(1, Math.round(w / 0.6));
  const unitWidth = w / units;
  const rows = 4;
  const drawer = (height - 0.2) / rows;
  const g = group(
    box('#e6e2da', [w, height, d], [0, height / 2, 0]),
    box(PALETTE.woodDark, [w + 0.06, 0.08, d + 0.04], [0, height + 0.04, 0])
  );
  const random = seeded(item.x * 11 + item.z);
  for (let u = 0; u < units; u++) {
    const x = -w / 2 + unitWidth * (u + 0.5);
    g.add(box('#cfc9be', [0.012, height - 0.1, 0.01], [x - unitWidth / 2, height / 2, d / 2 + 0.005]));
    for (let r = 0; r < rows; r++) {
      const y = 0.12 + drawer * (r + 0.5);
      g.add(box('#cfc9be', [unitWidth - 0.04, 0.01, 0.01], [x, y + drawer / 2 - 0.01, d / 2 + 0.005]));
      g.add(box(PALETTE.metal, [0.14, 0.025, 0.03], [x, y + 0.08, d / 2 + 0.02], { metalness: 0.4, roughness: 0.4 }));
      if ((u + r) % 2 === 0)
        g.add(box(random() < 0.3 ? '#fce9b8' : PALETTE.paper, [0.16, 0.06, 0.005], [x, y - 0.06, d / 2 + 0.008]));
    }
  }
  return g;
}

/** A glass-fronted counter with rows of pastries. */
export function pastryCase(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = group(
    box(PALETTE.woodLight, [w, 0.86, d], [0, 0.43, 0]),
    box(PALETTE.white, [w + 0.04, 0.04, d + 0.04], [0, 0.88, 0], { roughness: 0.35 })
  );
  const glass = part(
    GEOMETRY.box,
    mat(PALETTE.glass, { transparent: true, opacity: 0.25, roughness: 0.1 }),
    [w - 0.06, 0.42, d - 0.08],
    [0, 1.11, 0]
  );
  glass.castShadow = false;
  glass.renderOrder = 1;
  g.add(glass, box(PALETTE.white, [w - 0.1, 0.02, d - 0.14], [0, 1.1, 0]));
  const colours = ['#d9a066', '#c7803f', '#f2d49b', '#b5543c', '#e8c77a'];
  const random = seeded(item.x + item.z * 5);
  for (const [shelf, y] of [
    [0, 0.93],
    [1, 1.13]
  ] as const)
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + 0.16 + i * ((w - 0.32) / 5);
      const colour = colours[Math.floor(random() * colours.length)];
      const round = (i + shelf) % 2 === 0;
      const pastry = round
        ? part(GEOMETRY.sphere, mat(colour, { roughness: 0.7 }), [0.12, 0.07, 0.12], [x, y + 0.035, 0])
        : cylinder(colour, 0.06, 0.05, [x, y + 0.025, 0], { roughness: 0.7 });
      pastry.castShadow = false;
      g.add(pastry);
    }
  return g;
}

/** A work table stacked with paper and folders, for sorting what comes out of the cabinets. */
export function sortingTable(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = group(box(PALETTE.woodLight, [w, 0.05, d], [0, 0.74, 0]));
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08])
    for (const z of [-d / 2 + 0.08, d / 2 - 0.08]) g.add(box(PALETTE.white, [0.04, 0.72, 0.04], [x, 0.36, z]));
  for (const [x, z, count] of [
    [-0.45, -0.1, 5],
    [0.05, 0.12, 3],
    [0.5, -0.12, 7]
  ] as const)
    for (let i = 0; i < count; i++)
      g.add(box(PALETTE.paper, [0.3, 0.012, 0.22], [x + (i % 2) * 0.01, 0.775 + i * 0.012, z]));
  g.add(
    box('#e7c77d', [0.32, 0.03, 0.24], [0.1, 0.78, -0.2]),
    box('#9fb4d4', [0.32, 0.03, 0.24], [-0.1, 0.78, 0.22])
  );
  return g;
}

/** A steel loop rack with two bikes parked in it. */
export function bikeRack(item: FurnitureItem): THREE.Group {
  const { w } = item;
  const steel = mat(PALETTE.metal, { metalness: 0.5, roughness: 0.4 });
  const g = group();
  const loops = 3;
  for (let i = 0; i < loops; i++) {
    const x = -w / 2 + 0.3 + i * ((w - 0.6) / (loops - 1));
    g.add(part(new THREE.TorusGeometry(0.3, 0.02, 6, 16, Math.PI), steel, [1, 1, 1], [x, 0.02, 0]));
  }
  const wheel = new THREE.TorusGeometry(0.3, 0.03, 6, 18);
  for (const [x, colour] of [
    [-w / 4, '#c0392b'],
    [w / 4, '#2e7d6f']
  ] as const) {
    const bike = group(
      part(wheel, mat(PALETTE.black), [1, 1, 1], [0, 0.32, -0.5], [0, Math.PI / 2, 0]),
      part(wheel, mat(PALETTE.black), [1, 1, 1], [0, 0.32, 0.5], [0, Math.PI / 2, 0]),
      part(GEOMETRY.box, mat(colour), [0.04, 0.04, 0.8], [0, 0.55, 0.02], [0.1, 0, 0]),
      part(GEOMETRY.box, mat(colour), [0.04, 0.4, 0.04], [0, 0.45, -0.15], [0.35, 0, 0]),
      box(PALETTE.black, [0.12, 0.04, 0.22], [0, 0.72, -0.2]),
      box(PALETTE.darkMetal, [0.44, 0.03, 0.03], [0, 0.8, 0.42])
    );
    bike.position.x = x;
    g.add(bike);
  }
  return g;
}

/** A coat stand with a couple of coats and a scarf. */
export function coatRack(): THREE.Group {
  const g = group(
    cylinder(PALETTE.darkMetal, 0.2, 0.03, [0, 0.015, 0]),
    cylinder(PALETTE.woodDark, 0.025, 1.8, [0, 0.9, 0]),
    part(GEOMETRY.sphere, mat(PALETTE.woodDark), [0.07, 0.07, 0.07], [0, 1.82, 0])
  );
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    g.add(
      part(
        GEOMETRY.cylinder,
        mat(PALETTE.woodDark),
        [0.02, 0.2, 0.02],
        [Math.sin(angle) * 0.07, 1.7, Math.cos(angle) * 0.07],
        [Math.cos(angle) * 0.9, 0, -Math.sin(angle) * 0.9]
      )
    );
  }
  g.add(
    part(GEOMETRY.cone, mat('#6b7a8f', { roughness: 0.95 }), [0.34, 0.85, 0.2], [0.1, 1.28, 0.02], [0, 0, -0.08]),
    part(GEOMETRY.cone, mat('#b0764a', { roughness: 0.95 }), [0.3, 0.7, 0.18], [-0.08, 1.35, -0.05], [0, 0, 0.1]),
    box('#d9534f', [0.06, 0.5, 0.03], [0.02, 1.4, 0.12])
  );
  return g;
}

/** A pendant light hanging over a table. It glows with the evening. */
export function pendantLamp(): THREE.Group {
  return group(
    cylinder(PALETTE.darkMetal, 0.006, 0.7, [0, 2.75, 0]),
    cylinder('#b8914f', 0.04, 0.05, [0, 2.4, 0], BRASS),
    part(GEOMETRY.cone, mat('#efe6d6', { roughness: 0.6 }), [0.38, 0.22, 0.38], [0, 2.27, 0]),
    part(GEOMETRY.sphere, lampGlow.table(), [0.16, 0.1, 0.16], [0, 2.15, 0])
  );
}

/** A district's coffee counter: a machine, a stack of cups and a small plant. */
export function coffeeStation(item: FurnitureItem): CoffeeMachine {
  const { w, d } = item;
  const g = group(
    box(PALETTE.woodLight, [w, 0.86, d], [0, 0.45, 0]),
    box('#b58d62', [w - 0.02, 0.08, d - 0.08], [0, 0.04, 0]),
    box(PALETTE.white, [w + 0.04, 0.05, d + 0.04], [0, 0.905, 0], { roughness: 0.35 })
  );
  for (let i = 1; i < 3; i++)
    g.add(box('#b99870', [0.01, 0.72, 0.01], [-w / 2 + (i * w) / 3, 0.47, d / 2 + 0.005]));
  const machine = coffeeMachine();
  machine.group.position.set(0, 0.93, -0.08);
  g.add(machine.group);
  for (let i = 0; i < 4; i++) g.add(cylinder(PALETTE.white, 0.04, 0.025, [-0.55, 0.945 + i * 0.026, 0.05]));
  g.add(cylinder('#e8b04a', 0.04, 0.1, [-0.35, 0.98, 0.12]), cylinder(PALETTE.white, 0.04, 0.1, [0.4, 0.98, 0.14]));
  const herb = plant(0.4, PALETTE.white, Math.abs(item.x * 13 + item.z));
  herb.position.set(0.62, 0.93, -0.06);
  g.add(herb);
  return { ...machine, group: g };
}
