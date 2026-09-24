import * as THREE from 'three';
import { box } from './materials';
import { LOW, facetPart, group, lathe, noShadow, seeded } from './kit';

/**
 * Bakery and café food, faceted like everything that grows or is baked: croissants, doughnuts,
 * muffins, cupcakes, a cake, loaves, baguettes and cookies, with plates and cups to serve them on.
 * All of it shares the one faceted material, so a counter full of food is a single batch. Small
 * enough never to throw a shadow. Each piece sits on y = 0, centred.
 */

const DOUGH = '#d9953f';
const CRUST = '#b8692f';
const ICING = ['#f2a6c1', '#6b3f2a', '#f3ece2', '#f6c945'] as const;
const SPRINKLES = ['#e24b4b', '#3b82f6', '#f6c945', '#22c55e', '#f3ece2'] as const;

const doughnutRing = new THREE.TorusGeometry(0.03, 0.017, 5, 9).rotateX(Math.PI / 2);
const icingRing = new THREE.TorusGeometry(0.03, 0.015, 4, 9, Math.PI * 2).rotateX(Math.PI / 2);

export function croissant(seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = group();
  // Five puffed segments along a crescent, fattest in the middle.
  for (let i = 0; i < 5; i++) {
    const t = i / 4 - 0.5;
    const angle = t * 2.2;
    const size = 0.045 - Math.abs(t) * 0.035;
    g.add(
      facetPart(
        LOW.ball,
        i % 2 ? DOUGH : '#cf8636',
        [size * 1.1, size * 0.8, size],
        [Math.sin(angle) * 0.05, size * 0.4, Math.cos(angle) * 0.05 - 0.04],
        [0, angle, 0],
        seed * 5 + i,
        0.05 + random() * 0.02
      )
    );
  }
  return noShadow(g);
}

export function doughnut(seed = 1): THREE.Group {
  const random = seeded(seed);
  const icing = ICING[Math.floor(random() * ICING.length)];
  const g = group(
    facetPart(doughnutRing, '#c98a4b', [1, 1, 1], [0, 0.016, 0], [0, 0, 0], seed, 0.05),
    facetPart(icingRing, icing, [1, 0.55, 1], [0, 0.026, 0], [0, 0, 0], seed + 1, 0.03)
  );
  for (let i = 0; i < 6; i++) {
    const angle = random() * Math.PI * 2;
    const sprinkle = box(
      SPRINKLES[i % SPRINKLES.length],
      [0.008, 0.003, 0.003],
      [Math.sin(angle) * 0.03, 0.034, Math.cos(angle) * 0.03]
    );
    sprinkle.rotation.y = random() * Math.PI;
    g.add(sprinkle);
  }
  return noShadow(g);
}

const CUP = [
  [0, 0],
  [0.026, 0],
  [0.033, 0.035],
  [0, 0.035]
] as const;

export function muffin(seed = 1): THREE.Group {
  return noShadow(
    group(
      lathe(CUP, '#c8b08a', [0, 0, 0], 8),
      facetPart(LOW.ball, '#b07440', [0.075, 0.05, 0.075], [0, 0.045, 0], [0, seed, 0], seed, 0.06)
    )
  );
}

export function cupcake(seed = 1): THREE.Group {
  const random = seeded(seed);
  const paper = ['#8fd0c9', '#f2a6c1', '#b9a6e8'][Math.floor(random() * 3)];
  const frosting = ['#f6f0f4', '#f2a6c1', '#fbe3a2'][Math.floor(random() * 3)];
  return noShadow(
    group(
      lathe(CUP, paper, [0, 0, 0], 8),
      facetPart(LOW.ball, frosting, [0.066, 0.036, 0.066], [0, 0.045, 0], [0, 0, 0], seed, 0.04),
      facetPart(LOW.ball, frosting, [0.04, 0.03, 0.04], [0, 0.066, 0], [0, 0, 0], seed + 1, 0.04),
      facetPart(LOW.gem, '#c81d3a', [0.016, 0.016, 0.016], [0, 0.085, 0], [0, 0, 0], seed + 2, 0.05)
    )
  );
}

export function cookie(seed = 1): THREE.Group {
  const random = seeded(seed);
  const g = group(
    facetPart(LOW.can, '#c98f55', [0.06, 0.012, 0.06], [0, 0.006, 0], [0, seed, 0], seed, 0.05)
  );
  for (let i = 0; i < 3; i++)
    g.add(box('#4a2e1f', [0.009, 0.004, 0.009], [(random() - 0.5) * 0.035, 0.013, (random() - 0.5) * 0.035]));
  return noShadow(g);
}

