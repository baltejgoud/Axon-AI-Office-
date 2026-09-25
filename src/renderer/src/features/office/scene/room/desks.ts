import * as THREE from 'three';
import type { DeskSetup, DeskProp, FurnitureItem } from '../../simulation/layout';
import { districtAt } from '../../campus/districts';
import { POD_DESK, equipmentPlacements, propPlacements, type Surface } from '../../campus/deskPlacement';
import { GEOMETRY, PALETTE, box, lampGlow, mat, part } from './materials';
import { hardwareFlavor, type DeskScreenApps, type ScreenApp } from './screenApps';
import { LOW, bevelBox, facetPart, group, lathe, noShadow, plant, seeded, tones } from './kit';

/**
 * Workstations: desk tops, pods, pedestals and cable trays, the computers on them and the personal
 * things around those. Builders are centred on the item's footprint at floor level, front facing +z,
 * like furniture.ts; `workstation` works in the seat's frame (the person at the origin looking +z).
 */

/** Top of every desk and pod. */
const SURFACE_Y = POD_DESK.top;
const TOP = 0.04;
const HANDLE = { metalness: 0.4, roughness: 0.45 } as const;
const PLASTIC = { roughness: 0.5 } as const;
const METAL = { metalness: 0.4, roughness: 0.35 } as const;

/** A district's colour at a point on the floor, for dividers, chairs and mouse pads. */
export function accentAt(x: number, z: number): string {
  return districtAt(x, z)?.color ?? PALETTE.wood;
}

/** Pale oak with a slim darker edge beneath, softly rounded. */
function top(w: number, d: number): THREE.Group {
  return group(
    bevelBox(PALETTE.woodLight, [w, TOP, d], [0, SURFACE_Y - TOP / 2, 0], 0.01, { roughness: 0.52 }),
    box(PALETTE.wood, [w - 0.04, 0.012, d - 0.04], [0, SURFACE_Y - TOP - 0.006, 0])
  );
}

/** A drawer pedestal: three drawers with bar handles on the side facing `face` (±1 along z, 0 both). */
function pedestal(x: number, z: number, depth: number, face: -1 | 0 | 1): THREE.Group {
  // Under the desk top, so it neither needs a bevel nor throws a shadow of its own.
  const g = noShadow(group(box(PALETTE.offWhite, [0.4, 0.56, depth], [0, 0.3, 0])));
  const sides = face === 0 ? [-1, 1] : [face];
  const drawers = group();
  for (const side of sides) {
    const front = side * (depth / 2 + 0.002);
    for (const y of [0.445, 0.31]) drawers.add(box('#d4cdc0', [0.37, 0.007, 0.004], [0, y, front]));
    for (const y of [0.5, 0.38, 0.2])
      drawers.add(box('#8f969f', [0.13, 0.016, 0.02], [0, y, front + side * 0.01], HANDLE));
  }
  g.add(noShadow(drawers));
  g.position.set(x, 0, z);
  return g;
}

/** A shallow metal tray under the desk carrying the cables, with a spine down to the floor. */
function cableTray(length: number, spineX: number): THREE.Group {
  const steel = '#6b727d';
  return noShadow(
    group(
      box(steel, [length, 0.01, 0.18], [0, 0.6, 0], METAL),
      box(steel, [length, 0.05, 0.01], [0, 0.625, -0.09], METAL),
      box(steel, [length, 0.05, 0.01], [0, 0.625, 0.09], METAL),
      box('#2b2f36', [length - 0.12, 0.022, 0.07], [0, 0.616, 0.015]),
      part(LOW.can, mat('#2b2f36'), [0.045, 0.6, 0.045], [spineX, 0.3, 0])
    )
  );
}

