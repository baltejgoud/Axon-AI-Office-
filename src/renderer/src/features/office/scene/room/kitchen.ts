import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, mat, part } from './materials';
import { LOW, animateSteam, bevelBox, facetPart, group, lathe, noShadow } from './kit';
import { steamPuffs } from './cafe';
import { cupOfCoffee, plate, servedPlate } from './food';
import { KITCHEN_SPOTS } from '../staff/routines';
import { bake } from './batching';

/**
 * The open kitchen at the café's east end. The cooking line runs along the back (north) and faces
 * the café, so the camera sees the range, the hood and the oven; the prep counter and the pass run
 * along the front, where the prep chef faces the room. Counters close the sides. The whole kitchen
 * is one piece of furniture to the pathfinder, so coworkers never walk in.
 * Centred on its footprint at floor level; kitchen-local x runs east, z toward the café.
 */

const STEEL = { metalness: 0.5, roughness: 0.32 } as const;
const STEEL_COLOR = '#c9ced4';
const WALNUT = '#8a5a3c';
const TOP = 0.92;

export interface KitchenFx {
  /** The pan on the front burner; hidden while the chef has it in hand. */
  pan: THREE.Object3D;
  update(cooking: boolean, elapsed: number, panInHand: boolean): void;
}

const flameMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: '#ffb347',
    emissive: '#ff7a1a',
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  });

/** A ring of flame tongues as one mesh, so a burner costs one draw call. */
function flames(radius: number): THREE.Mesh {
  const tongues: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const tongue = LOW.gem.clone();
    tongue.scale(0.03, 0.07, 0.03);
    tongue.translate(Math.sin(angle) * radius, 0.03, Math.cos(angle) * radius);
    tongues.push(tongue);
  }
  const mesh = new THREE.Mesh(mergeGeometries(tongues), flameMaterial());
  mesh.userData.dynamic = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = false;
  return mesh;
}

/** A frying pan with something sizzling in it. Handle toward +z. */
export function fryingPan(): THREE.Group {
  const g = group(
    lathe(
      [
        [0, 0],
        [0.11, 0],
        [0.13, 0.045],
        [0.12, 0.045],
        [0.1, 0.008],
        [0, 0.008]
      ],
      '#2b2f36',
      [0, 0, 0],
      12,
      { roughness: 0.4 }
    ),
    box('#1f2328', [0.03, 0.02, 0.2], [0, 0.035, 0.22])
  );
  ['#e24b4b', '#6e8b3d', '#f6c945', '#c47a38', '#e24b4b'].forEach((color, i) => {
    const angle = i * 1.3;
    g.add(
      facetPart(
        LOW.gem,
        color,
        [0.04, 0.02, 0.035],
        [Math.sin(angle) * 0.05, 0.02, Math.cos(angle) * 0.05],
        [0, angle, 0],
        i + 1
      )
    );
  });
  return noShadow(g);
}

function pot(): THREE.Group {
  return noShadow(
    group(
      lathe(
        [
          [0, 0],
          [0.12, 0],
          [0.12, 0.18],
          [0.115, 0.18],
          [0.11, 0.01],
          [0, 0.01]
        ],
        '#aeb4bc',
        [0, 0, 0],
        12,
        STEEL
      ),
      part(LOW.can, mat('#d9803a'), [0.22, 0.01, 0.22], [0, 0.15, 0]),
      box('#2b2f36', [0.3, 0.02, 0.03], [0, 0.15, 0])
    )
  );
}

/** Vegetables on a chopping board, a knife and a bowl. */
function prepBoard(): THREE.Group {
  const g = group(
    bevelBox('#c9a36b', [0.46, 0.025, 0.3], [0, 0.0125, 0], 0.008),
    box('#d9dce1', [0.2, 0.004, 0.035], [0.08, 0.03, 0.09], STEEL),
    box('#2b2f36', [0.1, 0.014, 0.025], [0.22, 0.03, 0.09])
  );
  const veg: [string, number, number, [number, number, number]][] = [
    ['#e24b4b', -0.12, -0.05, [0.06, 0.05, 0.06]],
    ['#e24b4b', -0.05, -0.08, [0.055, 0.045, 0.055]],
    ['#e98a3b', 0.05, -0.06, [0.035, 0.035, 0.16]],
    ['#6e8b3d', -0.16, 0.06, [0.1, 0.08, 0.1]],
    ['#b3688f', 0.14, -0.05, [0.06, 0.055, 0.06]]
  ];
  veg.forEach(([color, x, z, size], i) =>
    g.add(facetPart(LOW.ball, color, size, [x, 0.025 + size[1] / 2, z], [0, i, 0], i + 7))
  );
  for (let i = 0; i < 6; i++)
    g.add(
      box('#e98a3b', [0.02, 0.008, 0.02], [-0.02 + (i % 3) * 0.025, 0.03, 0.02 + Math.floor(i / 3) * 0.025])
    );
  const bowl = lathe(
    [
      [0, 0],
      [0.05, 0],
      [0.09, 0.06],
      [0.085, 0.065],
      [0, 0.01]
    ],
    '#f4f1ec',
    [0.34, 0, -0.02],
    10,
    { roughness: 0.3 }
  );
  g.add(bowl);
  return noShadow(g);
}

