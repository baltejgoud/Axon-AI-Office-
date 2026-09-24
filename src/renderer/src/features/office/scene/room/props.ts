import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, cylinder, lampGlow, mat, part, screenCanvas } from './materials';
import { GREENS, LOW, bevelBox, facetPart, lathe } from './kit';

/**
 * District signature pieces: the things that make each area feel like its own place.
 * Same conventions as furniture.ts: centred on the footprint at floor level, front facing +z.
 */

function seeded(seed: number) {
  let state = Math.floor(Math.abs(seed) * 1000) % 2147483646 || 1;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group();
  if (children.length) g.add(...children);
  return g;
};

const CROWN = new THREE.IcosahedronGeometry(0.5, 1);

/** A tall indoor tree in a round planter: the campus's landmarks along the corridors. */
export function tree(item: FurnitureItem): THREE.Group {
  const random = seeded(item.x * 5 + item.z * 11);
  const r = Math.round((item.w / 2) * 1000) / 1000;
  const g = group(
    lathe(
      [
        [0, 0],
        [r * 0.9, 0],
        [r, 0.06],
        [r, 0.46],
        [r * 0.9, 0.46],
        [r * 0.9, 0.44],
        [0, 0.44]
      ],
      '#ece6dc',
      [0, 0, 0],
      24,
      { roughness: 0.75 }
    ),
    cylinder('#5b4636', r * 0.9, 0.01, [0, 0.445, 0], { roughness: 1 }),
    lathe(
      [
        [0.09, 0],
        [0.07, 0.6],
        [0.045, 1.6],
        [0, 1.62]
      ],
      '#7a5a3e',
      [0, 0.44, 0],
      7,
      { flat: true, roughness: 0.9 }
    )
  );
  const shade = Math.floor(random() * 2);
  const crowns: [number, number, number][] = [
    [1.25, 2.0, 0.08],
    [1.0, 2.45, -0.1],
    [0.7, 2.85, 0.05]
  ];
  crowns.forEach(([size, y, offset], i) =>
    g.add(
      facetPart(
        CROWN,
        GREENS[(shade + i) % GREENS.length],
        [size, size * 0.8, size],
        [offset * Math.cos(item.x + i), y, offset * Math.sin(item.z + i)],
        [random(), random() * 3, 0],
        Math.abs(item.x * 3 + item.z) + i,
        0.06
      )
    )
  );
  return g;
}

/** A squashy bean bag in a warm fabric. */
export function beanBag(item: FurnitureItem): THREE.Group {
  const colours = ['#e8a87c', '#85b8a8', '#c3a6d8', '#f2cf7a', '#9fb8d9'];
  const colour = colours[Math.abs(Math.round(item.x * 3 + item.z * 7)) % colours.length];
  const r = item.w / 2;
  return group(
    part(LOW.blob, mat(colour, { roughness: 0.95 }), [r * 2, 0.5, r * 2], [0, 0.25, 0]),
    part(LOW.blob, mat(colour, { roughness: 0.95 }), [r * 1.5, 0.42, r * 0.9], [0, 0.42, -r * 0.45])
  );
}

/** A ping-pong table with its net, paddles resting on top. */
export function pingPong(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = group(
    box('#1f6f5c', [w, 0.04, d], [0, 0.76, 0], { roughness: 0.6 }),
    box('#ffffff', [w, 0.005, 0.02], [0, 0.782, 0]),
    box('#ffffff', [0.02, 0.005, d], [0, 0.782, 0]),
    box('#2b2f36', [0.02, 0.16, d + 0.1], [0, 0.86, 0]),
    box('#f3f3f3', [0.012, 0.14, d + 0.08], [0, 0.86, 0], { transparent: true, opacity: 0.55 })
  );
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2])
    for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) g.add(box('#3b4048', [0.05, 0.74, 0.05], [x, 0.37, z]));
  g.add(
    part(GEOMETRY.cylinder, mat('#c0392b'), [0.16, 0.012, 0.16], [w * 0.3, 0.79, 0.1]),
    part(GEOMETRY.cylinder, mat('#1d3557'), [0.16, 0.012, 0.16], [-w * 0.28, 0.79, -0.15]),
    part(GEOMETRY.sphere, mat('#fbfaf6'), [0.04, 0.04, 0.04], [0.1, 0.8, 0.3])
  );
  return g;
}

