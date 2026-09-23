import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
const roundedSurface = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
import type { DeskEquipment, DeskProp, FurnitureItem } from '../../simulation/layout';
import {
  GEOMETRY,
  PALETTE,
  box,
  cylinder,
  lampGlow,
  mat,
  part,
  screenCanvas,
  type ScreenFlavor
} from './materials';
import * as commons from './commonsProps';
import * as props from './props';
import { bookshelf, coffeeMachine, group, largePlant, plant, seeded, type CoffeeMachine } from './kit';

export { largePlant, plant };

/**
 * Low-poly furniture built from primitives. Each builder returns a group centred on the item's
 * footprint at floor level, with its front (and a seated person's view) facing local +z.
 */

const NOTE_COLORS = ['#ffe08a', '#ffb4c8', '#a7d8ff', '#b9f0c0'];

function deskTop(width: number, depth: number): THREE.Group {
  const inset = 0.08;
  const g = group(
    part(roundedSurface, mat(PALETTE.woodLight, { roughness: 0.52 }), [width, 0.055, depth], [0, 0.74, 0])
  );
  for (const x of [-width / 2 + inset, width / 2 - inset])
    for (const z of [-depth / 2 + inset, depth / 2 - inset])
      g.add(box(PALETTE.white, [0.04, 0.72, 0.04], [x, 0.36, z]));
  return g;
}

function pedestal(x: number, z: number): THREE.Mesh {
  return box(PALETTE.offWhite, [0.4, 0.56, 0.5], [x, 0.3, z]);
}

function deskPod(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const g = group(
    part(roundedSurface, mat(PALETTE.woodLight, { roughness: 0.52 }), [w, 0.055, d], [0, 0.74, 0])
  );
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    g.add(box(PALETTE.white, [0.05, 0.72, d - 0.2], [x, 0.36, 0]));
    g.add(box(PALETTE.white, [0.06, 0.04, d - 0.1], [x, 0.02, 0]));
  }
  for (const x of [-w / 2 + 0.35, w / 2 - 0.35]) for (const z of [-d / 4, d / 4]) g.add(pedestal(x, z));
  if (itemDef.id === 'pod-a') {
    // Planter spine down the middle, as in the reference.
    g.add(box(PALETTE.white, [w - 0.2, 0.2, 0.3], [0, 0.86, 0]));
    for (let i = 0; i < 6; i++) {
      const bush = plant(0.55, PALETTE.white, i + 3);
      bush.position.set(-w / 2 + 0.35 + i * ((w - 0.7) / 5), 0.78, 0);
      g.add(bush);
    }
  } else {
    g.add(box('#aebfb4', [w - 0.1, 0.4, 0.04], [0, 0.96, 0]));
    g.add(box(PALETTE.white, [w - 0.06, 0.02, 0.06], [0, 1.17, 0]));
  }
  return g;
}

function officeChair(): THREE.Group {
  const seat = '#e7e9ec';
  const g = group(
    box(seat, [0.48, 0.07, 0.46], [0, 0.46, 0], { roughness: 0.9 }),
    part(GEOMETRY.box, mat(seat, { roughness: 0.9 }), [0.46, 0.52, 0.06], [0, 0.78, -0.22], [-0.12, 0, 0]),
    cylinder('#8a9099', 0.022, 0.34, [0, 0.27, 0], { metalness: 0.3, roughness: 0.5 }),
    cylinder('#8a9099', 0.045, 0.05, [0, 0.07, 0], { metalness: 0.3, roughness: 0.5 })
  );
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    g.add(
      part(
        GEOMETRY.box,
        mat('#8a9099', { metalness: 0.3, roughness: 0.5 }),
        [0.03, 0.025, 0.22],
        [Math.sin(angle) * 0.1, 0.045, Math.cos(angle) * 0.1],
        [0, angle, 0]
      )
    );
  }
  return g;
}