/** Utensils hanging from a rail: a ladle, a spatula, a whisk and a small pan. */
function utensilRail(length: number): THREE.Group {
  const g = group(box('#9aa1ab', [length, 0.02, 0.02], [0, 0, 0], STEEL));
  const hang = (x: number, ...parts: THREE.Object3D[]) => {
    const item = group(box('#9aa1ab', [0.008, 0.05, 0.008], [0, -0.03, 0], STEEL), ...parts);
    item.position.x = x;
    g.add(item);
  };
  const step = length / 5;
  hang(
    -length / 2 + step,
    box('#9aa1ab', [0.012, 0.28, 0.008], [0, -0.2, 0], STEEL),
    part(LOW.ball, mat('#9aa1ab', STEEL), [0.07, 0.04, 0.07], [0, -0.36, 0.02])
  );
  hang(
    -length / 2 + step * 2,
    box('#2b2f36', [0.015, 0.2, 0.01], [0, -0.16, 0]),
    box('#2b2f36', [0.07, 0.1, 0.006], [0, -0.3, 0])
  );
  hang(
    -length / 2 + step * 3,
    box('#9aa1ab', [0.012, 0.12, 0.012], [0, -0.12, 0], STEEL),
    lathe(
      [
        [0.005, 0],
        [0.035, 0.06],
        [0.03, 0.14],
        [0, 0.16]
      ],
      '#c9ced4',
      [0, -0.34, 0],
      6,
      STEEL
    )
  );
  const smallPan = fryingPan();
  smallPan.scale.setScalar(0.7);
  smallPan.rotation.x = Math.PI / 2;
  smallPan.position.set(-length / 2 + step * 4, -0.32, 0.02);
  hang(0, smallPan);
  return noShadow(g);
}

/** A counter with a walnut face, a steel top and an inner (chef) side in steel. */
function counter(w: number, d: number, face: string): THREE.Group {
  return group(
    bevelBox(face, [w, 0.88, d], [0, 0.44, 0], 0.012),
    bevelBox(STEEL_COLOR, [w + 0.02, 0.04, d + 0.02], [0, TOP - 0.02, 0], 0.008, STEEL)
  );
}

