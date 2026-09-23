import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DESK_SETUPS,
  FURNITURE,
  ROOM,
  WALLS,
  WALL_THICKNESS,
  poiById,
  type Wall
} from '../../simulation/layout';
import type { ScreenState } from '../../simulation/types';
import { SEAT_HEIGHT, SOFA_SEAT_HEIGHT, buildFurniture, workstation } from './furniture';
import { GEOMETRY, PALETTE, box, mat, part, woodFloorTexture } from './materials';

const SCREEN_GLOW: Record<ScreenState, number> = { off: 0.05, on: 0.55, active: 1.05 };

export interface OfficeRoom {
  root: THREE.Group;
  seatHeight(poiId: string): number;
  update(
    dt: number,
    elapsed: number,
    screens: (deskId: string) => ScreenState,
    busy: (poiId: string) => boolean
  ): void;
  dispose(): void;
}

function wallMesh(w: Wall): THREE.Group {
  const g = new THREE.Group();
  const length = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z);
  const alongX = Math.abs(w.to.x - w.from.x) > Math.abs(w.to.z - w.from.z);
  g.position.set((w.from.x + w.to.x) / 2, 0, (w.from.z + w.to.z) / 2);
  g.rotation.y = alongX ? 0 : Math.PI / 2;
  if (w.kind === 'glass') {
    const pane = part(
      GEOMETRY.box,
      mat(PALETTE.glass, { transparent: true, opacity: 0.2, roughness: 0.1 }),
      [length, w.height - 0.1, 0.02],
      [0, w.height / 2, 0]
    );
    pane.castShadow = false;
    pane.renderOrder = 1;
    g.add(pane);
    const frame = mat(PALETTE.bronze, { metalness: 0.5, roughness: 0.4 });
    g.add(part(GEOMETRY.box, frame, [length, 0.05, 0.06], [0, w.height, 0]));
    g.add(part(GEOMETRY.box, frame, [length, 0.06, 0.06], [0, 0.03, 0]));
    const mullions = Math.max(1, Math.round(length / 1.3));
    for (let i = 0; i <= mullions; i++)
      g.add(
        part(
          GEOMETRY.box,
          frame,
          [0.045, w.height, 0.06],
          [-length / 2 + (i * length) / mullions, w.height / 2, 0]
        )
      );
    return g;
  }
  const color = w.kind === 'low' ? PALETTE.slab : PALETTE.wall;
  g.add(box(color, [length + WALL_THICKNESS, w.height, WALL_THICKNESS], [0, w.height / 2, 0]));
  g.add(
    box(PALETTE.wallCap, [length + WALL_THICKNESS, 0.04, WALL_THICKNESS + 0.01], [0, w.height + 0.02, 0])
  );
  return g;
}

/** Windows, wood slats and framed art on the two full-height walls. */
function wallDecor(): THREE.Group {
  const g = new THREE.Group();
  const innerLeft = ROOM.minX + WALL_THICKNESS / 2 + 0.01;
  const innerBack = ROOM.minZ + WALL_THICKNESS / 2 + 0.01;
  const glassMat = mat(PALETTE.window, { emissive: '#e8f3fb', emissiveIntensity: 0.35, roughness: 0.2 });
  for (const [from, to] of [
    [-8.6, -4.8],
    [-3.4, 2.8],
    [4.6, 8.0]
  ]) {
    const length = to - from;
    const centre = (from + to) / 2;
    const pane = part(GEOMETRY.box, glassMat, [0.02, 1.5, length], [innerLeft, 1.55, centre]);
    pane.castShadow = false;
    g.add(pane, box(PALETTE.white, [0.08, 0.05, length + 0.1], [innerLeft + 0.03, 0.78, centre]));
    const panes = Math.round(length / 1.2);
    for (let i = 0; i <= panes; i++)
      g.add(box(PALETTE.darkMetal, [0.03, 1.5, 0.04], [innerLeft + 0.01, 1.55, from + (i * length) / panes]));
    g.add(box(PALETTE.darkMetal, [0.03, 0.04, length], [innerLeft + 0.01, 2.3, centre]));
  }
  for (const [from, to] of [
    [-12.7, -11.6],
    [11.9, 12.8]
  ]) {
    for (let x = from; x < to; x += 0.09)
      g.add(box(PALETTE.wood, [0.05, 2.55, 0.05], [x, 1.3, innerBack + 0.03]));
  }
  const art = (x: number, y: number, width: number, height: number, colors: string[]) => {
    g.add(box(PALETTE.woodDark, [width + 0.06, height + 0.06, 0.03], [x, y, innerBack + 0.015]));
    g.add(box('#f5f1ea', [width, height, 0.01], [x, y, innerBack + 0.035]));
    colors.forEach((color, index) =>
      g.add(
        box(
          color,
          [width * 0.7, height * 0.18, 0.005],
          [x, y - height * 0.25 + index * height * 0.2, innerBack + 0.042]
        )
      )
    );
  };
  art(-9.4, 1.75, 1.2, 0.8, ['#8fa8c4', '#c9b6a0', '#6d8fb0']);
  art(-7.0, 1.7, 0.6, 0.8, ['#d5b98a', '#9fb4a1']);
  art(10.5, 1.7, 0.8, 0.6, ['#8fa8c4', '#b5c7d6']);
  const clock = part(
    GEOMETRY.cylinder,
    mat(PALETTE.white),
    [0.34, 0.03, 0.34],
    [4.9, 2.4, innerBack + 0.02],
    [Math.PI / 2, 0, 0]
  );
  g.add(
    clock,
    box(PALETTE.darkMetal, [0.015, 0.12, 0.01], [4.9, 2.44, innerBack + 0.04]),
    box(PALETTE.darkMetal, [0.09, 0.015, 0.01], [4.94, 2.4, innerBack + 0.04])
  );
  return g;
}

