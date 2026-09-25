import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { deinterleaveGeometry } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from './materials';

/**
 * Downloaded 3D models for the office's furniture (Quaternius, CC0; the originals and their licence
 * are in source_assets/, and `npm run models:optimize` writes the copies the app loads). They load
 * once, before the office is built. A furniture builder asks for a model fitted to its piece and
 * painted in the office's colours, and keeps its own code-built version when the model is missing.
 * Painted with the office's shared materials, a model's parts merge into the room's batches like any
 * other part: it costs triangles, not draw calls.
 */

export const MODEL_IDS = [
  'desk',
  'office-chair',
  'couch-medium-teal',
  'couch-l-grey',
  'armchair-teal',
  'armchair-grey',
  'table-round-small',
  'bar-stool',
  'desk-lamp',
  'bookcase-books',
  'plant-snake',
  'plant-monstera',
  'plant-monstera-small',
  'plant-banana',
  'plant-broadleaf',
  'plant-cactus-pot',
  'cactus'
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

/**
 * Seat height in each seating model's own units, measured from its geometry (the largest upward
 * face between a fifth and two thirds of its height). Every model's front faces +z, as the office's
 * furniture does.
 */
const SEAT: Partial<Record<ModelId, number>> = {
  'office-chair': 0.51,
  'couch-medium-teal': 0.86,
  'couch-l-grey': 0.86,
  'armchair-teal': 0.86,
  'armchair-grey': 0.51,
  'bar-stool': 0.69
};

const sources = new Map<ModelId, { scene: THREE.Object3D; box: THREE.Box3 }>();
let loading: Promise<void> | undefined;

/** Loads every model once. Resolves when all have loaded or failed; failed ones stay code-built. */
export function loadOfficeModels(): Promise<void> {
  loading ??= Promise.all(
    MODEL_IDS.map(async (id) => {
      try {
        const url = new URL(`models/office/${id}.glb`, document.baseURI).href;
        const { scene } = await new GLTFLoader().loadAsync(url);
        // The loader shares one buffer between positions and normals; the room's batching wants
        // each attribute on its own.
        scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (mesh.isMesh) deinterleaveGeometry(mesh.geometry);
        });
        scene.updateMatrixWorld(true);
        sources.set(id, { scene, box: new THREE.Box3().setFromObject(scene) });
      } catch (error) {
        console.warn(`Office model "${id}" did not load; its furniture stays code-built.`, error);
      }
    })
  ).then(() => undefined);
  return loading;
}

export const officeModelsLoaded = () => sources.size > 0;

/** A colour from the office's palette, with its finish (the office's usual matte by default). */
export type Paint = string | { color: string; roughness?: number; metalness?: number };

export interface Fit {
  /** The piece's footprint: along x (width) and z (depth), before it is turned. */
  w: number;
  d: number;
  /** Height of its top. */
  h?: number;
  /** Seat height, for seating: people sit at this height, so the cushion must be there. */
  seat?: number;
  /**
   * `inside`: keep the model's proportions and fit it within the footprint and height (plants,
   * lamps). `seat`: keep proportions, sized by the seat height alone (chairs, stools). `stretch`
   * (the default): width and depth to the footprint, height to `h` or `seat`, never squeezed to
   * less than three quarters of the height's scale, so nothing looks crushed.
   */
  mode?: 'inside' | 'seat' | 'stretch';
  /** Least width or depth scale in `stretch`, as a share of the height's scale (default 0.75). */
  squeeze?: number;
  /** Model material name → the office colour it is painted. Anything else keeps its own colour. */
  paint?: Record<string, Paint>;
  /** Whether it throws shadows, or which of its materials do (the rest are too small to show). */
  shadows?: boolean | readonly string[];
}

/** By default, width and depth are never scaled below this share of the height's scale. */
const MIN_SQUEEZE = 0.75;

/** A copy of the model, fitted to `fit` with its base centred at the origin, or null if not loaded. */
export function officeModel(id: ModelId, fit: Fit): THREE.Group | null {
  const source = sources.get(id);
  if (!source) return null;
  const size = source.box.getSize(new THREE.Vector3());
  const seat = SEAT[id];
  const heightScale =
    fit.seat !== undefined && seat ? fit.seat / seat : fit.h !== undefined ? fit.h / size.y : undefined;
  let sx = fit.w / size.x;
  let sz = fit.d / size.z;
  let sy = heightScale ?? Math.min(sx, sz);
  const mode = fit.mode ?? 'stretch';
  if (mode === 'inside') sx = sy = sz = Math.min(sx, sz, heightScale ?? Infinity);
  else if (mode === 'seat') sx = sz = sy;
  else {
    const squeeze = fit.squeeze ?? MIN_SQUEEZE;
    sx = Math.max(sx, sy * squeeze);
    sz = Math.max(sz, sy * squeeze);
  }

  const copy = source.scene.clone(true);
  copy.scale.set(sx, sy, sz);
  const centre = source.box.getCenter(new THREE.Vector3());
  copy.position.set(-centre.x * sx, -source.box.min.y * sy, -centre.z * sz);
  copy.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.MeshStandardMaterial;
    const paint = fit.paint?.[original.name];
    const spec = typeof paint === 'string' ? { color: paint } : paint;
    // Every part is repainted with a shared office material (its own colour if not named), so it
    // merges with the rest of the room and has the office's matte finish.
    mesh.material = mat(spec?.color ?? `#${original.color.getHexString()}`, {
      roughness: spec?.roughness,
      metalness: spec?.metalness ?? 0
    });
    const shadows = fit.shadows ?? true;
    mesh.castShadow = typeof shadows === 'boolean' ? shadows : shadows.includes(original.name);
    mesh.receiveShadow = true;
  });
  const wrapper = new THREE.Group();
  wrapper.add(copy);
  return wrapper;
}