function meetingChair(): THREE.Group {
  const g = group(
    box(PALETTE.fabricCream, [0.46, 0.06, 0.44], [0, 0.46, 0]),
    part(GEOMETRY.box, mat(PALETTE.fabricCream), [0.44, 0.4, 0.05], [0, 0.72, -0.2], [-0.1, 0, 0])
  );
  for (const x of [-0.19, 0.19])
    for (const z of [-0.18, 0.18]) g.add(box(PALETTE.darkMetal, [0.03, 0.44, 0.03], [x, 0.22, z]));
  return g;
}

function armchair(): THREE.Group {
  const fabric = PALETTE.fabricBlue;
  return group(
    box(fabric, [0.82, 0.3, 0.78], [0, 0.22, 0]),
    box('#8ea3b7', [0.62, 0.1, 0.62], [0, 0.42, 0.04]),
    box(fabric, [0.82, 0.62, 0.16], [0, 0.55, -0.33]),
    box(fabric, [0.12, 0.52, 0.74], [-0.35, 0.33, 0]),
    box(fabric, [0.12, 0.52, 0.74], [0.35, 0.33, 0]),
    box(PALETTE.woodDark, [0.05, 0.08, 0.05], [0.33, 0.04, 0.33])
  );
}

function sofa(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const fabric = PALETTE.fabricCream;
  const g = group(
    box(fabric, [w, 0.3, d], [0, 0.2, 0]),
    box(fabric, [w, 0.72, 0.22], [0, 0.48, -d / 2 + 0.11]),
    box(fabric, [0.2, 0.56, d], [-w / 2 + 0.1, 0.3, 0]),
    box(fabric, [0.2, 0.56, d], [w / 2 - 0.1, 0.3, 0])
  );
  const cushions = 3;
  const cushionWidth = (w - 0.44) / cushions;
  for (let i = 0; i < cushions; i++)
    g.add(
      box(
        '#f3eee4',
        [cushionWidth - 0.03, 0.1, d - 0.3],
        [-w / 2 + 0.22 + cushionWidth * (i + 0.5), 0.4, 0.08]
      )
    );
  g.add(
    part(
      GEOMETRY.box,
      mat(PALETTE.fabricBlue),
      [0.4, 0.34, 0.12],
      [-w / 2 + 0.5, 0.6, -d / 2 + 0.3],
      [-0.25, 0.2, 0]
    )
  );
  g.add(
    part(GEOMETRY.box, mat('#d8c7a8'), [0.36, 0.32, 0.12], [w / 2 - 0.5, 0.6, -d / 2 + 0.3], [-0.25, -0.2, 0])
  );
  return g;
}

function roundTable(radius: number, height: number, top: string): THREE.Group {
  return group(
    cylinder(top, radius, 0.04, [0, height, 0]),
    cylinder(PALETTE.darkMetal, 0.04, height, [0, height / 2, 0]),
    cylinder(PALETTE.darkMetal, radius * 0.45, 0.03, [0, 0.015, 0])
  );
}

function coffeeTable(): THREE.Group {
  const g = roundTable(0.45, 0.4, PALETTE.woodLight);
  g.add(
    box('#8d99ae', [0.2, 0.03, 0.26], [0.1, 0.44, 0.05]),
    box('#e0b36a', [0.18, 0.03, 0.24], [0.1, 0.47, 0.05])
  );
  const bowl = plant(0.28, PALETTE.white, 11);
  bowl.position.set(-0.15, 0.42, -0.1);
  g.add(bowl);
  return g;
}

function sideTable(): THREE.Group {
  return group(
    ...roundTable(0.25, 0.55, PALETTE.woodLight).children,
    cylinder(PALETTE.white, 0.05, 0.26, [0, 0.7, 0]),
    part(GEOMETRY.cone, lampGlow.table(), [0.28, 0.2, 0.28], [0, 0.9, 0])
  );
}

