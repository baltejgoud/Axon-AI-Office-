import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { bookRow, group, seeded } from './kit';
import { GEOMETRY, PALETTE, box, cylinder, lampGlow, mat, part } from './materials';

/**
 * The Leadership Suite's offices: walnut desks, leather chairs, a credenza with books and a lamp,
 * art on the wall and a patterned rug. Same conventions as furniture.ts: centred on the
 * footprint at floor level, front facing +z.
 */

const WALNUT = '#6b4429';
const WALNUT_DARK = '#533320';
const WALNUT_LIGHT = '#85573a';
const LEATHER = '#4a3326';
const BRASS = { metalness: 0.6, roughness: 0.35 } as const;
const CHROME = { metalness: 0.6, roughness: 0.3 } as const;

/** A walnut desk on panel legs, with a modesty panel toward the visitor and a leather pad. */
export function execDesk(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = group(
    box(WALNUT, [w, 0.05, d], [0, 0.745, 0], { roughness: 0.45 }),
    box(WALNUT_DARK, [0.05, 0.72, d - 0.08], [-w / 2 + 0.06, 0.36, 0]),
    box(WALNUT_DARK, [0.05, 0.72, d - 0.08], [w / 2 - 0.06, 0.36, 0]),
    box(WALNUT_DARK, [w - 0.16, 0.42, 0.03], [0, 0.5, d / 2 - 0.08]),
    box('#3a2a20', [0.62, 0.006, 0.42], [0, 0.773, -0.1], { roughness: 0.7 }),
    cylinder('#b8914f', 0.035, 0.09, [w / 2 - 0.25, 0.815, -0.2], BRASS)
  );
  for (let i = 0; i < 3; i++)
    g.add(box(PALETTE.paper, [0.22, 0.004, 0.3], [-w / 2 + 0.35 + i * 0.012, 0.774 + i * 0.004, 0.05]));
  return g;
}

/** A high-backed leather chair on a chrome star base. */
export function execChair(): THREE.Group {
  const leather = { roughness: 0.55 } as const;
  const g = group(
    box(LEATHER, [0.54, 0.11, 0.52], [0, 0.46, 0], leather),
    part(GEOMETRY.box, mat(LEATHER, leather), [0.52, 0.8, 0.11], [0, 0.93, -0.25], [-0.1, 0, 0]),
    part(GEOMETRY.box, mat('#5a3f30', leather), [0.4, 0.16, 0.06], [0, 1.2, -0.19], [-0.1, 0, 0]),
    box(LEATHER, [0.07, 0.06, 0.42], [-0.29, 0.66, 0], leather),
    box(LEATHER, [0.07, 0.06, 0.42], [0.29, 0.66, 0], leather),
    box(PALETTE.metal, [0.03, 0.18, 0.03], [-0.29, 0.54, 0.05], CHROME),
    box(PALETTE.metal, [0.03, 0.18, 0.03], [0.29, 0.54, 0.05], CHROME),
    cylinder(PALETTE.metal, 0.025, 0.34, [0, 0.25, 0], CHROME),
    cylinder(PALETTE.metal, 0.05, 0.05, [0, 0.07, 0], CHROME)
  );
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    g.add(
      part(
        GEOMETRY.box,
        mat(PALETTE.metal, CHROME),
        [0.035, 0.03, 0.26],
        [Math.sin(angle) * 0.12, 0.045, Math.cos(angle) * 0.12],
        [0, angle, 0]
      )
    );
  }
  return g;
}

/** A low walnut credenza: books on one half, a brass table lamp on the other. */
export function execCredenza(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const g = group(
    box(WALNUT, [w, 0.68, d], [0, 0.36, 0]),
    box(WALNUT_LIGHT, [w + 0.03, 0.03, d + 0.02], [0, 0.715, 0], { roughness: 0.45 }),
    box(WALNUT_DARK, [w - 0.02, 0.04, d - 0.04], [0, 0.02, 0])
  );
  for (let i = 1; i < 4; i++)
    g.add(box(WALNUT_DARK, [0.01, 0.58, 0.01], [-w / 2 + (i * w) / 4, 0.38, d / 2 + 0.005]));
  const random = seeded(item.x * 5 + item.z);
  bookRow(g, random, -w / 2 + 0.1, -0.05, 0.73, d * 0.55, 0);
  g.add(box(PALETTE.darkMetal, [0.02, 0.2, 0.14], [-0.04, 0.83, 0]));
  g.add(
    cylinder('#b8914f', 0.07, 0.02, [w / 2 - 0.32, 0.74, 0], BRASS),
    cylinder('#b8914f', 0.012, 0.36, [w / 2 - 0.32, 0.92, 0], BRASS),
    part(GEOMETRY.cone, lampGlow.table(), [0.28, 0.2, 0.28], [w / 2 - 0.32, 1.13, 0])
  );
  return g;
}

