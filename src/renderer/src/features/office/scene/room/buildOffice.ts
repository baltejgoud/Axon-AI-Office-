import * as THREE from 'three';
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
import { DISTRICTS, type FloorKind } from '../../campus/districts';
import { COMMONS_BACK_Z } from '../../campus/commons';
import { SEAT_HEIGHT, SOFA_SEAT_HEIGHT, buildFurniture } from './furniture';
import { workstation } from './desks';
import { surfaceOf } from '../../campus/deskPlacement';
import { animateSteam } from './kit';
import { batchStatic } from './batching';
import { CONTACT_OPACITY, contactMaterials, contactShadows } from './grounding';
import { wallOutward, wallSlab } from './walls';
import {
  GEOMETRY,
  PALETTE,
  box,
  carpetTexture,
  concreteTexture,
  mat,
  part,
  terrazzoTexture,
  windowGlass,
  woodFloorTexture,
  type ScreenFlavor
} from './materials';
import { DeskScreens, type ScreenSlot } from './screens';
import type { KitchenFx } from './kitchen';

export interface OfficeRoom {
  root: THREE.Group;
  /** The kitchen's flames, steam and pan, for the chefs to drive. */
  kitchen: KitchenFx | null;
  seatHeight(poiId: string): number;
  /** Contact shadows carry the grounding alone without ambient occlusion, so they darken then. */
  setAmbientOcclusion(on: boolean): void;
  update(
    dt: number,
    elapsed: number,
    screens: (deskId: string) => ScreenState,
    busy: (poiId: string) => boolean
  ): void;
  dispose(): void;
}

/** The dark cut-away top every solid and low wall wears, like a sectioned model. */
const WALL_CAP = '#3d4450';
/** Sills and top rails of the glass walls. */
const GLASS_TRIM = '#8a7a66';

function wallMesh(w: Wall): THREE.Group {
  const g = new THREE.Group();
  const length = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z);
  const alongX = Math.abs(w.to.x - w.from.x) > Math.abs(w.to.z - w.from.z);
  const { thickness, offset } = wallSlab(w, ROOM);
  const out = wallOutward(w, ROOM);
  g.position.set((w.from.x + w.to.x) / 2 + out.x * offset, 0, (w.from.z + w.to.z) / 2 + out.z * offset);
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
    g.add(box(GLASS_TRIM, [length, 0.06, 0.1], [0, w.height, 0], { roughness: 0.6 }));
    g.add(box(GLASS_TRIM, [length, 0.08, 0.1], [0, 0.04, 0], { roughness: 0.6 }));
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
  // Long enough to close the corners, including the part a thicker wall grows outward.
  const run = length + thickness + offset * 2;
  g.add(box(color, [run, w.height, thickness], [0, w.height / 2, 0]));
  g.add(
    box(WALL_CAP, [run + 0.004, 0.035, thickness + 0.004], [0, w.height + 0.0175, 0], { roughness: 0.7 })
  );
  return g;
}

const WINDOW_FRAME = '#5a6270';

/** A run of tall windows along one of the two full-height perimeter walls. */
function windowBays(g: THREE.Group, alongX: boolean, fixed: number, from: number, to: number): void {
  const glassMat = windowGlass();
  const bay = 3.6;
  const pitch = 6;
  for (let start = from + 1.2; start + bay <= to - 1; start += pitch) {
    const centre = start + bay / 2;
    const at = (along: number, y: number, depth = 0): [number, number, number] =>
      alongX ? [along, y, fixed + depth] : [fixed + depth, y, along];
    const size = (length: number, height: number, thick: number): [number, number, number] =>
      alongX ? [length, height, thick] : [thick, height, length];
    const pane = part(GEOMETRY.box, glassMat, size(bay, 1.9, 0.02), at(centre, 1.45));
    pane.castShadow = false;
    // A deep sill, a head over the bay and slim mullions.
    g.add(
      pane,
      box(PALETTE.white, size(bay + 0.16, 0.06, 0.14), at(centre, 0.47, 0.06)),
      box(PALETTE.white, size(bay + 0.1, 0.07, 0.07), at(centre, 2.43, 0.03))
    );
    const mullions = 3;
    for (let i = 0; i <= mullions; i++)
      g.add(box(WINDOW_FRAME, size(0.045, 1.9, 0.04), at(start + (i * bay) / mullions, 1.45, 0.015)));
    g.add(box(WINDOW_FRAME, size(bay, 0.04, 0.04), at(centre, 1.95, 0.015)));
  }
}