function meetingTable(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  return group(
    box(PALETTE.woodLight, [w, 0.05, d], [0, 0.74, 0]),
    box(PALETTE.offWhite, [0.08, 0.7, d - 0.4], [-w / 2 + 0.5, 0.36, 0]),
    box(PALETTE.offWhite, [0.08, 0.7, d - 0.4], [w / 2 - 0.5, 0.36, 0]),
    box(PALETTE.paper, [0.22, 0.01, 0.3], [-0.9, 0.77, 0.25]),
    box('#3d5a80', [0.16, 0.015, 0.22], [0.8, 0.77, -0.3]),
    cylinder('#dff1f8', 0.035, 0.1, [-0.4, 0.82, -0.35], { transparent: true, opacity: 0.6 })
  );
}

function printer(): { group: THREE.Group; light: THREE.Mesh } {
  const light = part(
    GEOMETRY.sphere,
    new THREE.MeshStandardMaterial({ color: '#1b5e3b', emissive: '#22c55e', emissiveIntensity: 0.3 }),
    [0.03, 0.03, 0.03],
    [0.3, 0.97, 0.24]
  );
  light.userData.dynamic = true;
  const g = group(
    box(PALETTE.offWhite, [0.9, 0.5, 0.58], [0, 0.25, 0]),
    box('#e6e6e3', [0.88, 0.4, 0.56], [0, 0.7, 0]),
    box('#9aa1ab', [0.7, 0.03, 0.4], [0, 0.915, -0.02]),
    box(PALETTE.paper, [0.34, 0.02, 0.26], [-0.12, 0.74, 0.3]),
    box(PALETTE.darkMetal, [0.2, 0.05, 0.08], [0.28, 0.93, 0.22]),
    light
  );
  return { group: g, light };
}

function fileCabinet(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const height = 1.3;
  const units = 4;
  const unitDepth = d / units;
  const g = group();
  for (let i = 0; i < units; i++) {
    const z = -d / 2 + unitDepth * (i + 0.5);
    g.add(box('#e6e2da', [w, height, unitDepth - 0.02], [0, height / 2, z]));
    for (let drawer = 0; drawer < 3; drawer++) {
      const y = 0.25 + drawer * 0.4;
      g.add(box('#cfc9be', [0.01, 0.01, unitDepth - 0.08], [-w / 2 - 0.005, y + 0.19, z]));
      g.add(
        box(PALETTE.metal, [0.02, 0.03, 0.14], [-w / 2 - 0.012, y, z], { metalness: 0.4, roughness: 0.4 })
      );
    }
  }
  const top = plant(0.5, PALETTE.white, 21);
  top.position.set(0, height, -d / 2 + 0.3);
  g.add(top, box('#e7c77d', [0.3, 0.2, 0.4], [0, height + 0.1, d / 2 - 0.4]));
  return g;
}

function cafeCounter(itemDef: FurnitureItem): CoffeeMachine {
  const { w, d } = itemDef;
  const g = group(
    box(PALETTE.woodLight, [w, 0.86, d], [0, 0.45, 0]),
    box('#b58d62', [w - 0.02, 0.08, d - 0.08], [0, 0.04, 0]),
    box(PALETTE.white, [w + 0.04, 0.05, d + 0.04], [0, 0.905, 0], { roughness: 0.35 })
  );
  for (let i = 1; i < 5; i++)
    g.add(box('#b99870', [0.01, 0.72, 0.01], [-w / 2 + (i * w) / 5, 0.47, d / 2 + 0.005]));
  const machine = coffeeMachine();
  machine.group.position.set(1.4, 0.93, -0.05);
  g.add(machine.group);
  for (const [x, color] of [
    [0.9, PALETTE.white],
    [0.98, '#e8b04a'],
    [1.06, PALETTE.white]
  ] as const)
    g.add(cylinder(color, 0.04, 0.1, [x, 0.98, 0.12]));
  const herb = plant(0.45, PALETTE.white, 31);
  herb.position.set(-1.8, 0.93, -0.05);
  g.add(herb, cylinder('#d9c3a0', 0.08, 0.2, [-1.3, 1.03, -0.05]));
  return { group: g, light: machine.light, steam: machine.steam };
}