const ledMaterials = ['#34d399', '#60a5fa', '#fbbf24'].map((colour) =>
  mat(colour, { emissive: colour, emissiveIntensity: 1.1, roughness: 0.3 })
);

/** A server rack with rows of status lights; the lights share materials the scene can pulse. */
export function serverRack(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const random = seeded(item.x * 13 + item.z);
  const g = group(
    box('#23272e', [w, 2.0, d], [0, 1.0, 0], { roughness: 0.45, metalness: 0.3 }),
    box('#353b45', [w - 0.06, 1.9, 0.01], [0, 1.0, d / 2 + 0.005], { roughness: 0.3, metalness: 0.4 })
  );
  for (let row = 0; row < 12; row++) {
    const y = 0.2 + row * 0.14;
    g.add(box('#2b3038', [w - 0.1, 0.1, 0.01], [0, y, d / 2 + 0.012]));
    for (let i = 0; i < 3; i++)
      if (random() > 0.35)
        g.add(
          part(
            GEOMETRY.box,
            ledMaterials[Math.floor(random() * ledMaterials.length)],
            [0.02, 0.02, 0.01],
            [-w / 2 + 0.1 + i * 0.05, y, d / 2 + 0.02]
          )
        );
  }
  return g;
}

/** The lights on every server rack, for the scene to pulse. */
export const RACK_LIGHTS: readonly THREE.MeshStandardMaterial[] = ledMaterials;

/** A big free-standing data wall: dashboards on a screen on two feet. */
export function dataWall(item: FurnitureItem): THREE.Group {
  const texture = new THREE.CanvasTexture(screenCanvas('data'));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1, 0.5);
  const screen = part(
    GEOMETRY.plane,
    new THREE.MeshStandardMaterial({
      color: '#0b0f16',
      emissive: '#ffffff',
      emissiveMap: texture,
      emissiveIntensity: 0.6
    }),
    [item.w - 0.1, 1.25, 1],
    [0, 1.45, 0.035]
  );
  screen.castShadow = false;
  const g = group(box('#1c2028', [item.w, 1.35, 0.06], [0, 1.45, 0]), screen);
  for (const x of [-item.w / 2 + 0.3, item.w / 2 - 0.3])
    g.add(box('#3b4048', [0.06, 0.8, 0.06], [x, 0.4, 0]), box('#3b4048', [0.1, 0.03, 0.6], [x, 0.015, 0]));
  return g;
}