/** A pod of four: one long top, panel legs, pedestals, a cable tray and a divider in the district colour. */
export function deskPod(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const accent = tones(accentAt(item.x, item.z));
  const g = top(w, d);
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    g.add(
      noShadow(
        group(
          box(PALETTE.white, [0.05, SURFACE_Y - TOP, d - 0.2], [x, (SURFACE_Y - TOP) / 2, 0]),
          box(PALETTE.white, [0.07, 0.035, d - 0.1], [x, 0.0175, 0])
        )
      )
    );
  }
  for (const x of [-w / 2 + 0.35, w / 2 - 0.35])
    for (const side of [-1, 1] as const) g.add(pedestal(x, (side * d) / 4, 0.5, side));
  g.add(cableTray(w - 0.5, w / 2 - 0.45));
  if (item.id === 'pod-a') {
    // Planter spine down the middle, as in the reference.
    g.add(box(PALETTE.white, [w - 0.2, 0.2, 0.3], [0, SURFACE_Y + 0.1, 0]));
    for (let i = 0; i < 6; i++) {
      const bush = plant(0.55, PALETTE.white, i + 3);
      bush.position.set(-w / 2 + 0.35 + i * ((w - 0.7) / 5), SURFACE_Y + 0.02, 0);
      g.add(bush);
    }
    return g;
  }
  // The divider: a fabric panel in the district's colour on a white rail, clamped to the top.
  g.add(
    box(accent.light, [w - 0.14, 0.36, 0.03], [0, SURFACE_Y + 0.19, 0], { roughness: 0.95 }),
    box(PALETTE.white, [w - 0.08, 0.022, 0.045], [0, SURFACE_Y + 0.38, 0], PLASTIC),
    box(accent.dark, [w - 0.14, 0.012, 0.034], [0, SURFACE_Y + 0.012, 0], { roughness: 0.95 })
  );
  for (const x of [-w / 2 + 0.2, 0, w / 2 - 0.2])
    g.add(box('#9aa1ab', [0.04, 0.05, 0.07], [x, SURFACE_Y + 0.02, 0], HANDLE));
  return g;
}

/** A single desk in one of the Commons rooms: the same top, a slim leg frame and a pedestal. */
export function singleDesk(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = top(w, d);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05])
    for (const z of [-d / 2 + 0.05, d / 2 - 0.05])
      g.add(noShadow(box(PALETTE.white, [0.04, SURFACE_Y - TOP, 0.04], [x, (SURFACE_Y - TOP) / 2, z])));
  g.add(pedestal(w / 2 - 0.3, 0, d - 0.12, 0), cableTray(w - 0.7, -w / 2 + 0.3));
  return g;
}

// ---------------------------------------------------------------- computers

export interface Workstation {
  object: THREE.Group;
  displays: THREE.Mesh[];
}

const screenPlaceholder = new THREE.MeshBasicMaterial({ visible: false });

/**
 * Where a screen goes, and which app it shows. The room collects these and draws every screen as
 * one instanced mesh (see screens.ts), so the placeholder itself is never rendered.
 */
function display(width: number, height: number, app: ScreenApp, variant: 0 | 1): THREE.Mesh {
  const mesh = new THREE.Mesh(GEOMETRY.plane, screenPlaceholder);
  mesh.scale.set(width, height, 1);
  mesh.userData.dynamic = true;
  mesh.userData.screen = { app, variant };
  mesh.castShadow = false;
  return mesh;
}

/** A slim-bezel monitor on a neck and an oval foot, tipped back a little. Faces +z. */
function monitor(app: ScreenApp, variant: 0 | 1): { object: THREE.Group; display: THREE.Mesh } {
  const light = hardwareFlavor(app) === 'design';
  const casing = light ? '#d9dce1' : '#2a2f37';
  const screen = display(0.54, 0.3, app, variant);
  screen.position.set(0, 0.008, 0.0125);
  const head = group(
    bevelBox(casing, [0.56, 0.335, 0.024], [0, 0, 0], 0.008, PLASTIC),
    box(casing, [0.28, 0.18, 0.03], [0, -0.01, -0.024], PLASTIC),
    screen
  );
  head.position.set(0, 0.36, 0);
  head.rotation.x = -0.08;
  const stand = light ? '#c3c7cd' : '#3a3f47';
  const object = group(
    part(LOW.can, mat(stand, PLASTIC), [0.2, 0.012, 0.15], [0, 0.006, -0.02]),
    box(stand, [0.045, 0.25, 0.022], [0, 0.13, -0.045], PLASTIC),
    head
  );
  return { object, display: screen };
}

/**
 * A laptop, front (keys and trackpad) toward +z, lid open behind with the screen facing +z. On a
 * low riser when it is the only screen, on a tilted stand beside a monitor.
 */
