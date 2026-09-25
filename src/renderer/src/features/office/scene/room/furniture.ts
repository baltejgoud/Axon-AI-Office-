import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, cylinder, lampGlow, mat, part, screenCanvas } from './materials';
import * as commons from './commonsProps';
import * as exec from './executive';
import * as props from './props';
import { GREENS, bevelBox, bookshelf, paintedBox, group, largePlant, plant, pottedTuft, seeded } from './kit';
import { districtAt } from '../../campus/districts';
import { accentAt, deskPod, singleDesk } from './desks';
import { SINGLE_DESK } from '../../campus/deskPlacement';
import { ergonomicChair } from './chairs';
import { bakeryCounter, coffeeBar } from './cafe';
import { openKitchen, type KitchenFx } from './kitchen';
import { cupOfCoffee, servedPlate } from './food';
import { dogBed, mediaConsole, type MediaWall } from './lounge';
import * as play from './playProps';
import { officeModel, type ModelId } from './models';
import type { RodSlot } from './playProps';

export { largePlant, plant };

/**
 * Low-poly furniture built from primitives. Each builder returns a group centred on the item's
 * footprint at floor level, with its front (and a seated person's view) facing local +z.
 */

const NOTE_COLORS = ['#ffe08a', '#ffb4c8', '#a7d8ff', '#b9f0c0'];

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

/**
 * Sofa fabrics: teal, rust, denim and olive, with cushions and throws that pick each other out.
 * Sofas within the same 10 m square share a fabric, so a room's seating matches; the Lounge's U
 * spans two squares, so its three sofas are named together.
 */
const SOFA_FABRICS = [
  { body: '#4f8a8b', seat: '#5e9a9b', throws: ['#e9b949', '#f1e6d2'] },
  { body: '#b8663f', seat: '#c7774f', throws: ['#f1e6d2', '#4f8a8b'] },
  { body: '#56709a', seat: '#6682ab', throws: ['#e9b949', '#e98a6b'] },
  { body: '#7d8a4f', seat: '#8d9a5d', throws: ['#f1e6d2', '#b8663f'] }
] as const;