function cafeIsland(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const g = group(
    box(PALETTE.wood, [w, 0.98, d - 0.2], [0, 0.49, -0.1]),
    box(PALETTE.white, [w + 0.06, 0.05, d], [0, 1.0, 0], { roughness: 0.35 })
  );
  for (let i = 0; i < 14; i++)
    g.add(
      box(
        PALETTE.woodDark,
        [0.015, 0.9, 0.01],
        [-w / 2 + 0.1 + i * ((w - 0.2) / 13), 0.49, (d - 0.2) / 2 - 0.1 + 0.006]
      )
    );
  const fruit = group(
    cylinder(PALETTE.white, 0.14, 0.05, [0, 0.025, 0]),
    part(GEOMETRY.sphere, mat('#e8a33b'), [0.07, 0.07, 0.07], [0.04, 0.07, 0]),
    part(GEOMETRY.sphere, mat('#c9452f'), [0.07, 0.07, 0.07], [-0.04, 0.07, 0.03]),
    part(GEOMETRY.sphere, mat('#7fb24a'), [0.07, 0.07, 0.07], [0, 0.07, -0.05])
  );
  fruit.position.set(-0.6, 1.02, 0);
  const herb = plant(0.4, PALETTE.white, 41);
  herb.position.set(0.9, 1.02, -0.05);
  g.add(fruit, herb);
  return g;
}

function stool(): THREE.Group {
  const g = group(
    cylinder('#e6d8c3', 0.19, 0.06, [0, 0.72, 0]),
    cylinder(PALETTE.woodDark, 0.16, 0.02, [0, 0.68, 0])
  );
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(
      part(
        GEOMETRY.box,
        mat(PALETTE.woodDark),
        [0.03, 0.7, 0.03],
        [Math.sin(angle) * 0.13, 0.34, Math.cos(angle) * 0.13],
        [Math.cos(angle) * 0.06, 0, -Math.sin(angle) * 0.06]
      )
    );
  }
  g.add(part(GEOMETRY.box, mat(PALETTE.woodDark), [0.26, 0.02, 0.02], [0, 0.28, 0.1]));
  return g;
}

function cafeChair(): THREE.Group {
  const g = group(
    box(PALETTE.woodLight, [0.42, 0.04, 0.42], [0, 0.46, 0]),
    part(GEOMETRY.box, mat(PALETTE.woodLight), [0.4, 0.26, 0.04], [0, 0.72, -0.19], [-0.1, 0, 0])
  );
  for (const x of [-0.17, 0.17])
    for (const z of [-0.17, 0.17]) g.add(box(PALETTE.woodDark, [0.03, 0.46, 0.03], [x, 0.23, z]));
  return g;
}

function whiteboard(itemDef: FurnitureItem): THREE.Group {
  const { w } = itemDef;
  const random = seeded(itemDef.x + itemDef.z * 7);
  const g = group(
    box('#cfd3d8', [w, 1.15, 0.04], [0, 1.4, 0], { metalness: 0.3, roughness: 0.5 }),
    box(PALETTE.paper, [w - 0.06, 1.09, 0.01], [0, 1.4, 0.021], { roughness: 0.4 }),
    box('#cfd3d8', [w * 0.6, 0.03, 0.06], [0, 0.84, 0.04])
  );
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    g.add(box('#9aa1ab', [0.04, 0.84, 0.04], [x, 0.42, 0]));
    g.add(box('#9aa1ab', [0.06, 0.03, 0.5], [x, 0.015, 0]));
  }
  const notes = Math.round(w * 7);
  for (let i = 0; i < notes; i++) {
    const x = -w / 2 + 0.15 + random() * (w - 0.3);
    const y = 1.0 + random() * 0.75;
    g.add(box(NOTE_COLORS[i % NOTE_COLORS.length], [0.09, 0.09, 0.004], [x, y, 0.028]));
  }
  for (let i = 0; i < 5; i++)
    g.add(
      box(
        i % 2 ? '#3b6ff5' : '#2d3440',
        [0.15 + random() * 0.35, 0.012, 0.003],
        [-w / 2 + 0.3 + random() * (w - 0.8), 1.1 + random() * 0.6, 0.028]
      )
    );
  return g;
}