/** A board on legs. `style` decides what is pinned to it. */
function board(item: FurnitureItem, style: 'kanban' | 'mood' | 'pins'): THREE.Group {
  const { w } = item;
  const random = seeded(item.x * 7 + item.z * 3);
  const face = style === 'pins' ? '#c9a57a' : PALETTE.paper;
  const g = group(
    box('#cfd3d8', [w, 1.2, 0.04], [0, 1.42, 0], { metalness: 0.3, roughness: 0.5 }),
    box(face, [w - 0.06, 1.14, 0.01], [0, 1.42, 0.021], { roughness: style === 'pins' ? 0.95 : 0.4 })
  );
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
    g.add(box('#9aa1ab', [0.04, 0.85, 0.04], [x, 0.42, 0]), box('#9aa1ab', [0.06, 0.03, 0.5], [x, 0.015, 0]));
  if (style === 'kanban') {
    const columns = 4;
    const notes = ['#ffe08a', '#a7d8ff', '#b9f0c0', '#ffb4c8'];
    for (let c = 0; c < columns; c++) {
      const x = -w / 2 + 0.1 + (c + 0.5) * ((w - 0.2) / columns);
      g.add(box('#2d3440', [(w - 0.2) / columns - 0.06, 0.03, 0.004], [x, 1.93, 0.028]));
      if (c) g.add(box('#c3cad6', [0.008, 1.0, 0.004], [x - (w - 0.2) / columns / 2, 1.42, 0.028]));
      const cards = 2 + Math.floor(random() * 3) - (c === 3 ? 1 : 0);
      for (let i = 0; i < cards; i++)
        g.add(box(notes[c], [0.14, 0.11, 0.004], [x + (random() - 0.5) * 0.08, 1.78 - i * 0.17, 0.029]));
    }
  } else if (style === 'mood') {
    const swatches = ['#e76f51', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#a78bdb', '#ffb4c8', '#6fb3e0'];
    for (let i = 0; i < 9; i++) {
      const size = 0.16 + random() * 0.2;
      g.add(
        box(
          swatches[i % swatches.length],
          [size * 1.3, size, 0.004],
          [-w / 2 + 0.25 + random() * (w - 0.5), 0.95 + random() * 0.9, 0.028 + i * 0.0005]
        )
      );
    }
  } else {
    const photos = ['#fbfaf6', '#f3ede3'];
    for (let i = 0; i < 12; i++) {
      const x = -w / 2 + 0.2 + (i % 6) * ((w - 0.4) / 5.5);
      const y = 1.72 - Math.floor(i / 6) * 0.42 + (random() - 0.5) * 0.06;
      g.add(box(photos[i % 2], [0.2, 0.26, 0.004], [x, y, 0.028]));
      g.add(
        box(['#8fa8c4', '#c9b6a0', '#9fb8a0', '#d8a8a8'][i % 4], [0.16, 0.16, 0.003], [x, y + 0.02, 0.031])
      );
      g.add(part(GEOMETRY.sphere, mat('#c0392b'), [0.025, 0.025, 0.02], [x, y + 0.12, 0.034]));
    }
  }
  return g;
}

export const kanbanBoard = (item: FurnitureItem) => board(item, 'kanban');
export const moodBoard = (item: FurnitureItem) => board(item, 'mood');
export const pinboard = (item: FurnitureItem) => board(item, 'pins');

/** A tilted drafting table with a lamp and a sketch. */
export function draftingTable(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const top = group(
    box(PALETTE.woodLight, [w, 0.04, d], [0, 0, 0]),
    box(PALETTE.paper, [w * 0.6, 0.005, d * 0.6], [0, 0.023, 0]),
    box('#3b6ff5', [w * 0.3, 0.004, 0.01], [-0.05, 0.027, 0.05])
  );
  top.position.set(0, 0.95, 0);
  top.rotation.x = 0.4;
  const g = group(top);
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) g.add(box('#3b4048', [0.04, 0.95, d * 0.8], [x, 0.47, 0]));
  g.add(
    part(
      GEOMETRY.cylinder,
      mat(PALETTE.darkMetal),
      [0.02, 0.5, 0.02],
      [w / 2 - 0.1, 1.25, -d / 2 + 0.1],
      [0.3, 0, 0]
    ),
    part(GEOMETRY.cone, lampGlow.desk(), [0.14, 0.1, 0.14], [w / 2 - 0.1, 1.5, -d / 2 + 0.2], [0.6, 0, 0])
  );
  return g;
}

/** The sales gong: a brass disc on a wooden frame. */
export function gong(item: FurnitureItem): THREE.Group {
  const g = group(
    box(PALETTE.woodDark, [0.06, 1.3, 0.06], [-item.w / 2 + 0.05, 0.65, 0]),
    box(PALETTE.woodDark, [0.06, 1.3, 0.06], [item.w / 2 - 0.05, 0.65, 0]),
    box(PALETTE.woodDark, [item.w, 0.06, 0.06], [0, 1.3, 0]),
    part(
      GEOMETRY.cylinder,
      mat('#d4a24c', { metalness: 0.7, roughness: 0.3 }),
      [0.56, 0.03, 0.56],
      [0, 0.88, 0],
      [Math.PI / 2, 0, 0]
    ),
    part(
      GEOMETRY.cylinder,
      mat('#b8862f', { metalness: 0.7, roughness: 0.35 }),
      [0.18, 0.035, 0.18],
      [0, 0.88, 0.005],
      [Math.PI / 2, 0, 0]
    )
  );
  for (const x of [-item.w / 2 + 0.05, item.w / 2 - 0.05])
    g.add(box(PALETTE.woodDark, [0.1, 0.03, 0.4], [x, 0.015, 0]));
  return g;
}