/** Windows on the tall perimeter walls; wood slats, framed art and a clock on the Commons wall. */
function wallDecor(): THREE.Group {
  const g = new THREE.Group();
  windowBays(g, false, ROOM.minX + WALL_THICKNESS / 2 + 0.01, ROOM.minZ, ROOM.maxZ);
  windowBays(g, true, ROOM.minZ + WALL_THICKNESS / 2 + 0.01, ROOM.minX, ROOM.maxX);
  const innerBack = COMMONS_BACK_Z + WALL_THICKNESS / 2 + 0.01;
  // Wood slats in the Lounge's corner.
  for (let x = -19.3; x < -18.1; x += 0.09)
    g.add(box(PALETTE.wood, [0.05, 2.55, 0.05], [x, 1.3, innerBack + 0.03]));
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
  // Art over the Lounge sofa, and a clock over the Marketing Strategist's desk.
  art(-16.3, 1.75, 1.2, 0.8, ['#8fa8c4', '#c9b6a0', '#6d8fb0']);
  art(-14.5, 1.7, 0.6, 0.8, ['#d5b98a', '#9fb4a1']);
  const clock = part(
    GEOMETRY.cylinder,
    mat(PALETTE.white),
    [0.34, 0.03, 0.34],
    [-12.1, 2.25, innerBack + 0.02],
    [Math.PI / 2, 0, 0]
  );
  g.add(
    clock,
    box(PALETTE.darkMetal, [0.015, 0.12, 0.01], [-12.1, 2.29, innerBack + 0.04]),
    box(PALETTE.darkMetal, [0.09, 0.015, 0.01], [-12.06, 2.25, innerBack + 0.04])
  );
  return g;
}

/** Floor finish per district: texture, tint and how many metres one texture tile covers. */
const FLOORS: Record<FloorKind | 'corridor', { texture: () => THREE.Texture; tint: string; tile: number }> = {
  corridor: { texture: concreteTexture, tint: '#f7f4ef', tile: 6 },
  oak: { texture: woodFloorTexture, tint: '#ffffff', tile: 4 },
  walnut: { texture: woodFloorTexture, tint: '#bb9d80', tile: 4 },
  'carpet-blue': { texture: carpetTexture, tint: '#cdd6e2', tile: 2 },
  'carpet-sage': { texture: carpetTexture, tint: '#d0dbc8', tile: 2 },
  'carpet-grey': { texture: carpetTexture, tint: '#d9dadd', tile: 2 },
  concrete: { texture: concreteTexture, tint: '#ffffff', tile: 6 },
  terrazzo: { texture: terrazzoTexture, tint: '#ffffff', tile: 3 }
};

function floorPlane(
  kind: FloorKind | 'corridor',
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  lift: number
): THREE.Mesh {
  const finish = FLOORS[kind];
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const texture = finish.texture().clone();
  texture.repeat.set(width / finish.tile, depth / finish.tile);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: finish.tint,
    roughness: kind.startsWith('carpet') ? 0.95 : 0.72,
    polygonOffset: true,
    polygonOffsetFactor: -lift,
    polygonOffsetUnits: -lift
  });
  const surface = part(
    GEOMETRY.plane,
    material,
    [width, depth, 1],
    [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
    [-Math.PI / 2, 0, 0]
  );
  surface.castShadow = false;
  return surface;
}

/** How far the plinth reaches beyond the campus walls, and its colours. */
const PLINTH_MARGIN = 0.35;
/** Deep enough to read as a base from the whole-campus view. */
export const PLINTH_DEPTH = 0.9;
const PLINTH = { side: '#c9bfb2', lip: '#efe8dd' } as const;