function wallScreen(itemDef: FurnitureItem): THREE.Group {
  const texture = new THREE.CanvasTexture(screenCanvas('data'));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1, 0.5);
  const display = part(
    GEOMETRY.plane,
    new THREE.MeshStandardMaterial({
      color: '#0b0f16',
      emissive: '#ffffff',
      emissiveMap: texture,
      emissiveIntensity: 0.5,
      roughness: 0.4
    }),
    [itemDef.w - 0.08, 1.12, 1],
    [0, 1.6, 0.03]
  );
  display.castShadow = false;
  return group(box(PALETTE.black, [itemDef.w, 1.2, 0.05], [0, 1.6, 0]), display);
}

function credenza(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const g = group(
    box(PALETTE.wood, [w, 0.72, d], [0, 0.38, 0]),
    box(PALETTE.woodLight, [w + 0.04, 0.04, d + 0.04], [0, 0.76, 0])
  );
  for (let i = 1; i < 6; i++)
    g.add(box(PALETTE.woodDark, [0.01, 0.62, 0.01], [-w / 2 + (i * w) / 6, 0.38, d / 2 + 0.005]));
  for (let i = 0; i < 3; i++) {
    const trough = box(PALETTE.white, [1.1, 0.16, 0.34], [-w / 2 + 0.9 + i * 1.9, 0.86, 0]);
    g.add(trough);
    for (let j = 0; j < 3; j++) {
      const bush = plant(0.5, PALETTE.white, i * 5 + j);
      bush.position.set(-w / 2 + 0.55 + i * 1.9 + j * 0.35, 0.8, 0);
      g.add(bush);
    }
  }
  return g;
}

/** The front desk: a wood cabinet, a work surface at desk height and a raised counter for visitors. */
function receptionDesk(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const g = group(
    box(PALETTE.woodLight, [w, 0.72, d * 0.55], [0, 0.36, -d * 0.2]),
    box(PALETTE.white, [w + 0.04, 0.04, d * 0.6], [0, 0.74, -d * 0.2]),
    box(PALETTE.wood, [w, 1.02, 0.12], [0, 0.51, d / 2 - 0.06]),
    box(PALETTE.white, [w + 0.08, 0.04, 0.3], [0, 1.04, d / 2 - 0.1])
  );
  for (let i = 1; i < 8; i++)
    g.add(box(PALETTE.woodDark, [0.012, 0.9, 0.012], [-w / 2 + (i * w) / 8, 0.48, d / 2 + 0.002]));
  return g;
}

function floorLamp(): THREE.Group {
  return group(
    cylinder(PALETTE.darkMetal, 0.16, 0.03, [0, 0.015, 0]),
    cylinder('#b8914f', 0.015, 1.7, [0, 0.85, 0], { metalness: 0.6, roughness: 0.35 }),
    part(
      GEOMETRY.cylinder,
      mat('#b8914f', { metalness: 0.6, roughness: 0.35 }),
      [0.03, 0.6, 0.03],
      [0.22, 1.82, 0],
      [0, 0, -1.1]
    ),
    part(GEOMETRY.sphere, lampGlow.floor(), [0.3, 0.22, 0.3], [0.48, 1.86, 0])
  );
}

function bench(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  return group(
    box(PALETTE.woodLight, [w, 0.06, d], [0, 0.42, 0]),
    box(PALETTE.fabricGray, [w - 0.06, 0.06, d - 0.1], [0, 0.48, 0]),
    box(PALETTE.woodDark, [w - 0.06, 0.4, 0.05], [0, 0.2, -d / 2 + 0.1]),
    box(PALETTE.woodDark, [w - 0.06, 0.4, 0.05], [0, 0.2, d / 2 - 0.1])
  );
}