function laptop(
  app: ScreenApp,
  variant: 0 | 1,
  raised: 'riser' | 'stand'
): { object: THREE.Group; display: THREE.Mesh } {
  const body = PALETTE.metal;
  const screen = display(0.29, 0.18, app, variant);
  screen.position.set(0, 0.108, 0.006);
  const lid = group(box(body, [0.32, 0.21, 0.009], [0, 0.105, 0], METAL), screen);
  lid.position.set(0, 0.014, -0.105);
  lid.rotation.x = -0.3;
  const keys = noShadow(
    group(
      box('#3a4048', [0.27, 0.002, 0.095], [0, 0.0145, -0.02]),
      box('#5b636e', [0.25, 0.002, 0.012], [0, 0.0158, -0.05]),
      box('#5b636e', [0.25, 0.002, 0.012], [0, 0.0158, -0.028]),
      box('#5b636e', [0.25, 0.002, 0.012], [0, 0.0158, -0.006]),
      box('#b8bdc4', [0.09, 0.002, 0.055], [0, 0.0145, 0.065])
    )
  );
  const machine = group(bevelBox(body, [0.32, 0.014, 0.22], [0, 0.007, 0], 0.004, METAL), keys, lid);
  const object = group(machine);
  if (raised === 'riser') {
    machine.position.y = 0.012;
    machine.rotation.x = 0.1;
    object.add(box('#3a3f47', [0.26, 0.022, 0.03], [0, 0.011, -0.085], PLASTIC));
  } else {
    // An aluminium stand: a plate tipped toward the person on a back riser and a front stop.
    machine.position.y = 0.074;
    machine.rotation.x = 0.3;
    object.add(
      part(GEOMETRY.box, mat('#aeb4bc', METAL), [0.24, 0.008, 0.2], [0, 0.066, 0], [0.3, 0, 0]),
      box('#aeb4bc', [0.24, 0.1, 0.012], [0, 0.05, -0.1], METAL),
      box('#aeb4bc', [0.24, 0.036, 0.012], [0, 0.018, 0.095], METAL)
    );
  }
  return { object, display: screen };
}

/** A keyboard with four rows of keys and a space bar nearest the person (toward -z). */
function keyboard(dark: boolean): THREE.Group {
  const base = dark ? '#2f343c' : '#e6e8eb';
  const key = dark ? '#505763' : '#c9cdd3';
  const g = group(bevelBox(base, [0.38, 0.016, 0.13], [0, 0.008, 0], 0.005, PLASTIC));
  for (let i = 0; i < 4; i++) g.add(box(key, [0.34, 0.005, 0.019], [0, 0.018, 0.045 - i * 0.024]));
  g.add(box(key, [0.15, 0.005, 0.017], [0, 0.018, -0.05]));
  return noShadow(g);
}

/** A mouse on a pad in the district's deep tone. */
function mouse(pad: string, dark: boolean): THREE.Group {
  return noShadow(
    group(
      box(pad, [0.19, 0.004, 0.16], [0, 0.002, 0], { roughness: 0.95 }),
      part(LOW.gem, mat(dark ? '#30353d' : '#eceef1', PLASTIC), [0.055, 0.032, 0.09], [0.01, 0.02, 0])
    )
  );
}

// ---------------------------------------------------------------- desk life

const NOTEBOOKS = ['#6d8b74', '#3d5a80', '#b5838d', '#e0b36a', '#8d6fb8'];
const BOTTLES = ['#3fa7a0', '#f6f5f2', '#aeb4bc', '#e98a6b', '#6e8fd8'];
const POT = [
  [0, 0],
  [0.03, 0],
  [0.036, 0.05],
  [0.04, 0.052],
  [0, 0.052]
] as const;

/** A tiny potted plant: three faceted tufts in a turned pot. */
function deskPlant(seed: number): THREE.Group {
  const random = seeded(seed);
  const g = group(lathe(POT, PALETTE.white, [0, 0, 0], 8, PLASTIC));
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + random();
    const size = 0.07 + random() * 0.03;
    g.add(
      facetPart(
        LOW.gem,
        ['#4f9a4a', '#5fae55', '#3f8541'][i],
        [size, size * 1.1, size],
        [Math.sin(angle) * 0.022, 0.085 + random() * 0.03, Math.cos(angle) * 0.022],
        [random(), random(), 0],
        seed + i
      )
    );
  }
  return g;
}

/** A succulent: a faceted rosette of fat leaves in a terracotta pot. */
function succulent(seed: number): THREE.Group {
  const random = seeded(seed);
  const g = group(lathe(POT, PALETTE.clay, [0, 0, 0], 8, { roughness: 0.8 }));
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + random() * 0.3;
    const reach = i === 6 ? 0 : 0.022;
    g.add(
      facetPart(
        LOW.gem,
        i === 6 ? '#8fb98a' : '#7aa37a',
        [0.028, 0.022, 0.05],
        [Math.sin(angle) * reach, 0.064, Math.cos(angle) * reach],
        [-0.5, angle, 0],
        seed * 3 + i,
        0.05
      )
    );
  }
  return g;
}

