import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';
import { GEOMETRY, PALETTE, box, mat, part } from './materials';
import { LOW, bevelBox, facetPart, group, lathe, noShadow, pottedTuft, seeded } from './kit';
import { bake } from './batching';

/**
 * The play corners: foosball, an arcade cabinet, a dartboard, a vending machine, a snack shelf and
 * a small TV corner. Centred on the footprint at floor level, fronts toward +z (the camera). The
 * foosball rods of every table are two instanced meshes (one per team), turned while people play.
 */

const STEEL = { metalness: 0.5, roughness: 0.3 } as const;
const PLAYFIELD_Y = 0.66;
const ROD_Y = 0.8;

// ---------------------------------------------------------------- foosball

/** A rod across the table, in table-local metres: its place along the table and its team. */
export interface RodSlot {
  x: number;
  team: 0 | 1;
}

/** Goalie, defence, attack and midfield for each side, alternating along the table. */
const RODS: readonly RodSlot[] = [0, 0, 1, 0, 1, 0, 1, 1].map((team, i) => ({
  x: -0.49 + i * 0.14,
  team: team as 0 | 1
}));

export function foosballTable(item: FurnitureItem): { group: THREE.Group; rods: readonly RodSlot[] } {
  const { w, d } = item;
  const wood = '#6b4a32';
  const g = group(
    bevelBox(wood, [w, 0.05, d], [0, PLAYFIELD_Y - 0.025, 0], 0.01),
    box('#3f9a4a', [w - 0.08, 0.004, d - 0.08], [0, PLAYFIELD_Y + 0.002, 0], { roughness: 0.9 }),
    box('#f3ece2', [0.006, 0.005, d - 0.1], [0, PLAYFIELD_Y + 0.005, 0])
  );
  // The tray's walls, the goals at each end and four legs.
  for (const z of [-d / 2 + 0.015, d / 2 - 0.015])
    g.add(box(wood, [w, 0.24, 0.03], [0, PLAYFIELD_Y + 0.1, z]));
  for (const x of [-w / 2 + 0.015, w / 2 - 0.015]) {
    g.add(box(wood, [0.03, 0.24, d], [x, PLAYFIELD_Y + 0.1, 0]));
    g.add(box('#1f2328', [0.012, 0.07, 0.2], [x - Math.sign(x) * 0.018, PLAYFIELD_Y + 0.04, 0]));
  }
  for (const x of [-w / 2 + 0.08, w / 2 - 0.08])
    for (const z of [-d / 2 + 0.08, d / 2 - 0.08])
      g.add(box('#2b2f36', [0.06, PLAYFIELD_Y - 0.05, 0.06], [x, (PLAYFIELD_Y - 0.05) / 2, z]));
  return { group: g, rods: RODS };
}

/** One rod with its three players and a handle, in rod-local metres: the rod runs along z. */
function rodGeometry(team: 0 | 1): THREE.BufferGeometry {
  const kit = team === 0 ? '#d64545' : '#3b6fd6';
  const handleSide = team === 0 ? -1 : 1;
  const g = group(
    part(LOW.can, mat('#c9ced4', STEEL), [0.016, 1.0, 0.016], [0, 0, 0], [Math.PI / 2, 0, 0]),
    part(LOW.can, mat('#1f2328'), [0.035, 0.12, 0.035], [0, 0, handleSide * 0.52], [Math.PI / 2, 0, 0])
  );
  for (const z of [-0.2, 0, 0.2])
    g.add(
      box(kit, [0.028, 0.1, 0.022], [0, -0.05, z]),
      part(LOW.ball, mat('#f1d0b5'), [0.03, 0.03, 0.03], [0, 0.025, z]),
      box('#1f2328', [0.03, 0.02, 0.024], [0, -0.105, z])
    );
  const mesh = bake(g);
  const geometry = mesh.geometry;
  return geometry;
}

/** Every foosball table's rods; they twist and slide while someone plays at the table. */
export class FoosballRods {
  readonly object = new THREE.Group();
  private readonly teams: THREE.InstancedMesh[];
  private readonly tables: {
    matrix: THREE.Matrix4;
    spots: readonly string[];
    slots: { team: 0 | 1; x: number; index: number }[];
    busy: boolean;
  }[] = [];
  private readonly rod = new THREE.Matrix4();
  private readonly turn = new THREE.Matrix4();

