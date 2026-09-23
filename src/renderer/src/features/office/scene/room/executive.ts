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
    const block = box(ART_PALETTE[Math.floor(random() * ART_PALETTE.length)], [bw, bh, 0.004], [x, y, 0.025 + i * 0.001]);
    block.castShadow = false;
    g.add(block);
  }
  return g;
}

/** Walnut panelling across a solid back wall, with a painting hung above the credenza. */
export function wallArt(item: FurnitureItem): THREE.Group {
  const { w } = item;
  const g = group();
  const boards = Math.max(1, Math.round(w / 0.3));
  const boardWidth = w / boards;
  for (let i = 0; i < boards; i++) {
    const board = box(
      i % 2 ? WALNUT : WALNUT_LIGHT,
      [boardWidth - 0.01, 2.3, 0.015],
      [-w / 2 + boardWidth * (i + 0.5), 1.15, 0]
    );
    board.castShadow = false;
    g.add(board);
  }
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
const rugMaterials = new Map<number, THREE.MeshStandardMaterial>();

/** One painted rug per palette: a border, an inner line, a plain field and a round medallion. */
function rugMaterial(palette: number): THREE.MeshStandardMaterial {
  let material = rugMaterials.get(palette);
  if (material) return material;
  const [border, field, accent] = RUGS[palette];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 432;
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = border;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = field;
  ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(24, 24, w - 48, h - 48);
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 52, 0, Math.PI * 2);
  ctx.fillStyle = border;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 28, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 1,
    // Pulled toward the camera in the depth test so it never z-fights the floor beneath.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  rugMaterials.set(palette, material);
  return material;
}

/** A patterned rug, its palette chosen by where it lies. */
export function execRug(item: FurnitureItem): THREE.Mesh {
  const palette = Math.abs(Math.round(item.x * 3 + item.z)) % RUGS.length;
  const mesh = part(GEOMETRY.plane, rugMaterial(palette), [item.w, item.d, 1], [0, 0.012, 0], [-Math.PI / 2, 0, 0]);
  mesh.castShadow = false;
  return mesh;
}
