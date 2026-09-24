import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, mat, part } from './materials';
import { LOW, bevelBox, facetPart, group, lathe, noShadow, pottedTuft } from './kit';
import { bake } from './batching';
import { TvScreen } from './tvScreen';

/**
 * The Lounge's media wall and its sleeping dog. The TV hangs on the back wall over a walnut
 * console with a PS5, a soundbar, two controllers and a record player. Centred on the footprint at
 * floor level, front toward +z (the room and the camera).
 */

const WALNUT = '#6b4a32';

export interface MediaWall {
  screen: TvScreen;
  /** The controllers on the console, hidden one by one while people hold them. */
  controllers: THREE.Object3D[];
  /** The record player's platter, which turns. */
  platter: THREE.Object3D;
}

/** A game controller: a body, two grips, sticks and buttons. One mesh. */
export function controller(body = '#f3f4f6'): THREE.Mesh {
  const g = group(
    bevelBox(body, [0.15, 0.03, 0.08], [0, 0.02, 0], 0.012),
    part(LOW.ball, mat(body), [0.05, 0.035, 0.07], [-0.055, 0.018, 0.03]),
    part(LOW.ball, mat(body), [0.05, 0.035, 0.07], [0.055, 0.018, 0.03]),
    part(LOW.can, mat('#1f2328'), [0.018, 0.012, 0.018], [-0.03, 0.04, 0.01]),
    part(LOW.can, mat('#1f2328'), [0.018, 0.012, 0.018], [0.03, 0.04, 0.01]),
    box('#1f2328', [0.03, 0.006, 0.012], [0, 0.037, -0.02]),
    box('#60a5fa', [0.05, 0.004, 0.008], [0, 0.036, -0.036])
  );
  const mesh = bake(g, { roughness: 0.45 });
  mesh.castShadow = false;
  return mesh;
}

export function mediaConsole(item: FurnitureItem): { group: THREE.Group; media: MediaWall } {
  const { w, d } = item;
  const top = 0.48;
  const g = group(bevelBox(WALNUT, [w, top - 0.06, d], [0, 0.06 + (top - 0.06) / 2, 0], 0.015));
  const trim = group();
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08])
    for (const z of [-d / 2 + 0.06, d / 2 - 0.06])
      trim.add(box('#2b2f36', [0.035, 0.06, 0.035], [x, 0.03, z]));
  // Two slatted doors either side of an open shelf.
  for (const side of [-1, 1]) {
    const cx = (side * w) / 3;
    for (let i = -3; i <= 3; i++)
      trim.add(box('#8a6a4c', [0.05, 0.32, 0.01], [cx + i * 0.075, 0.27, d / 2 + 0.004]));
    trim.add(box('#c9a36b', [0.012, 0.08, 0.02], [cx - side * 0.24, 0.27, d / 2 + 0.014]));
  }
  trim.add(box('#3a2c24', [w / 3 - 0.06, 0.3, 0.02], [0, 0.27, d / 2 - 0.1]));
  g.add(noShadow(trim));

  // The TV on the wall behind, its picture drawn by the TvScreen.
  const tvZ = -d / 2 + 0.08;
  const tvY = 1.28;
  const screen = new TvScreen();
  const picture = part(GEOMETRY.plane, screen.material, [1.38, 0.76, 1], [0, tvY, tvZ + 0.022]);
  picture.castShadow = false;
  picture.userData.dynamic = true;
  g.add(bevelBox('#16181c', [1.44, 0.82, 0.04], [0, tvY, tvZ], 0.01, { roughness: 0.4 }), picture);

  // On the console: soundbar, PS5 standing on end, record player.
  const kit = group(
    bevelBox('#2b2f36', [0.9, 0.07, 0.1], [0, top + 0.035, 0.1], 0.02, { roughness: 0.6 }),
    box('#3a3f47', [0.86, 0.05, 0.004], [0, top + 0.035, 0.151])
  );
  const ps5 = group(
    bevelBox('#1f2328', [0.06, 0.37, 0.24], [0, 0.185, 0], 0.01, { roughness: 0.4 }),
    bevelBox('#f3f4f6', [0.025, 0.4, 0.27], [-0.045, 0.2, 0], 0.01, { roughness: 0.35 }),
    bevelBox('#f3f4f6', [0.025, 0.4, 0.27], [0.045, 0.2, 0], 0.01, { roughness: 0.35 }),
    box('#60a5fa', [0.006, 0.3, 0.006], [0, 0.2, 0.121], { emissive: '#60a5fa', emissiveIntensity: 1.2 })
  );
  ps5.children[1].rotation.z = 0.05;
  ps5.children[2].rotation.z = -0.05;
  ps5.position.set(w / 2 - 0.22, top, -0.02);
  const deck = group(
    bevelBox('#a7744f', [0.42, 0.1, 0.34], [0, 0.05, 0], 0.015),
    box('#2b2f36', [0.08, 0.02, 0.012], [0.14, 0.11, -0.12]),
    box('#c9ced4', [0.012, 0.012, 0.2], [0.15, 0.125, -0.04], { metalness: 0.5, roughness: 0.3 })
  );
  deck.position.set(-w / 2 + 0.3, top, 0);
  const record = group(
    part(LOW.can, mat('#16181c', { roughness: 0.25 }), [0.28, 0.008, 0.28], [0, 0, 0]),
    part(LOW.can, mat('#e24b4b'), [0.09, 0.01, 0.09], [0, 0.001, 0])
  );
  const platter = bake(record, { roughness: 0.3 });
  platter.castShadow = false;
  platter.position.set(-w / 2 + 0.26, top + 0.105, 0.01);
  // A record sleeve leaning on the console's side.
  const sleeve = box('#f6c945', [0.3, 0.3, 0.008], [-w / 2 - 0.02, 0.15, 0.1]);
  sleeve.rotation.set(0, Math.PI / 2, 0.12);
  kit.add(ps5, deck, sleeve);
  const controllers = [controller('#f3f4f6'), controller('#1f2328')];
  controllers[0].position.set(0.3, top, 0.14);
  controllers[0].rotation.y = 0.3;
  controllers[1].position.set(0.5, top, 0.12);
  controllers[1].rotation.y = -0.2;
  const shelfPlant = pottedTuft(1.2, PALETTE.white, 81);
  shelfPlant.position.set(-0.28, top, -0.08);
  g.add(kit, platter, shelfPlant, ...controllers);
  return { group: g, media: { screen, controllers, platter } };
}

