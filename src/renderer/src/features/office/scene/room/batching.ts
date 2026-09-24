import * as THREE from 'three';
import { mat } from './materials';

/**
 * Collapses the static room into as few draw calls as possible. Plain-coloured surfaces (no texture,
 * no glow, not see-through) carry their colour in the geometry and merge into one mesh per surface
 * finish (roughness, metalness, flat shading, depth pull), so a new colour costs triangles, never a
 * draw call. Everything else merges per material, as before.
 */

/**
 * The finish a plain-coloured material shares with others, or null when it has to stay its own
 * material (textures, glow, transparency, anything but a standard material).
 */
export function surfaceKey(material: THREE.Material): string | null {
  if (material.type !== 'MeshStandardMaterial') return null;
  const m = material as THREE.MeshStandardMaterial;
  if (m.map || m.emissiveMap || m.alphaMap || m.normalMap || m.transparent || m.opacity < 1) return null;
  if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) return null;
  if (m.side !== THREE.FrontSide || !m.depthWrite || !m.visible) return null;
  const pull = m.polygonOffset ? -m.polygonOffsetFactor : 0;
  return `${m.roughness.toFixed(2)}|${m.metalness.toFixed(2)}|${m.flatShading ? 1 : 0}|${pull}`;
}

/** The shared vertex-coloured material for a finish. */
function surfaceMaterial(key: string): THREE.MeshStandardMaterial {
  const [roughness, metalness, flat, pull] = key.split('|').map(Number);
  return mat('#ffffff', {
    vertexColors: true,
    roughness,
    metalness,
    flat: flat === 1,
    depthPull: pull || undefined
  });
}

/** `geometry` in world space, with a colour per vertex: its own colours tinted by `tint`, or `tint`. */
function painted(
  geometry: THREE.BufferGeometry,
  tint: THREE.Color,
  ownColors: boolean
): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const own = ownColors ? geometry.getAttribute('color') : undefined;
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tint.r * (own ? own.getX(i) : 1);
    colors[i * 3 + 1] = tint.g * (own ? own.getY(i) : 1);
    colors[i * 3 + 2] = tint.b * (own ? own.getZ(i) : 1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Joins geometries that share `names` attributes into one indexed geometry. */
function concat(parts: THREE.BufferGeometry[], names: readonly string[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const g of parts) {
    const count = g.getAttribute('position').count;
    vertices += count;
    indices += g.index ? g.index.count : count;
  }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0].getAttribute(name).itemSize;
    const array = new Float32Array(vertices * size);
    let offset = 0;
    for (const g of parts) {
      const attribute = g.getAttribute(name) as THREE.BufferAttribute;
      if (attribute.array instanceof Float32Array && attribute.itemSize === size && !attribute.normalized)
        array.set(attribute.array.subarray(0, attribute.count * size), offset);
      else
        for (let i = 0; i < attribute.count; i++)
          for (let c = 0; c < size; c++) array[offset + i * size + c] = attribute.getComponent(i, c);
      offset += attribute.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let at = 0;
  let base = 0;
  for (const g of parts) {
    const count = g.getAttribute('position').count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[at++] = g.index.getX(i) + base;
    else for (let i = 0; i < count; i++) index[at++] = i + base;
    base += count;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

interface Bucket {
  material: THREE.Material;
  names: string[];
  geometries: THREE.BufferGeometry[];
  cast: boolean;
  receive: boolean;
  order: number;
}

/** Prunes empty plain groups below `object`; true when nothing is left in it either. */
function isEmpty(object: THREE.Object3D): boolean {
  for (const child of [...object.children]) if (isEmpty(child)) child.removeFromParent();
  return object.children.length === 0 && (object.type === 'Group' || object.type === 'Object3D');
}

/** Collapses every static mesh under `root` into one mesh per finish (or per material). */
export function batchStatic(root: THREE.Group): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, Bucket>();
  const merged: THREE.Mesh[] = [];
  const tint = new THREE.Color();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.dynamic || Array.isArray(object.material)) return;
    if (object instanceof THREE.InstancedMesh) return;
    const material = object.material as THREE.Material;
    const surface = surfaceKey(material);
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    let names: string[];
    let bucketMaterial: THREE.Material;
    let key: string;
    if (surface) {
      const standard = material as THREE.MeshStandardMaterial;
      painted(geometry, tint.copy(standard.color), standard.vertexColors && !!geometry.getAttribute('color'));
      names = ['position', 'normal', 'color'];
      bucketMaterial = surfaceMaterial(surface);
      key = `surface:${surface}`;
    } else {
      const wanted = (material as THREE.MeshStandardMaterial).vertexColors
        ? ['position', 'normal', 'uv', 'color']
        : ['position', 'normal', 'uv'];
      names = wanted.filter((name) => geometry.getAttribute(name));
      bucketMaterial = material;
      key = `material:${material.uuid}|${names.join(',')}`;
    }
    for (const name of Object.keys(geometry.attributes))
      if (!names.includes(name)) geometry.deleteAttribute(name);
    key += `|${object.castShadow}|${object.receiveShadow}|${object.renderOrder}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: bucketMaterial,
        names,
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
  // Every group left empty goes too: the renderer walks and updates each object every frame, and a
  // furnished campus leaves thousands of them.
  for (const child of [...root.children]) if (isEmpty(child)) child.removeFromParent();
  for (const bucket of buckets.values()) {
    const geometry = concat(bucket.geometries, bucket.names);
    bucket.geometries.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, bucket.material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.renderOrder = bucket.order;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}

/**
 * One vertex-coloured mesh from everything under `object`, in its own frame: for things that move
 * or hide as a whole (a pan, a dog) and should cost a single draw call. `finish` is its surface.
 */
export function bake(
  object: THREE.Object3D,
  finish: { roughness?: number; metalness?: number } = {}
): THREE.Mesh {
  object.updateMatrixWorld(true);
  const toLocal = object.matrixWorld.clone().invert();
  const tint = new THREE.Color();
  const parts: THREE.BufferGeometry[] = [];
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    const geometry = child.geometry.clone().applyMatrix4(toLocal.clone().multiply(child.matrixWorld));
    painted(
      geometry,
      tint.copy(material.color ?? tint.set('#ffffff')),
      !!material.vertexColors && !!geometry.getAttribute('color')
    );
    for (const name of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
    parts.push(geometry);
  });
  const mesh = new THREE.Mesh(
    concat(parts, ['position', 'normal', 'color']),
    mat('#ffffff', {
      vertexColors: true,
      roughness: finish.roughness ?? 0.7,
      metalness: finish.metalness ?? 0
    })
  );
  parts.forEach((g) => g.dispose());
  mesh.geometry.computeBoundingSphere();
  mesh.userData.dynamic = true;
  mesh.userData.ownsGeometry = true;
  return mesh;
}