export function loaf(seed = 1): THREE.Group {
  const g = group(facetPart(LOW.ball, CRUST, [0.2, 0.09, 0.11], [0, 0.04, 0], [0, 0, 0], seed, 0.06));
  for (const x of [-0.05, 0, 0.05]) g.add(box('#e6c38f', [0.012, 0.006, 0.07], [x, 0.083, 0]));
  return noShadow(g);
}

export function baguette(seed = 1): THREE.Group {
  return noShadow(
    group(facetPart(LOW.ball, '#c47a38', [0.05, 0.05, 0.42], [0, 0.025, 0], [0, 0, 0], seed, 0.06))
  );
}

/** A two-layer cake on a stand, one slice lifted out onto a plate beside it. */
export function cakeOnStand(seed = 1): THREE.Group {
  const sponge = '#f1d9a8';
  const icing = '#f6eef2';
  const g = group(
    lathe(
      [
        [0, 0],
        [0.07, 0],
        [0.03, 0.015],
        [0.025, 0.1],
        [0.15, 0.11],
        [0.15, 0.12],
        [0, 0.12]
      ],
      '#f4f1ec',
      [0, 0, 0],
      12,
      { roughness: 0.3 }
    )
  );
  const slices = 8;
  for (let i = 0; i < slices - 1; i++) {
    const wedge = new THREE.CylinderGeometry(
      0.12,
      0.12,
      0.1,
      2,
      1,
      false,
      (i / slices) * Math.PI * 2,
      (Math.PI * 2) / slices
    );
    g.add(facetPart(wedge, sponge, [1, 1, 1], [0, 0.17, 0], [0, 0, 0], seed + i, 0.03));
    const top = new THREE.CylinderGeometry(
      0.122,
      0.122,
      0.02,
      2,
      1,
      false,
      (i / slices) * Math.PI * 2,
      (Math.PI * 2) / slices
    );
    g.add(facetPart(top, icing, [1, 1, 1], [0, 0.23, 0], [0, 0, 0], seed + 20 + i, 0.02));
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 1.6 + 0.5;
    g.add(
      facetPart(
        LOW.gem,
        '#c81d3a',
        [0.025, 0.025, 0.025],
        [Math.sin(angle) * 0.08, 0.25, Math.cos(angle) * 0.08],
        [0, 0, 0],
        seed + 40 + i
      )
    );
  }
  return noShadow(g);
}

/** A white plate, `radius` across. */
export function plate(radius = 0.1): THREE.Mesh {
  return noShadow(
    lathe(
      [
        [0, 0],
        [radius * 0.6, 0],
        [radius, 0.012],
        [radius * 0.96, 0.016],
        [0, 0.006]
      ],
      '#f7f5f0',
      [0, 0, 0],
      12,
      { roughness: 0.3 }
    )
  );
}

/** A cup of coffee on its saucer. */
export function cupOfCoffee(color = '#f7f5f0'): THREE.Group {
  return noShadow(
    group(
      plate(0.06),
      lathe(
        [
          [0, 0.008],
          [0.025, 0.008],
          [0.036, 0.06],
          [0.032, 0.06],
          [0, 0.05]
        ],
        color,
        [0, 0, 0],
        8,
        { roughness: 0.3 }
      ),
      box(color, [0.012, 0.025, 0.006], [0.04, 0.04, 0])
    )
  );
}

/** A plate with a pastry on it, for the café tables and the pass. */
export function servedPlate(seed = 1): THREE.Group {
  const g = group(plate(0.1));
  const pick = seed % 4;
  const food =
    pick === 0 ? croissant(seed) : pick === 1 ? doughnut(seed) : pick === 2 ? muffin(seed) : cupcake(seed);
  food.position.y = 0.012;
  g.add(food);
  return g;
}

/** A wicker basket of loaves and baguettes. */
export function breadBasket(seed = 1): THREE.Group {
  const g = group(
    lathe(
      [
        [0, 0],
        [0.13, 0],
        [0.17, 0.09],
        [0.16, 0.095],
        [0.12, 0.012],
        [0, 0.012]
      ],
      '#b48a5a',
      [0, 0, 0],
      10
    )
  );
  const bread = loaf(seed);
  bread.position.set(0, 0.03, -0.03);
  g.add(bread);
  for (const [x, lean] of [
    [-0.05, 0.9],
    [0.02, 1.05],
    [0.08, 0.95]
  ] as const) {
    const stick = baguette(seed + x * 10);
    stick.position.set(x, 0.1, 0.05);
    stick.rotation.set(lean, 0.3, 0);
    g.add(stick);
  }
  return g;
}