/** A rubber duck or a little robot, by seed. */
function figurine(accent: string, seed: number): THREE.Group {
  if (seed % 2)
    return group(
      facetPart(LOW.ball, '#f6c945', [0.06, 0.045, 0.075], [0, 0.024, 0], [0, 0, 0], seed),
      facetPart(LOW.ball, '#f6c945', [0.04, 0.04, 0.04], [0, 0.06, 0.02], [0, 0, 0], seed + 1),
      box('#e98a3b', [0.022, 0.008, 0.02], [0, 0.058, 0.045])
    );
  return group(
    box(accent, [0.04, 0.045, 0.03], [0, 0.03, 0], PLASTIC),
    box('#d9dce1', [0.036, 0.03, 0.03], [0, 0.07, 0], PLASTIC),
    box('#2b2f36', [0.026, 0.008, 0.002], [0, 0.072, 0.016]),
    part(LOW.gem, mat('#e24b4b', PLASTIC), [0.012, 0.012, 0.012], [0, 0.095, 0])
  );
}

function deskProp(prop: DeskProp, accent: string, seed: number): THREE.Object3D {
  const random = seeded(seed);
  switch (prop) {
    case 'mug':
      return group(
        lathe(
          [
            [0, 0],
            [0.034, 0],
            [0.04, 0.006],
            [0.042, 0.09],
            [0.037, 0.09],
            [0.035, 0.012],
            [0, 0.012]
          ],
          accent,
          [0, 0, 0],
          8,
          PLASTIC
        ),
        box(accent, [0.012, 0.05, 0.03], [0.047, 0.05, 0], PLASTIC),
        part(LOW.can, mat('#4a3122'), [0.07, 0.004, 0.07], [0, 0.08, 0])
      );
    case 'notebook':
      return group(
        box(NOTEBOOKS[Math.floor(random() * NOTEBOOKS.length)], [0.15, 0.014, 0.21], [0, 0.007, 0]),
        box(PALETTE.paper, [0.004, 0.01, 0.2], [0.074, 0.007, 0]),
        box('#2b2f36', [0.01, 0.016, 0.212], [0.05, 0.008, 0])
      );
    case 'lamp':
      return group(
        part(LOW.can, mat(PALETTE.darkMetal), [0.12, 0.02, 0.12], [0, 0.01, 0]),
        part(GEOMETRY.box, mat(PALETTE.darkMetal), [0.018, 0.36, 0.018], [0, 0.18, 0], [0.25, 0, 0]),
        part(GEOMETRY.cone, lampGlow.desk(), [0.12, 0.09, 0.12], [0, 0.35, 0.08], [0.5, 0, 0])
      );
    case 'plant':
      return deskPlant(seed);
    case 'folder':
      return group(
        box('#e7c77d', [0.22, 0.02, 0.3], [0, 0.01, 0]),
        box(PALETTE.paper, [0.2, 0.012, 0.28], [0.006, 0.013, 0])
      );
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
        lathe(
          [
            [0, 0],
            [0.03, 0],
            [0.03, 0.09],
            [0.027, 0.09],
            [0, 0.012]
          ],
          PALETTE.darkMetal,
          [0, 0, 0],
          8
        ),
        box('#3b6ff5', [0.008, 0.14, 0.008], [0.01, 0.1, 0]),
        box('#ef4444', [0.008, 0.13, 0.008], [-0.01, 0.095, 0.01]),
        box('#f6c945', [0.008, 0.12, 0.008], [0, 0.09, -0.012])
      );
    case 'headphones': {
      const phones = mat('#2b2f36', PLASTIC);
      const band = part(
        new THREE.TorusGeometry(0.07, 0.009, 4, 10, Math.PI),
        phones,
        [1, 1, 1],
        [0, 0.012, -0.01]
      );
      band.rotation.x = -Math.PI / 2;
      return group(
        band,
        part(LOW.can, phones, [0.075, 0.03, 0.075], [-0.07, 0.015, 0]),
        part(LOW.can, phones, [0.075, 0.03, 0.075], [0.07, 0.015, 0]),
        part(LOW.can, mat(accent, { roughness: 0.9 }), [0.055, 0.008, 0.055], [-0.07, 0.033, 0]),
        part(LOW.can, mat(accent, { roughness: 0.9 }), [0.055, 0.008, 0.055], [0.07, 0.033, 0])
      );
    }
    case 'bottle':
      return group(
        lathe(
          [
            [0, 0],
            [0.03, 0],
            [0.032, 0.01],
            [0.032, 0.17],
            [0.02, 0.2],
            [0, 0.2]
          ],
          BOTTLES[Math.floor(random() * BOTTLES.length)],
          [0, 0, 0],
          8,
          PLASTIC
        ),
        part(LOW.can, mat('#2b2f36', PLASTIC), [0.042, 0.03, 0.042], [0, 0.212, 0])
      );
    case 'photo': {
      const frame = random() < 0.5 ? PALETTE.woodDark : PALETTE.white;
      const picture = group(
        box(frame, [0.12, 0.09, 0.012], [0, 0, 0]),
        box('#9cc3e0', [0.1, 0.036, 0.002], [0, 0.017, 0.007]),
        box(
          ['#7fae6b', '#e0b36a', '#6d8fb0'][Math.floor(random() * 3)],
          [0.1, 0.034, 0.002],
          [0, -0.018, 0.007]
        ),
        box('#f6f5f2', [0.02, 0.02, 0.002], [0.025, 0.02, 0.0075])
      );
      picture.position.set(0, 0.048, 0);
      picture.rotation.x = -0.2;
      return group(picture, box(frame, [0.01, 0.07, 0.01], [0, 0.035, -0.03]));
    }
    case 'sticky-notes':
      return group(
        box('#ffe08a', [0.075, 0.02, 0.075], [0, 0.01, 0]),
        part(GEOMETRY.box, mat('#ffb4c8'), [0.07, 0.002, 0.07], [0.012, 0.021, 0.004], [0, 0.3, 0]),
        part(GEOMETRY.box, mat('#a7d8ff'), [0.07, 0.002, 0.07], [-0.008, 0.023, -0.006], [0, -0.25, 0])
      );
    case 'succulent':
      return succulent(seed);
    case 'figurine':
      return figurine(accent, Math.floor(seed));
  }
}