function floor(): THREE.Group {
  const width = ROOM.maxX - ROOM.minX;
  const depth = ROOM.maxZ - ROOM.minZ;
  const texture = woodFloorTexture();
  texture.repeat.set(width / 4, depth / 4);
  const surface = part(
    GEOMETRY.plane,
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78 }),
    [width, depth, 1],
    [(ROOM.minX + ROOM.maxX) / 2, 0, 0],
    [-Math.PI / 2, 0, 0]
  );
  surface.castShadow = false;
  // The slab's top sits just under the floor; coplanar faces would z-fight into grey streaks.
  const slab = box(PALETTE.slab, [width + 0.3, 0.32, depth + 0.3], [(ROOM.minX + ROOM.maxX) / 2, -0.18, 0]);
  slab.castShadow = false;
  const g = new THREE.Group();
  g.add(surface, slab);
  return g;
}

/** Collapses every static mesh into one mesh per material: a whole office in a few dozen draw calls. */
function mergeStatic(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<
    string,
    {
      material: THREE.Material;
      geometries: THREE.BufferGeometry[];
      cast: boolean;
      receive: boolean;
      order: number;
    }
  >();
  const merged: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.dynamic || Array.isArray(object.material)) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    for (const name of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    const key = `${object.material.uuid}|${object.castShadow}|${object.receiveShadow}|${geometry.index ? 'i' : 'n'}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: object.material,
        geometries: [],
        cast: object.castShadow,
        receive: object.receiveShadow,
        order: object.renderOrder
      };
      buckets.set(key, bucket);
    }
    bucket.geometries.push(geometry);
    merged.push(object);
  });
  for (const mesh of merged) mesh.removeFromParent();
  for (const bucket of buckets.values()) {
    const geometry = mergeGeometries(bucket.geometries);
    bucket.geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.renderOrder = bucket.order;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}

export function buildOffice(): OfficeRoom {
  const root = new THREE.Group();
  root.add(floor(), wallDecor());
  for (const w of WALLS) root.add(wallMesh(w));

  const lights: { poiId: string; mesh: THREE.Mesh }[] = [];
  for (const item of FURNITURE) {
    const built = buildFurniture(item);
    built.object.position.set(item.x, 0, item.z);
    built.object.rotation.y = item.rotation;
    root.add(built.object);
    if (built.light)
      lights.push({ poiId: item.kind === 'printer' ? 'printer' : 'cafe-machine', mesh: built.light });
  }

  const displays = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>[]>();
  for (const setup of DESK_SETUPS) {
    const seat = poiById(setup.poiId);
    const station = workstation(
      setup.equipment,
      setup.props,
      setup.flavor ?? 'code',
      setup.accent ?? PALETTE.white
    );
    station.object.position.set(seat.position.x, 0, seat.position.z);
    station.object.rotation.y = seat.facing;
    root.add(station.object);
    displays.set(setup.poiId, station.displays);
  }

  mergeStatic(root);

  const seatKinds = new Map(FURNITURE.map((item) => [item.id, item.kind]));
  const glow = new Map<string, number>();

  return {
    root,
    seatHeight(poiId) {
      if (poiId.startsWith('lounge-sofa')) return SOFA_SEAT_HEIGHT;
      const kind = seatKinds.get(`${poiId}-seat`);
      return (kind && SEAT_HEIGHT[kind]) ?? 0.48;
    },
    update(dt, elapsed, screens, busy) {
      const ease = 1 - Math.exp(-dt * 4);
      for (const [deskId, meshes] of displays) {
        const state = screens(deskId);
        const current = glow.get(deskId) ?? SCREEN_GLOW.off;
        const next = current + (SCREEN_GLOW[state] - current) * ease;
        glow.set(deskId, next);
        for (const mesh of meshes) {
          mesh.material.emissiveIntensity = next;
          // Real work scrolls the screen; idle desks sit still.
          if (state === 'active' && mesh.material.emissiveMap)
            mesh.material.emissiveMap.offset.y = (elapsed * 0.035) % 0.5;
        }
      }
      for (const { poiId, mesh } of lights) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = busy(poiId)
          ? 0.9 + Math.sin(elapsed * (poiId === 'printer' ? 9 : 4)) * 0.6
          : 0.35;
      }
    },
    dispose() {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (!Object.values(GEOMETRY).includes(object.geometry as never)) object.geometry.dispose();
        const material = object.material as THREE.MeshStandardMaterial;
        if (material.emissiveMap && object.userData.dynamic) material.emissiveMap.dispose();
        if (object.userData.dynamic) material.dispose();
      });
    }
  };
}
