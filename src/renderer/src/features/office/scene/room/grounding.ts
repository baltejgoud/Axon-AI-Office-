import * as THREE from 'three';
import type { FurnitureItem } from '../../simulation/layout';

/**
 * Contact shadows: a soft dark patch under everything that stands on the floor, so furniture looks
 * set down rather than floating. They carry the grounding on Balanced quality and add to the
 * ambient occlusion on High. Two shared materials (round and square), merged with the static room.
 */

/** Things that hang, lie flat or are too slender for a patch under them. */
const NO_SHADOW = new Set<FurnitureItem['kind']>([
  'rug',
  'exec-rug',
  'wall-screen',
  'pendant-lamp',
  'wall-art',
  'ledge-art',
  'sign-post'
]);
/** Seats read better with a round patch, whatever their footprint. */
const ROUND = new Set<FurnitureItem['kind']>(['office-chair', 'exec-chair', 'stool', 'cafe-chair']);
/** How far a patch reaches beyond the footprint, in metres (split over both sides). */
const SPREAD = 0.3;
/** Just above the rugs, so a sofa on a rug is still grounded. */
const LIFT = 0.025;

/** The patch under an item: its size and shape, or null if it gets none. */
export function groundShadow(item: FurnitureItem): { w: number; d: number; round: boolean } | null {
  if (NO_SHADOW.has(item.kind)) return null;
  const round = item.round || ROUND.has(item.kind);
  const grow = (v: number) => Math.round((v + SPREAD) * 1000) / 1000;
  return { w: grow(item.w), d: grow(item.d), round };
}

/** Strength of the patches with and without ambient occlusion. */
export const CONTACT_OPACITY = { withAO: 0.32, withoutAO: 0.58 } as const;

function patchTexture(round: boolean): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  if (round) {
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.55)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  } else {
    g.filter = 'blur(10px)';
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.beginPath();
    g.roundRect(24, 24, size - 48, size - 48, 14);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let materials: { round: THREE.MeshBasicMaterial; square: THREE.MeshBasicMaterial } | null = null;

/** The two shared patch materials; the scene turns their opacity down when AO is on. */
export function contactMaterials(): { round: THREE.MeshBasicMaterial; square: THREE.MeshBasicMaterial } {
  if (materials) return materials;
  const make = (round: boolean) =>
    new THREE.MeshBasicMaterial({
      map: patchTexture(round),
      color: '#3b2f25',
      transparent: true,
      opacity: CONTACT_OPACITY.withAO,
      depthWrite: false,
      // Floors are pulled toward the camera by 1 in the depth test and rugs by 2–3; patches lie on both.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
  materials = { round: make(true), square: make(false) };
  return materials;
}

const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** One patch per standing item, placed and turned with it. */
export function contactShadows(items: readonly FurnitureItem[]): THREE.Mesh[] {
  const { round, square } = contactMaterials();
  const meshes: THREE.Mesh[] = [];
  for (const item of items) {
    const patch = groundShadow(item);
    if (!patch) continue;
    const mesh = new THREE.Mesh(plane, patch.round ? round : square);
    mesh.scale.set(patch.w, 1, patch.d);
    mesh.position.set(item.x, LIFT, item.z);
    mesh.rotation.y = item.rotation;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    meshes.push(mesh);
  }
  return meshes;
}