/** A low shelf of trophies and plaques. */
export function trophyShelf(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const random = seeded(item.x + item.z * 5);
  const g = group(
    box(PALETTE.wood, [w, 0.9, d], [0, 0.45, 0]),
    box(PALETTE.woodLight, [w + 0.03, 0.03, d + 0.03], [0, 0.915, 0])
  );
  const gold = mat('#d4a24c', { metalness: 0.75, roughness: 0.3 });
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + 0.2 + i * ((w - 0.4) / 4);
    const h = 0.18 + random() * 0.16;
    g.add(
      part(GEOMETRY.cylinder, mat('#2b2f36'), [0.1, 0.04, 0.1], [x, 0.95, 0]),
      part(GEOMETRY.cone, gold, [0.1, h, 0.1], [x, 0.97 + h / 2, 0], [Math.PI, 0, 0]),
      part(GEOMETRY.sphere, gold, [0.12, 0.08, 0.12], [x, 0.99 + h, 0])
    );
  }
  return g;
}

/** A water cooler with a blue bottle. */
export function waterCooler(): THREE.Group {
  return group(
    box('#e9ecef', [0.34, 1.0, 0.34], [0, 0.5, 0]),
    part(
      GEOMETRY.cylinder,
      mat('#a7d8ff', { transparent: true, opacity: 0.7, roughness: 0.1 }),
      [0.28, 0.4, 0.28],
      [0, 1.2, 0]
    ),
    box('#3b6ff5', [0.05, 0.03, 0.03], [0.06, 0.75, 0.18]),
    box('#e05252', [0.05, 0.03, 0.03], [-0.06, 0.75, 0.18])
  );
}

/** A long planter of grasses and flowers, low enough to see over. */
export function planter(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const random = seeded(item.x * 3 + item.z * 17);
  const g = group(
    bevelBox('#ece6dc', [w, 0.45, d], [0, 0.225, 0], 0.04, { roughness: 0.75 }),
    box('#5b4636', [w - 0.08, 0.02, d - 0.08], [0, 0.45, 0])
  );
  const count = Math.max(3, Math.round(w * 3));
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 0.15 + random() * (w - 0.3);
    const s = 0.24 + random() * 0.2;
    g.add(
      facetPart(
        CROWN,
        GREENS[i % GREENS.length],
        [s, s * 1.1, s],
        [x, 0.5 + s * 0.4, (random() - 0.5) * (d - 0.2)],
        [random(), random(), 0],
        Math.abs(item.x * 7 + i)
      )
    );
    if (random() > 0.6)
      g.add(
        facetPart(
          CROWN,
          ['#f2cf7a', '#e8a8c0', '#ffffff', '#c9a6e8'][i % 4],
          [0.08, 0.08, 0.08],
          [x + 0.05, 0.6 + s * 0.7, (random() - 0.5) * (d - 0.3)],
          [0, 0, 0],
          i
        )
      );
  }
  return g;
}

/** The slim post a district sign stands on; the sign itself is drawn by the sign layer. */
export function signPost(): THREE.Group {
  return group(
    box(PALETTE.darkMetal, [0.3, 0.04, 0.3], [0, 0.02, 0], { metalness: 0.4, roughness: 0.5 }),
    box(PALETTE.darkMetal, [0.1, 2.62, 0.1], [0, 1.31, 0], { metalness: 0.4, roughness: 0.5 })
  );
}