const ART_PALETTE = ['#c9784d', '#e3b85f', '#5f7f8c', '#8a9a6b', '#b04a3f', '#2f3e5c', '#d9cbb3', '#7a5c8c'];

/** A framed abstract of a few colour blocks, seeded so every office hangs its own. */
function artwork(width: number, height: number, seed: number): THREE.Group {
  const random = seeded(seed);
  const g = group(
    box('#b8914f', [width, height, 0.03], [0, 0, 0], BRASS),
    box('#f3eee4', [width - 0.08, height - 0.08, 0.01], [0, 0, 0.018])
  );
  const blocks = 3 + Math.floor(random() * 2);
  for (let i = 0; i < blocks; i++) {
    const bw = (0.2 + random() * 0.45) * (width - 0.1);
    const bh = (0.2 + random() * 0.5) * (height - 0.1);
    const x = (random() - 0.5) * (width - 0.1 - bw);
    const y = (random() - 0.5) * (height - 0.1 - bh);
    g.add(
      box(ART_PALETTE[Math.floor(random() * ART_PALETTE.length)], [bw, bh, 0.004], [x, y, 0.025 + i * 0.001])
    );
  }
  return g;
}

/** Walnut panelling across a solid back wall, with a painting hung above the credenza. */
export function wallArt(item: FurnitureItem): THREE.Group {
  const { w } = item;
  const g = group();
  const boards = Math.max(1, Math.round(w / 0.3));
  const boardWidth = w / boards;
  for (let i = 0; i < boards; i++)
    g.add(
      box(i % 2 ? WALNUT : WALNUT_LIGHT, [boardWidth - 0.01, 2.3, 0.015], [-w / 2 + boardWidth * (i + 0.5), 1.15, 0])
    );
  const painting = artwork(1.1, 0.75, item.x * 3 + item.z);
  painting.position.set(0, 1.62, 0.02);
  g.add(painting);
  return g;
}

/** A walnut dado with a picture ledge and a painting leaning on it, for offices with a glass back. */
export function ledgeArt(item: FurnitureItem): THREE.Group {
  const { w } = item;
  const g = group(
    box(WALNUT, [w, 1.0, 0.04], [0, 0.5, -0.02]),
    box(WALNUT_LIGHT, [w, 0.03, 0.12], [0, 1.0, 0])
  );
  const painting = artwork(0.8, 0.6, item.x * 7 + item.z);
  painting.position.set(0.35, 1.32, 0.02);
  painting.rotation.x = -0.12;
  g.add(painting);
  return g;
}

const RUGS = [
  ['#7a2e2e', '#e9dcc3', '#c9a26b'],
  ['#2f3e5c', '#e2d3b5', '#b58b58'],
  ['#2f5a44', '#eadfc2', '#c9a24b'],
  ['#3a3d42', '#e6dccb', '#a24b2a']
] as const;
const rugLayers = new Map<string, THREE.MeshStandardMaterial>();

/** Layered flat rug material, pulled toward the camera a little more for each layer so none z-fight. */
function rugLayer(color: string, layer: number): THREE.MeshStandardMaterial {
  const key = `${color}|${layer}`;
  let material = rugLayers.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -2 - layer,
      polygonOffsetUnits: -2 - layer
    });
    rugLayers.set(key, material);
  }
  return material;
}

/** A rug with a border, a plain field and a round medallion in the middle. */
export function execRug(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const [border, field, accent] = RUGS[Math.abs(Math.round(item.x * 3 + item.z)) % RUGS.length];
  const flat = (material: THREE.Material, size: [number, number], y: number, disc = false) => {
    const mesh = part(disc ? GEOMETRY.disc : GEOMETRY.plane, material, [size[0], size[1], 1], [0, y, 0], [
      -Math.PI / 2,
      0,
      0
    ]);
    mesh.castShadow = false;
    return mesh;
  };
  return group(
    flat(rugLayer(border, 0), [w, d], 0.012),
    flat(rugLayer(field, 1), [w - 0.36, d - 0.36], 0.013),
    flat(rugLayer(accent, 2), [w - 0.52, d - 0.52], 0.0135),
    flat(rugLayer(field, 3), [w - 0.6, d - 0.6], 0.014),
    flat(rugLayer(border, 4), [1.3, 1.3], 0.015, true),
    flat(rugLayer(accent, 5), [0.7, 0.7], 0.016, true)
  );
}