/** Pale stone corridors, and each district on its own floor with a thin inlay in its colour. */
function floor(): THREE.Group {
  const g = new THREE.Group();
  const width = ROOM.maxX - ROOM.minX;
  const depth = ROOM.maxZ - ROOM.minZ;
  g.add(floorPlane('corridor', ROOM.minX, ROOM.maxX, ROOM.minZ, ROOM.maxZ, 0));
  for (const district of DISTRICTS) {
    const { minX, maxX, minZ, maxZ } = district.bounds;
    const pad = 0.6;
    g.add(floorPlane(district.floor, minX - pad, maxX + pad, minZ - pad, maxZ + pad, 1));
    const inlay = mat(district.color, { roughness: 0.5 });
    const y = 0.004;
    const t = 0.07;
    for (const [x, z, w, d] of [
      [(minX + maxX) / 2, minZ - pad, maxX - minX + pad * 2, t],
      [(minX + maxX) / 2, maxZ + pad, maxX - minX + pad * 2, t],
      [minX - pad, (minZ + maxZ) / 2, t, maxZ - minZ + pad * 2],
      [maxX + pad, (minZ + maxZ) / 2, t, maxZ - minZ + pad * 2]
    ]) {
      const line = part(GEOMETRY.box, inlay, [w, 0.004, d], [x, y, z]);
      line.castShadow = false;
      g.add(line);
    }
  }
  // The diorama's plinth: a deep base with a light lip, its top just under the floor (coplanar
  // faces would z-fight into grey streaks).
  const centre = (ROOM.minX + ROOM.maxX) / 2;
  const rim = PLINTH_MARGIN * 2;
  const plinth = box(
    PLINTH.side,
    [width + rim, PLINTH_DEPTH, depth + rim],
    [centre, -0.004 - PLINTH_DEPTH / 2, 0],
    {
      roughness: 0.9
    }
  );
  const lip = box(PLINTH.lip, [width + rim + 0.02, 0.06, depth + rim + 0.02], [centre, -0.034, 0]);
  plinth.castShadow = lip.castShadow = false;
  g.add(plinth, lip);
  return g;
}

export function buildOffice(): OfficeRoom {
  const root = new THREE.Group();
  root.add(floor(), wallDecor());
  for (const w of WALLS) root.add(wallMesh(w));

  const lights: { spots: readonly string[]; mesh: THREE.Mesh; steam?: THREE.Object3D }[] = [];
  let kitchen: KitchenFx | null = null;
  for (const item of FURNITURE) {
    const built = buildFurniture(item);
    built.object.position.set(item.x, 0, item.z);
    built.object.rotation.y = item.rotation;
    root.add(built.object);
    if (built.light) lights.push({ spots: item.busyWith ?? [], mesh: built.light, steam: built.steam });
    for (const machine of built.machines ?? [])
      lights.push({ spots: machine.spots, mesh: machine.light, steam: machine.steam });
    if (built.kitchen) kitchen = built.kitchen;
  }

  for (const patch of contactShadows(FURNITURE)) root.add(patch);

  const stations: { deskId: string; displays: THREE.Mesh[] }[] = [];
  for (const setup of DESK_SETUPS) {
    const seat = poiById(setup.poiId);
    const station = workstation(setup, surfaceOf(setup.poiId, seat.district));
    station.object.position.set(seat.position.x, 0, seat.position.z);
    station.object.rotation.y = seat.facing;
    root.add(station.object);
    stations.push({ deskId: setup.poiId, displays: station.displays });
  }

  // Every screen becomes one instance in a shared mesh; the placeholders go away.
  root.updateMatrixWorld(true);
  const slots: ScreenSlot[] = [];
  for (const { deskId, displays } of stations)
    for (const display of displays) {
      slots.push({
        deskId,
        flavor: display.userData.screen as ScreenFlavor,
        matrix: display.matrixWorld.clone()
      });
      display.removeFromParent();
    }
  const screens = new DeskScreens(slots);

  batchStatic(root);
  root.add(screens.object);

  const seatKinds = new Map(FURNITURE.map((item) => [item.id, item.kind]));

  return {
    root,
    kitchen,
    setAmbientOcclusion(on) {
      const { round, square } = contactMaterials();
      round.opacity = square.opacity = on ? CONTACT_OPACITY.withAO : CONTACT_OPACITY.withoutAO;
    },
    seatHeight(poiId) {
      if (poiId.startsWith('lounge-sofa')) return SOFA_SEAT_HEIGHT;
      const kind = seatKinds.get(`${poiId}-seat`);
      return (kind && SEAT_HEIGHT[kind]) ?? 0.48;
    },
    update(dt, elapsed, screenState, busy) {
      screens.update(dt, elapsed, screenState);
      for (const { spots, mesh, steam } of lights) {
        const inUse = spots.some(busy);
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = inUse
          ? 0.9 + Math.sin(elapsed * (spots[0] === 'printer' ? 9 : 4)) * 0.6
          : 0.35;
        if (steam) animateSteam(steam, inUse, elapsed);
      }
    },
    dispose() {
      screens.dispose();
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