export function openKitchen(item: FurnitureItem): { group: THREE.Group; fx: KitchenFx } {
  const { w, d } = item;
  const back = -d / 2 + 0.33;
  const front = -d / 2 + 0.66;
  const g = group();

  // Tiled floor: a pale slab with grout lines, just above the café floor.
  const floor = group(box('#e7e2d9', [w - 0.02, 0.012, d - 0.02], [0, 0.006, 0], { roughness: 0.6 }));
  for (let x = -w / 2 + 0.3; x < w / 2; x += 0.3)
    floor.add(box('#cfc7ba', [0.012, 0.002, d - 0.04], [x, 0.0125, 0]));
  for (let z = -d / 2 + 0.3; z < d / 2; z += 0.3)
    floor.add(box('#cfc7ba', [w - 0.04, 0.002, 0.012], [0, 0.0125, z]));
  g.add(noShadow(floor));

  // The back wall: white tiles from the counters up, lines every 15 cm.
  const splash = group(box('#f3f4f2', [w - 0.04, 1.3, 0.05], [0, 1.55, -d / 2 + 0.025], { roughness: 0.4 }));
  for (let y = 0.95; y < 2.2; y += 0.15)
    splash.add(box('#d9ddda', [w - 0.06, 0.008, 0.004], [0, y, -d / 2 + 0.052]));
  g.add(splash);

  // Fridge.
  g.add(bevelBox('#d7dbe0', [0.8, 2.0, 0.64], [-1.3, 1.0, back], 0.02, STEEL));
  g.add(
    noShadow(
      group(
        box('#9aa1ab', [0.008, 1.85, 0.004], [-1.3, 1.0, front + 0.002]),
        box('#6b727d', [0.025, 0.4, 0.03], [-1.36, 1.15, front + 0.02], STEEL),
        box('#6b727d', [0.025, 0.4, 0.03], [-1.24, 1.15, front + 0.02], STEEL)
      )
    )
  );

  // The range: oven door beneath, four burners, a pan and a pot; the hood and its chimney above.
  g.add(bevelBox(STEEL_COLOR, [1.1, 0.88, 0.64], [-0.2, 0.44, back], 0.012, STEEL));
  const range = group(
    box('#1f2328', [1.08, 0.025, 0.62], [-0.2, 0.9, back]),
    box('#2b2f36', [0.8, 0.42, 0.01], [-0.2, 0.42, front + 0.004]),
    box('#9aa1ab', [0.7, 0.025, 0.03], [-0.2, 0.68, front + 0.02], STEEL)
  );
  for (let i = 0; i < 5; i++)
    range.add(
      part(
        LOW.can,
        mat('#2b2f36'),
        [0.04, 0.02, 0.04],
        [-0.6 + i * 0.2, 0.8, front + 0.01],
        [Math.PI / 2, 0, 0]
      )
    );
  const burners: [number, number][] = [
    [-0.45, back + 0.14],
    [0.05, back + 0.14],
    [-0.45, back - 0.14],
    [0.05, back - 0.14]
  ];
  for (const [x, z] of burners) range.add(part(LOW.can, mat('#3a3f47'), [0.2, 0.02, 0.2], [x, 0.92, z]));
  g.add(noShadow(range));
  // One mesh, so the pan that hides while the chef holds it costs a single draw call.
  const pan = bake(fryingPan(), { roughness: 0.45 });
  pan.castShadow = false;
  pan.position.set(burners[0][0], 0.93, burners[0][1]);
  const stockPot = pot();
  stockPot.position.set(burners[3][0], 0.93, burners[3][1]);
  g.add(pan, stockPot);
  const panFlames = flames(0.08);
  panFlames.position.set(burners[0][0], 0.91, burners[0][1]);
  const potFlames = flames(0.08);
  potFlames.position.set(burners[3][0], 0.91, burners[3][1]);
  const steam = steamPuffs(1.15, 3, 0.09);
  steam.position.x = burners[3][0];
  steam.position.z = burners[3][1];
  g.add(panFlames, potFlames, steam);
  g.add(
    bevelBox(STEEL_COLOR, [1.2, 0.3, 0.62], [-0.2, 2.0, back - 0.02], 0.02, STEEL),
    box('#9aa1ab', [1.16, 0.03, 0.58], [-0.2, 1.84, back - 0.02], STEEL),
    box(STEEL_COLOR, [0.4, 0.55, 0.3], [-0.2, 2.42, -d / 2 + 0.2], STEEL)
  );

  // Oven column with two doors.
  g.add(bevelBox(STEEL_COLOR, [0.75, 1.9, 0.64], [0.85, 0.95, back], 0.015, STEEL));
  g.add(
    noShadow(
      group(
        box('#2b2f36', [0.6, 0.45, 0.01], [0.85, 0.55, front + 0.004]),
        box('#2b2f36', [0.6, 0.45, 0.01], [0.85, 1.2, front + 0.004]),
        box('#9aa1ab', [0.5, 0.02, 0.03], [0.85, 0.82, front + 0.02], STEEL),
        box('#9aa1ab', [0.5, 0.02, 0.03], [0.85, 1.47, front + 0.02], STEEL),
        box('#1f2328', [0.6, 0.08, 0.01], [0.85, 1.7, front + 0.004]),
        box('#fbbf24', [0.08, 0.03, 0.004], [0.7, 1.7, front + 0.01], {
          emissive: '#fbbf24',
          emissiveIntensity: 0.8
        })
      )
    )
  );

  // The back counter under the utensil rail, with spice jars.
  const backCounter = counter(0.55, 0.64, STEEL_COLOR);
  backCounter.position.set(1.46, 0, back);
  g.add(backCounter);
  const spices = group();
  ['#c0392b', '#e0b36a', '#6e8b3d', '#8a5a2b'].forEach((color, i) =>
    spices.add(
      lathe(
        [
          [0, 0],
          [0.025, 0],
          [0.025, 0.08],
          [0, 0.08]
        ],
        color,
        [1.3 + (i % 2) * 0.07, TOP, back - 0.15 + Math.floor(i / 2) * 0.07],
        6
      )
    )
  );
  g.add(noShadow(spices));
  const rail = utensilRail(1.2);
  rail.position.set(1.0, 1.6, -d / 2 + 0.08);
  g.add(rail);

  // Front: the prep counter and the pass, their walnut side to the café.
  const southZ = d / 2 - 0.33;
  const south = counter(w, 0.64, WALNUT);
  south.position.set(0, 0, southZ);
  g.add(south);
  const slats = group();
  for (let x = -w / 2 + 0.12; x < w / 2 - 0.05; x += 0.2)
    slats.add(box('#a7744f', [0.1, 0.7, 0.012], [x, 0.47, d / 2 - 0.004]));
  g.add(noShadow(slats));
  const board = prepBoard();
  board.position.set(KITCHEN_SPOTS.prep.x, TOP, southZ - 0.06);
  g.add(board);
  // The pass: a heated shelf on two posts with warm lamps beneath it.
  const heat = mat('#ffd2a0', { emissive: '#ff8a3d', emissiveIntensity: 0.9 });
  g.add(
    box(STEEL_COLOR, [0.03, 0.5, 0.03], [0.1, TOP + 0.25, southZ + 0.1], STEEL),
    box(STEEL_COLOR, [0.03, 0.5, 0.03], [1.5, TOP + 0.25, southZ + 0.1], STEEL),
    box(STEEL_COLOR, [1.46, 0.03, 0.34], [0.8, TOP + 0.5, southZ + 0.05], STEEL),
    part(GEOMETRY.box, heat, [1.3, 0.015, 0.06], [0.8, TOP + 0.48, southZ + 0.05])
  );
  const passFood = group();
  [0.45, 0.85].forEach((x, i) => {
    const dish = servedPlate(i + 2);
    dish.position.set(x, TOP, southZ + 0.02);
    passFood.add(dish);
  });
  for (let i = 0; i < 6; i++) {
    const stacked = plate(0.1);
    stacked.position.set(1.3, TOP + i * 0.016, southZ);
    passFood.add(stacked);
    const onShelf = plate(0.1);
    onShelf.position.set(0.5, TOP + 0.515 + i * 0.016, southZ + 0.05);
    passFood.add(onShelf);
  }
  const coffee = cupOfCoffee();
  coffee.position.set(-1.35, TOP, southZ);
  passFood.add(coffee);
  g.add(passFood);

  // Side counters close the kitchen: a fruit crate on the west, the sink on the east.
  const sideLength = d - 1.32 - 0.04;
  const west = counter(0.64, sideLength, WALNUT);
  west.position.set(-w / 2 + 0.33, 0, 0);
  const east = counter(0.64, sideLength, WALNUT);
  east.position.set(w / 2 - 0.33, 0, 0);
  g.add(west, east);
  const crate = group(box('#b48a5a', [0.36, 0.14, 0.26], [0, 0.07, 0]));
  for (let i = 0; i < 6; i++)
    crate.add(
      facetPart(
        LOW.ball,
        i % 2 ? '#e98a3b' : '#c0392b',
        [0.07, 0.07, 0.07],
        [-0.12 + (i % 3) * 0.12, 0.15, -0.05 + Math.floor(i / 3) * 0.1],
        [0, i, 0],
        i + 30
      )
    );
  crate.position.set(-w / 2 + 0.33, TOP, -0.4);
  const sink = group(
    box('#9aa1ab', [0.4, 0.012, 0.46], [0, 0.002, 0], STEEL),
    box('#6b727d', [0.34, 0.01, 0.4], [0, 0.006, 0], STEEL),
    part(LOW.can, mat('#c9ced4', STEEL), [0.025, 0.3, 0.025], [0.2, 0.15, 0]),
    box('#c9ced4', [0.16, 0.025, 0.025], [0.12, 0.3, 0], STEEL)
  );
  sink.position.set(w / 2 - 0.36, TOP, 0.2);
  const rack = group();
  for (let i = 0; i < 5; i++) {
    const dish = plate(0.09);
    dish.rotation.z = Math.PI / 2 - 0.15;
    dish.position.set(0, 0.09, -0.12 + i * 0.05);
    rack.add(dish);
  }
  rack.position.set(w / 2 - 0.36, TOP, -0.6);
  g.add(noShadow(crate), noShadow(sink), rack);

  const fx: KitchenFx = {
    pan,
    update(cooking, elapsed, panInHand) {
      pan.visible = !panInHand;
      for (const [flame, phase] of [
        [panFlames, 0],
        [potFlames, 2]
      ] as const) {
        flame.visible = cooking;
        if (cooking) flame.scale.set(1, 0.75 + 0.35 * Math.abs(Math.sin(elapsed * 11 + phase)), 1);
      }
      animateSteam(steam, cooking, elapsed);
    }
  };
  return { group: g, fx };
}