  constructor(tables: { item: FurnitureItem; rods: readonly RodSlot[] }[]) {
    const count = [0, 0];
    for (const { rods } of tables) for (const rod of rods) count[rod.team]++;
    this.teams = ([0, 1] as const).map((team) => {
      const mesh = new THREE.InstancedMesh(
        rodGeometry(team),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
        Math.max(1, count[team])
      );
      mesh.name = `foosball-rods-${team}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.object.add(mesh);
      return mesh;
    });
    const next = [0, 0];
    for (const { item, rods } of tables) {
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(item.x, 0, item.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.rotation),
        new THREE.Vector3(1, 1, 1)
      );
      this.tables.push({
        matrix,
        spots: item.busyWith ?? [],
        slots: rods.map((rod) => ({ team: rod.team, x: rod.x, index: next[rod.team]++ })),
        busy: true
      });
    }
    this.update(0, () => false);
    for (const mesh of this.teams) mesh.computeBoundingSphere();
  }

  update(elapsed: number, busy: (spot: string) => boolean): void {
    const touched = new Set<THREE.InstancedMesh>();
    for (const table of this.tables) {
      const playing = table.spots.some(busy);
      if (!playing && !table.busy) continue;
      table.busy = playing;
      table.slots.forEach((slot, i) => {
        const angle = playing ? Math.sin(elapsed * 6 + i * 1.3) * 1.2 : 0;
        const slide = playing ? Math.sin(elapsed * 2.3 + i * 2.1) * 0.07 : 0;
        this.rod.makeTranslation(slot.x, ROD_Y, slide).multiply(this.turn.makeRotationZ(angle));
        const mesh = this.teams[slot.team];
        mesh.setMatrixAt(slot.index, this.rod.premultiply(table.matrix));
        touched.add(mesh);
      });
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of this.teams) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}

// ---------------------------------------------------------------- screens drawn once

const pictures = new Map<string, THREE.MeshBasicMaterial>();

/** A shared picture drawn once on a canvas: every cabinet (or TV) of a kind shows the same. */
function picture(
  key: string,
  width: number,
  height: number,
  draw: (g: CanvasRenderingContext2D) => void
): THREE.MeshBasicMaterial {
  const cached = pictures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture });
  pictures.set(key, material);
  return material;
}

/** A space shooter in chunky pixels: invaders, a ship and a score. */
function arcadeScreen(g: CanvasRenderingContext2D): void {
  g.fillStyle = '#0b0f1e';
  g.fillRect(0, 0, 96, 72);
  const random = seeded(7);
  for (let i = 0; i < 30; i++) {
    g.fillStyle = random() < 0.5 ? '#5b6477' : '#c9d2e3';
    g.fillRect(Math.floor(random() * 96), Math.floor(random() * 72), 1, 1);
  }
  const colors = ['#f472b6', '#facc15', '#34d399'];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 6; col++) {
      g.fillStyle = colors[row];
      const x = 14 + col * 12;
      const y = 12 + row * 9;
      g.fillRect(x, y, 7, 4);
      g.fillRect(x + 1, y + 4, 1, 2);
      g.fillRect(x + 5, y + 4, 1, 2);
    }
  g.fillStyle = '#60a5fa';
  g.fillRect(44, 60, 9, 4);
  g.fillRect(47, 57, 3, 3);
  g.fillStyle = '#f8fafc';
  g.fillRect(48, 44, 1, 6);
  g.fillStyle = '#facc15';
  g.font = 'bold 7px monospace';
  g.fillText('HI 09340', 4, 7);
}

/** A calm picture for the little TVs: a lake at dusk. */
function tvPicture(g: CanvasRenderingContext2D): void {
  const sky = g.createLinearGradient(0, 0, 0, 90);
  sky.addColorStop(0, '#f6c28b');
  sky.addColorStop(1, '#e58b8b');
  g.fillStyle = sky;
  g.fillRect(0, 0, 160, 90);
  g.fillStyle = '#6d5a8a';
  g.beginPath();
  g.moveTo(0, 60);
  g.lineTo(40, 34);
  g.lineTo(70, 52);
  g.lineTo(110, 28);
  g.lineTo(160, 58);
  g.lineTo(160, 90);
  g.lineTo(0, 90);
  g.fill();
  g.fillStyle = '#4a6fa5';
  g.fillRect(0, 64, 160, 26);
  g.fillStyle = 'rgba(255,240,200,0.8)';
  g.beginPath();
  g.arc(120, 40, 9, 0, Math.PI * 2);
  g.fill();
}

// ---------------------------------------------------------------- the rest of the corner

const CABINETS = [
  { body: '#3b2f7a', art: '#ec4899', marquee: '#facc15' },
  { body: '#1f4f8a', art: '#22d3ee', marquee: '#f472b6' },
  { body: '#8a2f4f', art: '#facc15', marquee: '#34d399' }
] as const;

export function arcadeCabinet(item: FurnitureItem): THREE.Group {
  const style = CABINETS[Math.abs(Math.round(item.x * 3 + item.z)) % CABINETS.length];
  const screen = part(
    GEOMETRY.plane,
    picture('arcade', 96, 72, arcadeScreen),
    [0.5, 0.38, 1],
    [0, 1.33, 0.1],
    [-0.22, 0, 0]
  );
  screen.castShadow = false;
  const g = group(
    bevelBox(style.body, [0.66, 0.95, 0.6], [0, 0.475, -0.05], 0.015),
    bevelBox(style.body, [0.66, 0.62, 0.42], [0, 1.3, -0.14], 0.015),
    bevelBox(style.body, [0.66, 0.18, 0.46], [0, 1.72, -0.1], 0.015),
    box('#16181c', [0.56, 0.44, 0.02], [0, 1.33, 0.085], { roughness: 0.4 }),
    screen,
    part(
      GEOMETRY.box,
      mat(style.marquee, { emissive: style.marquee, emissiveIntensity: 0.9 }),
      [0.58, 0.12, 0.01],
      [0, 1.72, 0.135]
    )
  );
  // Side art, and the control panel with a joystick and four buttons.
  const panel = group(box('#16181c', [0.66, 0.06, 0.3], [0, 0, 0]));
  panel.add(
    part(LOW.can, mat('#1f2328'), [0.02, 0.08, 0.02], [-0.16, 0.06, 0]),
    part(LOW.ball, mat('#e24b4b'), [0.045, 0.045, 0.045], [-0.16, 0.1, 0])
  );
  ['#e24b4b', '#facc15', '#34d399', '#60a5fa'].forEach((color, i) =>
    panel.add(
      part(
        LOW.can,
        mat(color, { roughness: 0.4 }),
        [0.035, 0.02, 0.035],
        [0.02 + (i % 2) * 0.07, 0.035, -0.04 + Math.floor(i / 2) * 0.07]
      )
    )
  );
  panel.position.set(0, 1.0, 0.18);
  panel.rotation.x = 0.35;
  const art = group();
  for (const side of [-1, 1]) {
    art.add(box(style.art, [0.004, 0.5, 0.08], [side * 0.332, 0.7, 0.05]));
    art.add(box('#f8fafc', [0.004, 0.2, 0.05], [side * 0.332, 1.25, -0.1]));
  }
  g.add(noShadow(panel), noShadow(art));
  return g;
}

export function dartboard(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const disc = (color: string, r: number, z: number) =>
    part(LOW.can, mat(color, { roughness: 0.9 }), [r * 2, 0.012, r * 2], [0, 1.6, z], [Math.PI / 2, 0, 0]);
  const board = group(
    part(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
      mat('#1f2328'),
      [0.46, 0.04, 0.46],
      [0, 1.6, -0.06],
      [Math.PI / 2, 0, 0]
    ),
    disc('#f1e6c8', 0.19, -0.035),
    disc('#2f7a4a', 0.17, -0.03),
    disc('#f1e6c8', 0.15, -0.025),
    disc('#c0392b', 0.11, -0.02),
    disc('#f1e6c8', 0.09, -0.015),
    disc('#2f7a4a', 0.035, -0.01),
    disc('#c0392b', 0.016, -0.005)
  );
  for (const [x, y] of [
    [0.04, 1.63],
    [-0.07, 1.55],
    [0.01, 1.58]
  ] as const)
    board.add(
      box('#2b2f36', [0.006, 0.006, 0.09], [x, y, 0.01]),
      box('#facc15', [0.02, 0.02, 0.004], [x, y, 0.05])
    );
  return group(
    box('#2b2f36', [w, 0.03, d], [0, 0.015, 0]),
    box(PALETTE.woodDark, [0.06, 1.85, 0.05], [0, 0.925, -0.1]),
    noShadow(board)
  );
}

const SNACKS = ['#e24b4b', '#facc15', '#34d399', '#60a5fa', '#f472b6', '#f97316', '#8b5cf6'];

export function vendingMachine(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const random = seeded(item.x * 3 + item.z);
  const front = d / 2;
  const g = group(
    bevelBox('#b3282d', [w, 1.85, d], [0, 0.925, 0], 0.02),
    part(
      GEOMETRY.box,
      mat('#e8f4fb', { emissive: '#dff1f8', emissiveIntensity: 0.55 }),
      [0.56, 1.2, 0.01],
      [-0.1, 1.15, front + 0.004]
    ),
    box('#f6f5f2', [w - 0.1, 0.12, 0.01], [0, 1.72, front + 0.004]),
    box('#1f2328', [0.56, 0.18, 0.02], [-0.1, 0.3, front + 0.008]),
    box('#2b2f36', [0.2, 0.46, 0.012], [0.3, 1.2, front + 0.006])
  );
  const shelves = group();
  for (let row = 0; row < 5; row++) {
    const y = 0.64 + row * 0.22;
    shelves.add(box('#9aa1ab', [0.54, 0.008, 0.02], [-0.1, y - 0.01, front + 0.02]));
    for (let col = 0; col < 5; col++)
      shelves.add(
        box(
          SNACKS[Math.floor(random() * SNACKS.length)],
          [0.075, 0.12, 0.015],
          [-0.32 + col * 0.11, y + 0.06, front + 0.02]
        )
      );
  }
  for (let i = 0; i < 9; i++)
    shelves.add(
      box(
        '#c9ced4',
        [0.035, 0.035, 0.01],
        [0.26 + (i % 3) * 0.045, 1.3 - Math.floor(i / 3) * 0.05, front + 0.014]
      )
    );
  g.add(noShadow(shelves));
  return g;
}

export function snackShelf(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const wood = '#c9a36b';
  const g = group();
  for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) g.add(box(wood, [0.03, 1.2, d], [x, 0.6, 0]));
  for (const y of [0.05, 0.42, 0.8, 1.18]) g.add(box(wood, [w, 0.03, d], [0, y, 0]));
  g.add(box(wood, [w, 1.2, 0.02], [0, 0.6, -d / 2 + 0.01]));
  const stock = group();
  // Cereal boxes below, jars of nuts and sweets in the middle, a fruit bowl on top.
  [
    ['#f97316', -0.4],
    ['#facc15', -0.22],
    ['#60a5fa', -0.04],
    ['#e24b4b', 0.14]
  ].forEach(([color, x]) => stock.add(box(color as string, [0.14, 0.3, 0.07], [x as number, 0.215, 0.02])));
  ['#8a5a2b', '#f472b6', '#c9a36b', '#34d399'].forEach((contents, i) =>
    stock.add(
      lathe(
        [
          [0, 0],
          [0.06, 0],
          [0.06, 0.2],
          [0.045, 0.22],
          [0, 0.22]
        ],
        contents,
        [-0.42 + i * 0.26, 0.435, 0.02],
        8,
        { roughness: 0.4 }
      )
    )
  );
  const bowl = lathe(
    [
      [0, 0],
      [0.08, 0],
      [0.16, 0.08],
      [0.15, 0.085],
      [0, 0.02]
    ],
    '#f4f1ec',
    [0.2, 1.195, 0],
    12,
    { roughness: 0.3 }
  );
  stock.add(bowl);
  ['#e24b4b', '#facc15', '#7fb24a', '#f97316', '#e24b4b'].forEach((color, i) => {
    const angle = i * 1.25;
    stock.add(
      facetPart(
        LOW.gem,
        color,
        [0.08, 0.08, 0.08],
        [0.2 + Math.sin(angle) * 0.06, 1.26 + (i === 4 ? 0.05 : 0), Math.cos(angle) * 0.06],
        [0, i, 0],
        i + 3
      )
    );
  });
  stock.add(box('#3a2c24', [0.22, 0.12, 0.14], [-0.3, 1.255, 0]));
  g.add(noShadow(stock));
  return g;
}

export function tvCorner(item: FurnitureItem): THREE.Group {
  const { w, d } = item;
  const screen = part(
    GEOMETRY.plane,
    picture('tv-corner', 160, 90, tvPicture),
    [0.9, 0.5, 1],
    [0, 0.92, 0.024]
  );
  screen.castShadow = false;
  const g = group(
    bevelBox('#6b4a32', [w, 0.42, d], [0, 0.25, 0], 0.015),
    box('#2b2f36', [0.3, 0.02, 0.2], [0, 0.47, -0.02]),
    box('#2b2f36', [0.05, 0.14, 0.04], [0, 0.54, -0.04]),
    bevelBox('#16181c', [0.96, 0.56, 0.04], [0, 0.92, 0], 0.01, { roughness: 0.4 }),
    screen
  );
  const decor = pottedTuft(1, PALETTE.white, Math.abs(Math.round(item.x + item.z)));
  decor.position.set(-w / 2 + 0.2, 0.46, 0);
  g.add(
    decor,
    noShadow(
      group(
        box('#e0b36a', [0.18, 0.03, 0.24], [w / 2 - 0.25, 0.475, 0.02]),
        box('#3d5a80', [0.17, 0.03, 0.23], [w / 2 - 0.25, 0.505, 0.02])
      )
    )
  );
  return g;
}