function lowCabinet(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const g = group(box(PALETTE.wood, [w, 0.74, d], [0, 0.37, 0]));
  for (let i = 0; i < 3; i++) {
    const bush = plant(0.55, PALETTE.white, 51 + i);
    bush.position.set(0, 0.74, -d / 2 + 0.5 + i * ((d - 1) / 2));
    g.add(bush);
  }
  return g;
}

const rugMaterial = new THREE.MeshStandardMaterial({
  color: PALETTE.rug,
  roughness: 1,
  // Pulled toward the camera in the depth test so it never z-fights the floor beneath.
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2
});

function rug(itemDef: FurnitureItem): THREE.Mesh {
  const mesh = part(
    GEOMETRY.plane,
    rugMaterial,
    [itemDef.w, itemDef.d, 1],
    [0, 0.012, 0],
    [-Math.PI / 2, 0, 0]
  );
  mesh.castShadow = false;
  return mesh;
}

export interface BuiltFurniture {
  object: THREE.Object3D;
  /** Small emissive indicators the scene animates (coffee machine, printer). */
  light?: THREE.Mesh;
  /** Steam over a coffee machine, shown while it is in use. */
  steam?: THREE.Object3D;
}

export function buildFurniture(itemDef: FurnitureItem): BuiltFurniture {
  switch (itemDef.kind) {
    case 'rug':
      return { object: rug(itemDef) };
    case 'desk':
      return { object: deskTop(itemDef.w, itemDef.d) };
    case 'desk-pod':
      return { object: deskPod(itemDef) };
    case 'office-chair':
      return { object: officeChair() };
    case 'meeting-chair':
      return { object: meetingChair() };
    case 'armchair':
      return { object: armchair() };
    case 'sofa':
      return { object: sofa(itemDef) };
    case 'coffee-table':
      return { object: coffeeTable() };
    case 'side-table':
      return { object: sideTable() };
    case 'meeting-table':
      return { object: meetingTable(itemDef) };
    case 'round-table': {
      const g = roundTable(itemDef.w / 2, 0.74, PALETTE.woodLight);
      const centre = plant(0.35, PALETTE.white, 61);
      centre.position.y = 0.76;
      g.add(centre);
      return { object: g };
    }
    case 'bookshelf':
      return { object: bookshelf(itemDef) };
    case 'printer': {
      const built = printer();
      return { object: built.group, light: built.light };
    }
    case 'file-cabinet':
      return { object: fileCabinet(itemDef) };
    case 'cafe-counter': {
      const built = cafeCounter(itemDef);
      return { object: built.group, light: built.light, steam: built.steam };
    }
    case 'coffee-station': {
      const built = commons.coffeeStation(itemDef);
      return { object: built.group, light: built.light, steam: built.steam };
    }
    case 'cafe-island':
      return { object: cafeIsland(itemDef) };
    case 'stool':
      return { object: stool() };
    case 'cafe-table':
      return { object: roundTable(itemDef.w / 2, 0.74, PALETTE.white) };
    case 'cafe-chair':
      return { object: cafeChair() };
    case 'whiteboard':
      return { object: whiteboard(itemDef) };
    case 'wall-screen':
      return { object: wallScreen(itemDef) };
    case 'plant':
      return { object: plant(1, PALETTE.pot, Math.abs(itemDef.x * 13 + itemDef.z)) };
    case 'plant-large':
      return { object: largePlant(Math.abs(itemDef.x * 7 + itemDef.z * 3)) };
    case 'credenza':
      return { object: credenza(itemDef) };
    case 'floor-lamp':
      return { object: floorLamp() };
    case 'bench':
      return { object: bench(itemDef) };
    case 'low-cabinet':
      return { object: lowCabinet(itemDef) };
    case 'reception-desk':
      return { object: receptionDesk(itemDef) };
    case 'tree':
      return { object: props.tree(itemDef) };
    case 'bean-bag':
      return { object: props.beanBag(itemDef) };
    case 'ping-pong':
      return { object: props.pingPong(itemDef) };
    case 'server-rack':
      return { object: props.serverRack(itemDef) };
    case 'data-wall':
      return { object: props.dataWall(itemDef) };
    case 'kanban-board':
      return { object: props.kanbanBoard(itemDef) };
    case 'mood-board':
      return { object: props.moodBoard(itemDef) };
    case 'pinboard':
      return { object: props.pinboard(itemDef) };
    case 'drafting-table':
      return { object: props.draftingTable(itemDef) };
    case 'gong':
      return { object: props.gong(itemDef) };
    case 'trophy-shelf':
      return { object: props.trophyShelf(itemDef) };
    case 'water-cooler':
      return { object: props.waterCooler() };
    case 'planter':
      return { object: props.planter(itemDef) };
    case 'bookshelf-tall':
      return { object: commons.bookshelfTall(itemDef) };
    case 'cabinet-wall':
      return { object: commons.cabinetWall(itemDef) };
    case 'pastry-case':
      return { object: commons.pastryCase(itemDef) };
    case 'sorting-table':
      return { object: commons.sortingTable(itemDef) };
    case 'bike-rack':
      return { object: commons.bikeRack(itemDef) };
    case 'coat-rack':
      return { object: commons.coatRack() };
    case 'pendant-lamp':
      return { object: commons.pendantLamp() };
  }
}

