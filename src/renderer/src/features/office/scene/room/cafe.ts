import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, mat, part } from './materials';
import { LOW, bevelBox, group, lathe, noShadow, plant } from './kit';
import {
  baguette,
  breadBasket,
  cakeOnStand,
  cookie,
  croissant,
  cupcake,
  doughnut,
  loaf,
  muffin,
  plate
} from './food';

/**
 * The café's coffee bar and bakery counter. The bar's counter keeps the old front line; behind it
 * a slatted mat marks the barista's strip. Espresso machines face the barista, so the café sees
 * their painted backs, the cups warming on top and the steam. Centred on the footprint at floor
 * level, the café side toward +z.
 */

const METAL = { metalness: 0.5, roughness: 0.3 } as const;
const COUNTER_TOP = 0.955;

const steamMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.5,
  depthWrite: false
});

/** Puffs of steam above a spout, animated by `animateSteam` while the machine is in use. */
export function steamPuffs(y: number, count = 3, size = 0.06): THREE.Group {
  const steam = group();
  for (let i = 0; i < count; i++) {
    const puff = part(GEOMETRY.lowSphere, steamMaterial, [size, size, size], [0, 0, 0]);
    puff.castShadow = false;
    puff.receiveShadow = false;
    puff.userData.dynamic = true;
    puff.userData.phase = i / count;
    steam.add(puff);
  }
  steam.position.y = y;
  steam.visible = false;
  return steam;
}

export interface EspressoMachine {
  group: THREE.Group;
  light: THREE.Mesh;
  steam: THREE.Group;
}

/** A two-group espresso machine in steel with a coloured band, cups warming on top. Faces +z. */
export function espressoMachine(band: string): EspressoMachine {
  const light = part(
    GEOMETRY.sphere,
    new THREE.MeshStandardMaterial({ color: '#5a3d12', emissive: '#f59e0b', emissiveIntensity: 0.4 }),
    [0.035, 0.035, 0.035],
    [0.2, 0.43, -0.12]
  );
  light.userData.dynamic = true;
  const steam = steamPuffs(0.5);
  steam.position.z = 0.1;
  const g = group(
    bevelBox('#c9ced4', [0.56, 0.36, 0.42], [0, 0.22, 0], 0.02, METAL),
    box(band, [0.54, 0.09, 0.43], [0, 0.31, 0], { roughness: 0.4 }),
    box('#2b2f36', [0.5, 0.02, 0.36], [0, 0.41, 0]),
    box('#2b2f36', [0.5, 0.035, 0.13], [0, 0.055, 0.2]),
    box('#9aa1ab', [0.46, 0.012, 0.11], [0, 0.074, 0.2], METAL)
  );
  // Feet, the two group heads with their portafilters, a gauge and the steam wand.
  const details = group();
  for (const x of [-0.24, 0.24]) details.add(box('#2b2f36', [0.05, 0.04, 0.05], [x, 0.02, -0.16]));
  for (const x of [-0.12, 0.12]) {
    details.add(part(LOW.can, mat('#9aa1ab', METAL), [0.07, 0.05, 0.07], [x, 0.2, 0.22]));
    details.add(box('#1f2328', [0.03, 0.025, 0.14], [x, 0.17, 0.3]));
  }
  details.add(
    part(LOW.can, mat('#f4f1ec'), [0.06, 0.012, 0.06], [0, 0.3, 0.215], [Math.PI / 2, 0, 0]),
    box('#9aa1ab', [0.012, 0.16, 0.012], [0.26, 0.16, 0.2], METAL)
  );
  // Cups warming on top.
  for (const [x, z] of [
    [-0.15, -0.08],
    [-0.05, -0.08],
    [0.05, -0.08],
    [-0.1, 0.06]
  ] as const)
    details.add(part(LOW.can, mat('#f7f5f0', { roughness: 0.3 }), [0.06, 0.05, 0.06], [x, 0.445, z]));
  g.add(noShadow(details), light, steam);
  return { group: g, light, steam };
}

/** A coffee grinder: a dark base and a hopper of beans. */
function grinder(): THREE.Group {
  return group(
    bevelBox('#2f343b', [0.16, 0.22, 0.2], [0, 0.11, 0], 0.012, { roughness: 0.5 }),
    lathe(
      [
        [0.03, 0.22],
        [0.09, 0.3],
        [0.09, 0.4],
        [0, 0.4]
      ],
      '#6b4630',
      [0, 0, 0],
      8,
      { roughness: 0.6 }
    ),
    part(LOW.can, mat('#2f343b'), [0.19, 0.02, 0.19], [0, 0.41, 0])
  );
}