function sofa(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const fabric = fabricFor(itemDef);
  const g = group(
    paintedBox(fabric.body, [w, 0.3, d], [0, 0.2, 0], 0.05),
    paintedBox(fabric.body, [w, 0.72, 0.22], [0, 0.48, -d / 2 + 0.11], 0.06),
    paintedBox(fabric.body, [0.2, 0.56, d], [-w / 2 + 0.1, 0.3, 0], 0.06),
    paintedBox(fabric.body, [0.2, 0.56, d], [w / 2 - 0.1, 0.3, 0], 0.06),
    box(PALETTE.woodDark, [0.05, 0.06, 0.05], [-w / 2 + 0.1, 0.03, d / 2 - 0.1]),
    box(PALETTE.woodDark, [0.05, 0.06, 0.05], [w / 2 - 0.1, 0.03, d / 2 - 0.1])
  );
  const cushions = 3;
  const cushionWidth = (w - 0.44) / cushions;
  for (let i = 0; i < cushions; i++)
    g.add(
      paintedBox(
        fabric.seat,
        [cushionWidth - 0.03, 0.12, d - 0.3],
        [-w / 2 + 0.22 + cushionWidth * (i + 0.5), 0.4, 0.08],
        0.04
      )
    );
  const pillow = (color: string, x: number, turn: number) => {
    const mesh = paintedBox(color, [0.38, 0.34, 0.12], [x, 0.62, -d / 2 + 0.3], 0.05);
    mesh.rotation.set(-0.25, turn, 0);
    return mesh;
  };
  g.add(pillow(fabric.throws[0], -w / 2 + 0.5, 0.2), pillow(fabric.throws[1], w / 2 - 0.5, -0.2));
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
  const bowl = pottedTuft(0.9, PALETTE.white, 11);
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

/** Rugs take a soft tint of their district's colour: a light field with a deeper border. */
function rugTones(x: number, z: number): { field: string; border: string } {
  const district = districtAt(x, z);
  const base = new THREE.Color(RUG_BASE);
  if (!district) return { field: RUG_BASE, border: '#d9d2c6' };
  const tint = new THREE.Color(district.color);
  return {
    field: `#${base.clone().lerp(tint, 0.16).getHexString()}`,
    border: `#${base.clone().lerp(tint, 0.34).getHexString()}`
  };
}
const RUG_BASE = '#ece6dc';
/** Floors are pulled toward the camera by 1 in the depth test; rugs by more, so they show from afar. */
const RUG_PULL = 2;

/** A low, soft-edged rug with a border. */
function rug(itemDef: FurnitureItem): THREE.Group {
  const { w, d } = itemDef;
  const tones = rugTones(itemDef.x, itemDef.z);
  // Pulled forward in the depth test like the flat rugs were, or the floor beneath wins from afar.
  const border = paintedBox(tones.border, [w, 0.016, d], [0, 0.008, 0], 0.008, 1, RUG_PULL);
  const field = paintedBox(tones.field, [w - 0.18, 0.006, d - 0.18], [0, 0.015, 0], 0.003, 1, RUG_PULL + 1);
  border.castShadow = field.castShadow = false;
  return group(border, field);
}

export interface BuiltFurniture {
  object: THREE.Object3D;
  /** Small emissive indicators the scene animates (coffee machine, printer). */
  light?: THREE.Mesh;
  /** Steam over a coffee machine, shown while it is in use. */
  steam?: THREE.Object3D;
  /** Several machines on one counter, each busy while its own spots are taken. */
  machines?: { light: THREE.Mesh; steam: THREE.Object3D; spots: string[] }[];
  /** The kitchen's flames, steam and pan, driven by the chefs. */
  kitchen?: KitchenFx;
  /** The lounge TV, its controllers and the record player. */
  media?: MediaWall;
  /** The sleeping dog, which breathes. */
  dog?: THREE.Mesh;
  /** A foosball table's rods, drawn by the shared instanced rods. */
  foosball?: readonly RodSlot[];
}

// ---------------------------------------------------------------- downloaded models
// Each falls back to the code-built piece when its model has not loaded.

const FRAME = '#2f343b';
const STEEL = { color: '#9aa1ab', metalness: 0.45, roughness: 0.4 };

/** The desk chair, its fabric in the district's colour. */
function officeChair(accent: string): THREE.Group {
  return (
    officeModel('office-chair', {
      w: 0.62,
      d: 0.62,
      seat: SEAT_HEIGHT['office-chair'],
      mode: 'seat',
      paint: { Chair: accent, Black: FRAME, Grey: STEEL },
      // As with the code-built chair, only the seat and back throw shadows: the base and casters
      // are 90% of its triangles and their shadows are lost under the desk.
      shadows: ['Chair']
    }) ?? ergonomicChair(accent)
  );
}

/** Sofas and armchairs share the room's fabric (see SOFA_FABRICS). */
function fabricFor(item: FurnitureItem) {
  const lounge = item.id === 'sofa' || item.id.startsWith('sofa-');
  const room = lounge ? 0 : Math.floor((item.x + 100) / 10) * 7 + Math.floor((item.z + 100) / 10) * 3;
  return SOFA_FABRICS[room % SOFA_FABRICS.length];
}

function sofaModel(item: FurnitureItem): THREE.Group | null {
  const fabric = fabricFor(item);
  return officeModel('couch-medium-teal', {
    w: item.w,
    d: item.d,
    seat: SOFA_SEAT_HEIGHT,
    paint: { Couch_Blue: fabric.body, Black: PALETTE.woodDark }
  });
}

function armchairModel(item: FurnitureItem): THREE.Group | null {
  return officeModel('armchair-teal', {
    w: item.w,
    d: item.d,
    seat: SEAT_HEIGHT.armchair,
    paint: { Couch_Blue: PALETTE.fabricBlue, Black: PALETTE.woodDark }
  });
}

/** Pots in the office's white or clay, leaves in its greens: the same plants, but ours. */
function pottedModel(
  ids: readonly ModelId[],
  seed: number,
  fit: { w: number; h: number }
): THREE.Group | null {
  const random = seeded(seed);
  const id = ids[Math.floor(random() * ids.length)];
  const pot = random() < 0.7 ? PALETTE.pot : PALETTE.clay;
  const leaf = GREENS[Math.floor(random() * GREENS.length)];
  const g = officeModel(id, {
    w: fit.w,
    d: fit.w,
    h: fit.h * (0.85 + random() * 0.3),
    mode: 'inside',
    paint: { Black: pot, Grey: pot, Plant_Green: leaf, DarkGreen: GREENS[0], Brown: '#5b4636' }
  });
  if (g) g.rotation.y = random() * Math.PI * 2;
  return g;
}

const SMALL_PLANTS: readonly ModelId[] = [
  'plant-broadleaf',
  'plant-monstera-small',
  'plant-cactus-pot',
  'plant-snake'
];
const LARGE_PLANTS: readonly ModelId[] = ['plant-banana', 'plant-monstera', 'plant-snake', 'cactus'];
/** Only the broad-leaved ones grow into indoor trees; a 2.5 m snake plant or cactus looks wrong. */
const TREES: readonly ModelId[] = ['plant-banana', 'plant-monstera'];

/** A single desk: light wood on white drawers, a lamp at the back corner. */
function deskModel(item: FurnitureItem): THREE.Group | null {
  const desk = officeModel('desk', {
    w: item.w,
    d: item.d,
    h: SINGLE_DESK.top,
    paint: { Wood: PALETTE.woodLight, DarkWood: PALETTE.white }
  });
  if (!desk) return null;
  const lamp = officeModel('desk-lamp', {
    w: 0.3,
    d: 0.3,
    h: 0.42,
    mode: 'inside',
    paint: { Black: PALETTE.darkMetal, LightMetal: STEEL, White: '#f6ead0' },
    shadows: false
  });
  if (lamp) {
    lamp.position.set(item.w / 2 - 0.18, SINGLE_DESK.top, -item.d / 2 + 0.16);
    lamp.rotation.y = -0.6;
    desk.add(lamp);
  }
  return desk;
}

function stoolModel(): THREE.Group | null {
  return officeModel('bar-stool', {
    w: 0.44,
    d: 0.44,
    seat: SEAT_HEIGHT.stool,
    squeeze: 0.55,
    paint: { Wood: PALETTE.woodDark, Cushin: '#e6d8c3' }
  });
}

/** A low round table with a couple of books and a bowl on it. */
function coffeeTableModel(): THREE.Group | null {
  const table = officeModel('table-round-small', {
    w: 0.9,
    d: 0.9,
    h: 0.42,
    paint: { Wood: PALETTE.woodLight }
  });
  if (!table) return null;
  table.add(
    box('#8d99ae', [0.2, 0.03, 0.26], [0.1, 0.435, 0.05]),
    box('#e0b36a', [0.18, 0.03, 0.24], [0.1, 0.465, 0.05])
  );
  const bowl = pottedTuft(0.9, PALETTE.white, 11);
  bowl.position.set(-0.15, 0.42, -0.1);
  table.add(bowl);
  return table;
}

export function buildFurniture(itemDef: FurnitureItem): BuiltFurniture {
  switch (itemDef.kind) {
    case 'rug':
      return { object: rug(itemDef) };
    case 'desk':
      return { object: deskModel(itemDef) ?? singleDesk(itemDef) };
    case 'desk-pod':
      return { object: deskPod(itemDef) };
    case 'office-chair':
      return { object: officeChair(accentAt(itemDef.x, itemDef.z)) };
    case 'meeting-chair':
      return { object: meetingChair() };
    case 'armchair':
      return { object: armchairModel(itemDef) ?? armchair() };
    case 'sofa':
      return { object: sofaModel(itemDef) ?? sofa(itemDef) };
    case 'coffee-table':
      return { object: coffeeTableModel() ?? coffeeTable() };
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
    case 'coffee-bar': {
      const built = coffeeBar(itemDef);
      return { object: built.group, machines: built.machines };
    }
    case 'bakery-counter':
      return { object: bakeryCounter(itemDef) };
    case 'media-console': {
      const built = mediaConsole(itemDef);
      return { object: built.group, media: built.media };
    }
    case 'foosball': {
      const built = play.foosballTable(itemDef);
      return { object: built.group, foosball: built.rods };
    }
    case 'arcade':
      return { object: play.arcadeCabinet(itemDef) };
    case 'dartboard':
      return { object: play.dartboard(itemDef) };
    case 'vending-machine':
      return { object: play.vendingMachine(itemDef) };
    case 'snack-shelf':
      return { object: play.snackShelf(itemDef) };
    case 'tv-corner':
      return { object: play.tvCorner(itemDef) };
    case 'dog-bed': {
      const built = dogBed(itemDef);
      return { object: built.group, dog: built.dog };
    }
    case 'open-kitchen': {
      const built = openKitchen(itemDef);
      return { object: built.group, kitchen: built.fx };
    }
    case 'sign-post':
      return { object: props.signPost() };
    case 'exec-desk':
      return { object: exec.execDesk(itemDef) };
    case 'exec-chair':
      return { object: exec.execChair() };
    case 'exec-credenza':
      return { object: exec.execCredenza(itemDef) };
    case 'wall-art':
      return { object: exec.wallArt(itemDef) };
    case 'ledge-art':
      return { object: exec.ledgeArt(itemDef) };
    case 'exec-rug':
      return { object: exec.execRug(itemDef) };
    case 'coffee-station': {
      const built = commons.coffeeStation(itemDef);
      return { object: built.group, light: built.light, steam: built.steam };
    }
    case 'cafe-island':
      return { object: cafeIsland(itemDef) };
    case 'stool':
      return { object: stoolModel() ?? stool() };
    case 'cafe-table': {
      const table = roundTable(itemDef.w / 2, 0.74, PALETTE.white);
      // Every other table has someone's plate and cup left on it.
      const index = Number(itemDef.id.split('-').pop());
      if (index % 2 === 1) {
        const dish = servedPlate(index);
        dish.position.set(-0.12, 0.76, 0.08);
        const cup = cupOfCoffee();
        cup.position.set(0.16, 0.76, -0.1);
        table.add(dish, cup);
      }
      return { object: table };
    }
    case 'cafe-chair':
      return { object: cafeChair() };
    case 'whiteboard':
      return { object: whiteboard(itemDef) };
    case 'wall-screen':
      return { object: wallScreen(itemDef) };
    case 'plant':
      return {
        object:
          pottedModel(SMALL_PLANTS, Math.abs(itemDef.x * 13 + itemDef.z), { w: 0.7, h: 0.8 }) ??
          plant(1, PALETTE.pot, Math.abs(itemDef.x * 13 + itemDef.z))
      };
    case 'plant-large':
      return {
        object:
          pottedModel(LARGE_PLANTS, Math.abs(itemDef.x * 7 + itemDef.z * 3), { w: 1.2, h: 1.6 }) ??
          largePlant(Math.abs(itemDef.x * 7 + itemDef.z * 3))
      };
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
      return {
        object:
          pottedModel(TREES, Math.abs(itemDef.x * 5 + itemDef.z * 11), { w: 2.2, h: 2.6 }) ??
          props.tree(itemDef)
      };
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
  'exec-chair': 0.5,
  'meeting-chair': 0.49,
  armchair: 0.47,
  stool: 0.75,
  'cafe-chair': 0.48
};
export const SOFA_SEAT_HEIGHT = 0.45;