/** Seat height by furniture kind, so people sit on the cushion rather than float or sink. */
export const SEAT_HEIGHT: Partial<Record<FurnitureItem['kind'], number>> = {
  'office-chair': 0.5,
  'meeting-chair': 0.49,
  armchair: 0.47,
  stool: 0.75,
  'cafe-chair': 0.48
};
export const SOFA_SEAT_HEIGHT = 0.45;

// ---------------------------------------------------------------- workstations

export interface Workstation {
  object: THREE.Group;
  displays: THREE.Mesh[];
}

const screenPlaceholder = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Where a screen goes. The room collects these and draws every screen as one instanced mesh per
 * style (see screens.ts), so the placeholder itself is never rendered.
 */
function display(width: number, height: number, flavor: ScreenFlavor): THREE.Mesh {
  const mesh = new THREE.Mesh(GEOMETRY.plane, screenPlaceholder);
  mesh.scale.set(width, height, 1);
  mesh.userData.dynamic = true;
  mesh.userData.screen = flavor;
  mesh.castShadow = false;
  return mesh;
}

function laptop(flavor: ScreenFlavor): {
  object: THREE.Group;
  display: THREE.Mesh;
} {
  const screen = display(0.3, 0.19, flavor);
  screen.position.set(0, 0.11, 0.007);
  const lid = group(
    box(PALETTE.metal, [0.34, 0.22, 0.012], [0, 0.11, 0], { metalness: 0.4, roughness: 0.35 }),
    screen
  );
  lid.position.set(0, 0.018, -0.115);
  lid.rotation.x = -0.28;
  const object = group(
    box(PALETTE.metal, [0.34, 0.018, 0.24], [0, 0.009, 0], { metalness: 0.4, roughness: 0.35 }),
    box('#3a4048', [0.3, 0.004, 0.11], [0, 0.02, 0.02]),
    lid
  );
  return { object, display: screen };
}

function monitor(flavor: ScreenFlavor): {
  object: THREE.Group;
  display: THREE.Mesh;
} {
  const screen = display(0.52, 0.3, flavor);
  screen.position.set(0, 0.37, 0.014);
  const object = group(
    box(PALETTE.darkMetal, [0.2, 0.015, 0.16], [0, 0.008, 0]),
    box(PALETTE.darkMetal, [0.035, 0.3, 0.025], [0, 0.16, -0.02]),
    box(PALETTE.black, [0.56, 0.34, 0.025], [0, 0.37, 0]),
    screen
  );
  return { object, display: screen };
}