/** Cups stacked in two towers on a tray. */
function cupTower(): THREE.Group {
  const g = group(box('#9aa1ab', [0.24, 0.012, 0.14], [0, 0.006, 0], METAL));
  for (const x of [-0.055, 0.055])
    for (let i = 0; i < 5; i++)
      g.add(part(LOW.can, mat('#f7f5f0', { roughness: 0.3 }), [0.08, 0.035, 0.08], [x, 0.03 + i * 0.03, 0]));
  return g;
}

/** Four syrup bottles with pumps. */
function syrups(): THREE.Group {
  const g = group();
  ['#c77d2e', '#b3282d', '#6e8b3d', '#5b3a24'].forEach((color, i) => {
    g.add(
      lathe(
        [
          [0, 0],
          [0.032, 0],
          [0.032, 0.2],
          [0.014, 0.24],
          [0, 0.24]
        ],
        color,
        [i * 0.075, 0, 0],
        8,
        { roughness: 0.25 }
      ),
      box('#2b2f36', [0.012, 0.06, 0.012], [i * 0.075, 0.27, 0]),
      box('#2b2f36', [0.03, 0.01, 0.012], [i * 0.075 + 0.01, 0.3, 0])
    );
  });
  return g;
}

/** A chalk menu on a little easel: scribbled lines and a coffee-cup doodle, no readable text. */
function menuBoard(): THREE.Group {
  const board = group(
    box(PALETTE.woodDark, [0.64, 0.48, 0.03], [0, 0, 0]),
    box('#2b312d', [0.58, 0.42, 0.01], [0, 0, 0.018], { roughness: 0.9 })
  );
  const chalk = [
    [-0.12, 0.14, 0.26],
    [-0.14, 0.08, 0.22],
    [-0.1, 0.02, 0.3],
    [-0.13, -0.04, 0.24],
    [-0.11, -0.1, 0.28],
    [-0.14, -0.16, 0.2]
  ] as const;
  for (const [x, y, w] of chalk) board.add(box('#f1efe8', [w, 0.012, 0.004], [x, y, 0.024]));
  for (const [y, color] of [
    [0.14, '#f6c945'],
    [0.02, '#f2a6c1'],
    [-0.1, '#8fd0c9']
  ] as const)
    board.add(box(color, [0.04, 0.012, 0.004], [0.2, y, 0.024]));
  board.add(
    part(LOW.can, mat('#f1efe8'), [0.1, 0.004, 0.08], [0.17, -0.02, 0.024], [Math.PI / 2, 0, 0]),
    box('#f1efe8', [0.03, 0.04, 0.004], [0.23, -0.02, 0.024])
  );
  board.position.set(0, 0.3, 0);
  board.rotation.x = -0.12;
  return group(board, box(PALETTE.woodDark, [0.04, 0.12, 0.08], [0, 0.04, -0.04]));
}

export interface CoffeeBar {
  group: THREE.Group;
  /** Machine A serves the two east pickups, machine B the west one. */
  machines: { light: THREE.Mesh; steam: THREE.Group; spots: string[] }[];
}

/** The coffee bar: a walnut counter with a stone top, two machines and everything round them. */
export function coffeeBar(item: FurnitureItem): CoffeeBar {
  const { w, d } = item;
  const counter = 0.65;
  const front = d / 2;
  const cz = front - counter / 2;
  const g = group(
    bevelBox('#8a5a3c', [w, 0.9, counter - 0.04], [0, 0.45, cz - 0.02], 0.015),
    bevelBox('#f2eee6', [w + 0.06, 0.05, counter + 0.06], [0, COUNTER_TOP - 0.025, cz], 0.012, {
      roughness: 0.35
    }),
    box('#3a2c24', [w - 0.04, 0.08, 0.02], [0, 0.04, front - 0.03])
  );
  // Slatted front, a brass foot rail and the barista's mat behind.
  const trim = group();
  for (let x = -w / 2 + 0.12; x < w / 2 - 0.05; x += 0.2)
    trim.add(box('#a7744f', [0.1, 0.72, 0.012], [x, 0.49, front - 0.035]));
  trim.add(
    part(LOW.can, mat('#b8914f', METAL), [0.035, w - 0.3, 0.035], [0, 0.2, front + 0.07], [0, 0, Math.PI / 2])
  );
  for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3])
    trim.add(box('#b8914f', [0.025, 0.025, 0.1], [x, 0.2, front + 0.02], METAL));
  const strip = d - counter;
  trim.add(box('#3a3430', [w - 0.2, 0.02, strip - 0.08], [0, 0.01, -d / 2 + strip / 2]));
  for (let x = -w / 2 + 0.2; x < w / 2 - 0.1; x += 0.12)
    trim.add(box('#2a2522', [0.02, 0.022, strip - 0.1], [x, 0.012, -d / 2 + strip / 2]));
  g.add(noShadow(trim));

  const top = (object: THREE.Object3D, x: number, z: number, turn = 0) => {
    object.position.set(x, COUNTER_TOP, z);
    object.rotation.y = turn;
    g.add(object);
    return object;
  };
  const a = espressoMachine('#b8453a');
  const b = espressoMachine('#2f6f68');
  top(a.group, 1.2, cz - 0.05, Math.PI);
  top(b.group, -1.1, cz - 0.05, Math.PI);
  top(grinder(), 0.15, cz - 0.1);
  top(noShadow(cupTower()), 1.9, cz);
  top(noShadow(syrups()), -0.42, cz - 0.18);
  top(menuBoard(), -1.95, cz - 0.12);
  // A tip jar, a napkin box and a sprig of herbs by the pickups.
  top(
    noShadow(
      lathe(
        [
          [0, 0],
          [0.045, 0],
          [0.045, 0.1],
          [0.04, 0.11],
          [0, 0.11]
        ],
        PALETTE.glass,
        [0, 0, 0],
        8,
        { roughness: 0.1 }
      )
    ),
    0.62,
    cz + 0.2
  );
  top(noShadow(box('#e9e4db', [0.12, 0.08, 0.07], [0, 0.04, 0])), 0.8, cz + 0.2);
  const herb = plant(0.4, PALETTE.white, 31);
  top(herb, -1.55, cz + 0.12);
  return {
    group: g,
    machines: [
      { light: a.light, steam: a.steam, spots: ['cafe-machine', 'cafe-counter-1'] },
      { light: b.light, steam: b.steam, spots: ['cafe-counter-2'] }
    ]
  };
}