/**
 * The office dog, curled up asleep on a round cushion. The dog is one faceted mesh, so its slow
 * breathing (a gentle swell) costs a single draw call.
 */
export function dogBed(item: FurnitureItem): { group: THREE.Group; dog: THREE.Mesh } {
  const r = item.w / 2;
  const cushion = group(
    lathe(
      [
        [0, 0],
        [r * 0.9, 0],
        [r, 0.05],
        [r * 0.97, 0.11],
        [r * 0.85, 0.13],
        [r * 0.7, 0.09],
        [0, 0.08]
      ],
      '#b85c4a',
      [0, 0, 0],
      16,
      { roughness: 0.95 }
    )
  );
  const coat = '#d9a25f';
  const ears = '#a8723c';
  const body = group(
    facetPart(LOW.ball, coat, [0.52, 0.22, 0.38], [0, 0.12, 0], [0, 0, 0], 3, 0.05),
    facetPart(LOW.ball, coat, [0.24, 0.17, 0.25], [0.2, 0.13, 0.12], [0, 0.6, 0], 4, 0.05),
    facetPart(LOW.ball, '#f1d9b0', [0.12, 0.09, 0.13], [0.3, 0.1, 0.21], [0, 0.6, 0], 5, 0.04),
    facetPart(LOW.gem, '#1f2328', [0.04, 0.03, 0.03], [0.34, 0.12, 0.26], [0, 0.6, 0], 6),
    facetPart(LOW.gem, ears, [0.1, 0.05, 0.13], [0.12, 0.2, 0.2], [0.3, 0.6, 0.5], 7),
    facetPart(LOW.gem, ears, [0.1, 0.05, 0.13], [0.26, 0.2, 0.02], [-0.3, 0.6, -0.5], 8),
    // Front paws under the chin, the tail curled round.
    facetPart(LOW.ball, '#f1d9b0', [0.08, 0.05, 0.14], [0.12, 0.04, 0.24], [0, 0.4, 0], 9),
    facetPart(LOW.ball, '#f1d9b0', [0.08, 0.05, 0.14], [0.23, 0.04, 0.2], [0, 0.6, 0], 10),
    facetPart(LOW.ball, coat, [0.1, 0.08, 0.26], [-0.18, 0.08, 0.16], [0, -0.7, 0], 11),
    box('#2b2f36', [0.03, 0.006, 0.006], [0.27, 0.16, 0.19]),
    box('#2b2f36', [0.03, 0.006, 0.006], [0.3, 0.16, 0.12])
  );
  const dog = bake(body, { roughness: 0.85 });
  dog.position.y = 0.1;
  dog.rotation.y = -0.4;
  return { group: group(cushion, dog), dog };
}