/**
 * The screens, keyboard, mouse and personal things on one desk, in the seat's frame: the person
 * sits at the origin looking toward +z. Screens turn to face them and show the owner's apps: a
 * laptop beside a monitor, or the right of two monitors, is the second screen.
 */
export function workstation(setup: DeskSetup, surface: Surface, screens: DeskScreenApps): Workstation {
  const g = new THREE.Group();
  const displays: THREE.Mesh[] = [];
  const flavor = hardwareFlavor(screens.main);
  const accent = setup.accent ?? PALETTE.white;
  const dark = flavor === 'code' || flavor === 'data';
  const appOf = (item: string): ScreenApp =>
    item === 'monitor-right' || (item === 'laptop' && setup.equipment === 'laptop-monitor')
      ? (screens.second ?? screens.main)
      : screens.main;
  const y = surface.top;
  for (const placement of equipmentPlacements(setup.equipment, surface)) {
    let object: THREE.Object3D;
    switch (placement.item) {
      case 'laptop': {
        const built = laptop(
          appOf('laptop'),
          screens.variant,
          setup.equipment === 'laptop' ? 'riser' : 'stand'
        );
        displays.push(built.display);
        object = built.object;
        object.rotation.y = Math.PI - placement.turn;
        break;
      }
      case 'keyboard':
        object = keyboard(dark);
        break;
      case 'mouse':
        object = mouse(tones(accent).dark, dark);
        break;
      default: {
        const built = monitor(appOf(placement.item), screens.variant);
        displays.push(built.display);
        object = built.object;
        object.rotation.y = Math.PI - placement.turn;
      }
    }
    object.position.set(placement.x, y, placement.z);
    g.add(object);
  }
  let seed = 0;
  for (const letter of setup.poiId) seed = (seed * 31 + letter.charCodeAt(0)) % 100003;
  propPlacements(setup.equipment, setup.props, surface).forEach((placement, index) => {
    const object = noShadow(deskProp(placement.item as DeskProp, accent, seed + index * 17 + 1));
    object.position.set(placement.x, y, placement.z);
    object.rotation.y = placement.item === 'photo' ? Math.PI + placement.turn : placement.turn;
    g.add(object);
  });
  return { object: g, displays };
}