/** The bakery counter: a glass case of pastries, a cake on its stand and a basket of bread. */
export function bakeryCounter(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const height = 0.9;
  const g = group(
    bevelBox('#efe7da', [w, height, d], [0, height / 2, 0], 0.015),
    box('#a7744f', [w - 0.06, 0.62, 0.012], [0, 0.46, d / 2 + 0.002]),
    box('#3a2c24', [w - 0.04, 0.08, 0.02], [0, 0.04, d / 2 - 0.01])
  );
  // The glass case over the left two thirds.
  const caseW = w * 0.64;
  const caseX = -w / 2 + caseW / 2 + 0.02;
  const glass = part(
    GEOMETRY.box,
    mat(PALETTE.glass, { transparent: true, opacity: 0.25, roughness: 0.1 }),
    [caseW, 0.42, d - 0.08],
    [caseX, height + 0.21, 0]
  );
  glass.castShadow = false;
  glass.renderOrder = 1;
  g.add(
    glass,
    box(PALETTE.white, [caseW, 0.02, d - 0.1], [caseX, height + 0.2, 0]),
    box(PALETTE.woodDark, [caseW + 0.02, 0.02, d - 0.06], [caseX, height + 0.43, 0])
  );
  for (const x of [caseX - caseW / 2, caseX + caseW / 2])
    for (const z of [-(d - 0.08) / 2, (d - 0.08) / 2])
      g.add(box(PALETTE.woodDark, [0.02, 0.42, 0.02], [x, height + 0.21, z]));
  const shelf = (y: number, makers: ((seed: number) => THREE.Object3D)[]) =>
    makers.forEach((make, i) => {
      const food = make(i + y * 10);
      food.position.set(
        caseX - caseW / 2 + 0.1 + i * ((caseW - 0.2) / (makers.length - 1)),
        y,
        0.06 - (i % 2) * 0.12
      );
      g.add(food);
    });
  shelf(height + 0.005, [croissant, doughnut, croissant, doughnut, muffin, doughnut]);
  shelf(height + 0.21, [cupcake, cupcake, cookie, cupcake, muffin, cookie]);
  // On the open end: the cake on its stand with a slice out on a plate, loaves and baguettes behind.
  const openX = w / 2 - (w - caseW) / 2;
  const cake = cakeOnStand(3);
  cake.position.set(openX, height, 0.1);
  const slicePlate = plate(0.07);
  slicePlate.position.set(openX + 0.02, height, -0.22);
  const basket = breadBasket(5);
  basket.position.set(caseX, height + 0.44, -0.05);
  basket.scale.setScalar(0.8);
  g.add(cake, slicePlate, basket);
  // A couple of loaves and a baguette standing in a crock by the case.
  const crock = noShadow(
    lathe(
      [
        [0, 0],
        [0.06, 0],
        [0.07, 0.14],
        [0, 0.14]
      ],
      '#d9cbb3',
      [0, 0, 0],
      8
    )
  );
  crock.position.set(openX + 0.12, height, -0.12);
  const stick = baguette(9);
  stick.position.set(openX + 0.12, height + 0.2, -0.12);
  stick.rotation.x = 1.45;
  const bread = loaf(11);
  bread.position.set(openX - 0.12, height, -0.18);
  g.add(crock, stick, bread);
  return g;
}