function deskProp(prop: DeskProp, accent: string): THREE.Object3D {
  switch (prop) {
    case 'mug':
      return cylinder(accent, 0.038, 0.095, [0, 0.048, 0]);
    case 'notebook':
      return part(GEOMETRY.box, mat('#6d8b74'), [0.15, 0.012, 0.21], [0, 0.006, 0], [0, 0.3, 0]);
    case 'lamp':
      return group(
        cylinder(PALETTE.darkMetal, 0.06, 0.02, [0, 0.01, 0]),
        part(GEOMETRY.cylinder, mat(PALETTE.darkMetal), [0.018, 0.36, 0.018], [0, 0.18, 0], [0.25, 0, 0]),
        part(GEOMETRY.cone, lampGlow.desk(), [0.12, 0.09, 0.12], [0, 0.35, 0.08], [0.5, 0, 0])
      );
    case 'plant':
      return plant(0.3, PALETTE.white, 71);
    case 'folder':
      return part(GEOMETRY.box, mat('#e7c77d'), [0.22, 0.02, 0.3], [0, 0.01, 0], [0, -0.2, 0]);
    case 'books':
      return group(
        box('#3d5a80', [0.15, 0.03, 0.21], [0, 0.015, 0]),
        box('#e0b36a', [0.14, 0.03, 0.2], [0, 0.045, 0]),
        box('#b5838d', [0.13, 0.03, 0.19], [0, 0.075, 0])
      );
    case 'tablet':
      return group(
        box(PALETTE.black, [0.17, 0.01, 0.24], [0, 0.005, 0]),
        box('#9fb7ff', [0.15, 0.002, 0.21], [0, 0.011, 0], { emissive: '#7e9cff', emissiveIntensity: 0.4 })
      );
    case 'pen-cup':
      return group(
        cylinder(PALETTE.darkMetal, 0.03, 0.09, [0, 0.045, 0]),
        cylinder('#3b6ff5', 0.005, 0.14, [0.01, 0.1, 0]),
        cylinder('#ef4444', 0.005, 0.13, [-0.01, 0.1, 0.01])
      );
  }
}

/**
 * Laptop and/or monitor plus a few personal items, placed on the desk in front of a seat.
 * `facing` is the seated person's yaw; the screens face them.
 */
export function workstation(
  equipment: DeskEquipment,
  props: DeskProp[],
  flavor: ScreenFlavor,
  accent: string,
  surfaceY = 0.76
): Workstation {
  const g = new THREE.Group();
  const displays: Workstation['displays'] = [];
  // Local frame: the person sits at -z looking toward +z; screens face -z (toward them).
  if (equipment !== 'monitor') {
    const built = laptop(flavor);
    built.object.position.set(0, surfaceY, 0.5);
    built.object.rotation.y = Math.PI;
    g.add(built.object);
    displays.push(built.display);
  }
  if (equipment !== 'laptop') {
    const built = monitor(flavor);
    built.object.position.set(equipment === 'monitor' ? 0 : 0.12, surfaceY, 0.82);
    built.object.rotation.y = Math.PI;
    g.add(built.object);
    displays.push(built.display);
    if (equipment === 'monitor')
      g.add(
        box('#eceef1', [0.38, 0.015, 0.13], [0, surfaceY + 0.008, 0.48]),
        box('#eceef1', [0.06, 0.02, 0.1], [0.26, surfaceY + 0.01, 0.48])
      );
  }
  props.forEach((prop, index) => {
    const object = deskProp(prop, accent);
    const side = index % 2 === 0 ? -1 : 1;
    object.position.set(side * (0.38 + Math.floor(index / 2) * 0.16), surfaceY, 0.55 + (index % 3) * 0.06);
    g.add(object);
  });
  return { object: g, displays };
}
