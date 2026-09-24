import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GEOMETRY, mat, part } from '../room/materials';
import type { Appearance } from './appearance';
import { STANDING_HIP_HEIGHT, type LimbPose, type Pose } from './poses';

/**
 * Toy-like proportions: a large head and sturdy torso on shorter legs, so people stay readable
 * from the elevated camera while standing the same height against desks and chairs.
 */
const BASE_HEIGHT = 1.68;
const THIGH = 0.34;
const SHIN = 0.34;
const UPPER_ARM = 0.24;
const FOREARM = 0.23;
const HEAD = { w: 0.3, h: 0.33, d: 0.31, y: 0.16 };
/** Heads a touch larger than life: friendlier, and faces read from further away. */
const HEAD_SCALE = 1.1;
/** Soles: a pale rubber under casual shoes, dark leather under formal ones. */
export const SOLE = { light: '#ece6dc', dark: '#4a3a30' } as const;

/** Close-up detail for the full characters; a lighter set for the instanced crowd seen from afar. */
const SHAPES = {
  full: {
    // Mid-poly: smooth at the closest zoom, and a third of the triangles of fully round shapes. The
    // campus draws a couple of dozen people like this, twice over with their shadows.
    box: GEOMETRY.box,
    sphere: new THREE.SphereGeometry(0.5, 14, 10),
    small: new THREE.SphereGeometry(0.5, 8, 6),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 3, 10),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    lowSphere: GEOMETRY.lowSphere,
    // Hair is faceted: chunky solids, flat-shaded.
    hairCap: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hairBlob: new THREE.IcosahedronGeometry(0.5, 1),
    lens: new THREE.TorusGeometry(0.04, 0.006, 4, 12),
    band: new THREE.TorusGeometry(0.178, 0.014, 4, 14, Math.PI)
  },
  low: {
    box: GEOMETRY.box,
    sphere: new THREE.SphereGeometry(0.5, 10, 7),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 3, 8),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    small: new THREE.SphereGeometry(0.5, 6, 4),
    lowSphere: new THREE.IcosahedronGeometry(0.5, 0),
    hairCap: new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.55),
    hairBlob: new THREE.IcosahedronGeometry(0.5, 1),
    lens: new THREE.TorusGeometry(0.04, 0.006, 3, 10),
    band: new THREE.TorusGeometry(0.178, 0.014, 3, 10, Math.PI)
  }
};
type Shapes = (typeof SHAPES)['full'];

export interface Limb {
  root: THREE.Group;
  joint: THREE.Group;
  end: THREE.Group;
}

export interface HumanoidRig {
  /** Sits on the floor; carries position and heading. */
  root: THREE.Group;
  scale: number;
  hips: THREE.Group;
  spine: THREE.Group;
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  /** Body meshes that get a selection outline (no eyes or glasses). */
  outlinable: THREE.Mesh[];
  /** Eyes and eye highlights, hidden for a moment to blink. */
  eyes: THREE.Mesh[];
}

const LAYERED_TOPS: ReadonlySet<Appearance['top']> = new Set(['blazer', 'cardigan', 'suit']);

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function buildHumanoid(look: Appearance, detail: 'full' | 'low' = 'full'): HumanoidRig {
  const G = SHAPES[detail];
  const root = new THREE.Group();
  const body = new THREE.Group();
  const scale = look.height / BASE_HEIGHT;
  body.scale.setScalar(scale);
  root.add(body);

  const outlinable: THREE.Mesh[] = [];
  const fabric = (color: string) => mat(color, { roughness: 0.88 });
  const add = (parent: THREE.Object3D, mesh: THREE.Mesh, outline = true) => {
    parent.add(mesh);
    if (outline) outlinable.push(mesh);
    return mesh;
  };
  const skin = mat(look.skin, { roughness: 0.7 });
  const shirt = fabric(look.shirt);
  const outer = fabric(look.jacket ?? look.shirt);
  const trousers = fabric(look.trousers);
  const hair = mat(look.hair, { roughness: 0.95, flat: true });
  const eyeMaterial = mat('#23262b', { roughness: 0.3 });
  const highlight = mat('#ffffff');
  const accent = mat(look.accent, { roughness: 0.5 });
  const formal = LAYERED_TOPS.has(look.top);
  const sole = mat(formal ? SOLE.dark : SOLE.light, { roughness: 0.8 });
  const width = look.build;
  // Sleeves: short on a tee, shirt sleeves under a vest, otherwise the outer layer.
  const upperSleeve = look.top === 'vest' || look.top === 'tee' ? shirt : outer;
  const lowerSleeve = look.top === 'tee' ? skin : look.top === 'vest' ? shirt : outer;

  // Hips and legs
  const hips = joint(body, 0, STANDING_HIP_HEIGHT, 0);
  add(hips, part(G.sphere, trousers, [0.36 * width, 0.2, 0.25], [0, -0.02, 0]));
  const leg = (side: 1 | -1): Limb => {
    const hip = joint(hips, 0.1 * side * width, -0.03, 0);
    add(hip, part(G.capsule, trousers, [0.16, THIGH / 2, 0.16], [0, -THIGH / 2, 0]));
    const knee = joint(hip, 0, -THIGH, 0);
    add(knee, part(G.capsule, trousers, [0.13, SHIN / 2, 0.13], [0, -SHIN / 2, 0]));
    const foot = joint(knee, 0, -SHIN, 0);
    add(foot, part(G.sphere, mat(look.shoes, { roughness: 0.6 }), [0.11, 0.07, 0.24], [0, -0.014, 0.05]));
    add(foot, part(G.box, sole, [0.118, 0.02, 0.25], [0, -0.046, 0.05]));
    return { root: hip, joint: knee, end: foot };
  };
  const legL = leg(1);
  const legR = leg(-1);

  // Torso
  const spine = joint(hips, 0, 0.05, 0);
  if (look.jacket) {
    add(spine, part(G.capsule, outer, [0.43 * width, 0.235, 0.27], [0, 0.24, 0]));
    // Open front shows the shirt underneath.
    add(spine, part(G.box, shirt, [0.11 * width, 0.28, 0.02], [0, 0.28, 0.13]));
  } else {
    add(spine, part(G.capsule, shirt, [0.41 * width, 0.23, 0.255], [0, 0.24, 0]));
  }
  add(spine, part(G.box, accent, [0.06, 0.04, 0.012], [0.1 * width, 0.33, 0.138]), false);
  if (look.top === 'suit') add(spine, part(G.box, accent, [0.036, 0.22, 0.012], [0, 0.27, 0.142]), false);
  if (look.top === 'hoodie') {
    // The hood rests behind the neck.
    add(spine, part(G.sphere, shirt, [0.3 * width, 0.15, 0.15], [0, 0.44, -0.1]));
    for (const side of [-1, 1])
      spine.add(part(G.box, mat('#f3f1ec'), [0.01, 0.1, 0.008], [side * 0.035, 0.36, 0.13]));
  }
  if (look.top === 'tee' || look.top === 'hoodie')
    // A ribbed neckband.
    add(spine, part(G.cylinder, shirt, [0.15, 0.03, 0.13], [0, 0.455, 0.005]), false);
  else
    // Collar points either side of the neck.
    for (const side of [-1, 1])
      spine.add(part(G.box, shirt, [0.08, 0.035, 0.05], [side * 0.05, 0.46, 0.08], [0.4, 0, side * 0.35]));

  // Neck and head
  const neck = joint(spine, 0, 0.47, 0);
  add(neck, part(G.cylinder, skin, [0.11, 0.07, 0.11], [0, 0.02, 0]));
  const head = joint(neck, 0, 0.05, 0);
  head.scale.setScalar(HEAD_SCALE);
  add(head, part(G.sphere, skin, [HEAD.w, HEAD.h, HEAD.d], [0, HEAD.y, 0]));
  const faceZ = HEAD.d / 2 - 0.012;
  for (const side of [1, -1]) {
    add(head, part(G.small, skin, [0.05, 0.08, 0.05], [0.148 * side, HEAD.y, 0]));
    head.add(part(G.small, eyeMaterial, [0.034, 0.042, 0.026], [0.058 * side, HEAD.y + 0.025, faceZ]));
    if (look.glasses)
      head.add(
        part(
          G.lens,
          mat('#2b2f36', { roughness: 0.4 }),
          [1, 1, 1],
          [0.058 * side, HEAD.y + 0.025, faceZ + 0.012]
        )
      );
  }
  if (look.glasses)
    head.add(part(G.box, mat('#2b2f36'), [0.04, 0.008, 0.008], [0, HEAD.y + 0.03, faceZ + 0.014]));
  add(head, part(G.small, skin, [0.045, 0.055, 0.05], [0, HEAD.y - 0.015, faceZ + 0.008]), false);
  // Small face details remain warm and legible in close-up.
  for (const side of [-1, 1]) {
    head.add(part(G.small, highlight, [0.009, 0.011, 0.006], [0.055 * side, HEAD.y + 0.033, faceZ + 0.014]));
    head.add(
      part(
        G.box,
        hair,
        [0.05, 0.013, 0.012],
        [0.058 * side, HEAD.y + 0.07, faceZ - 0.008],
        [0, 0, side * -0.14]
      )
    );
  }
  head.add(part(G.small, mat('#a36d5b'), [0.055, 0.012, 0.01], [0, HEAD.y - 0.065, faceZ - 0.002]));
  if (look.jacket)
    for (const side of [-1, 1])
      spine.add(part(G.box, shirt, [0.065, 0.13, 0.014], [side * 0.058, 0.38, 0.137], [0, 0, side * 0.3]));
  buildHair(head, look, hair, add, G);
  if (look.beard)
    add(
      head,
      part(
        G.hairBlob,
        mat(look.beard, { roughness: 0.95, flat: true }),
        [0.27, 0.15, 0.21],
        [0, HEAD.y - 0.09, 0.04]
      )
    );
  if (look.headphones) {
    const phones = mat('#1f2430', { roughness: 0.4 });
    add(head, part(G.band, phones, [1, 1, 1], [0, HEAD.y + 0.02, -0.01]));
    for (const side of [-1, 1])
      add(
        head,
        part(G.cylinder, phones, [0.085, 0.05, 0.085], [0.165 * side, HEAD.y, 0], [0, 0, Math.PI / 2])
      );
  }

  if (look.uniform) dressForWork(look, width, hips, spine, head, add, G);

  // Arms
  const arm = (side: 1 | -1): Limb => {
    const shoulder = joint(spine, 0.235 * side * width, 0.41, 0);
    add(shoulder, part(G.capsule, upperSleeve, [0.115, UPPER_ARM / 2, 0.115], [0, -UPPER_ARM / 2, 0]));
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    add(elbow, part(G.capsule, lowerSleeve, [0.1, FOREARM / 2 - 0.01, 0.1], [0, -FOREARM / 2 + 0.01, 0]));
    if (look.top !== 'tee') {
      // Cuffs: the shirt shows at the wrist under a layer; otherwise a band in the sleeve's own colour.
      const cuff = part(
        G.cylinder,
        LAYERED_TOPS.has(look.top) ? shirt : lowerSleeve,
        [0.104, 0.035, 0.104],
        [0, -FOREARM + 0.03, 0]
      );
      cuff.castShadow = false;
      elbow.add(cuff);
    }
    const hand = joint(elbow, 0, -FOREARM, 0);
    add(hand, part(G.sphere, skin, [0.095, 0.11, 0.08], [0, 0, 0]));
    return { root: shoulder, joint: elbow, end: hand };
  };
  const armL = arm(1);
  const armR = arm(-1);

  // Only the body's main shapes cast shadows; eyes, brows and buttons would only add draw calls.
  const outlined = new Set(outlinable);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = outlined.has(object);
      object.receiveShadow = false;
    }
  });
  // Close up every joint is one vertex-coloured mesh; the crowd's templates keep a mesh per material,
  // which is how their baking tells skin from shirt.
  const outlines =
    detail === 'full'
      ? paintJoints(root, outlined, new Set([eyeMaterial, highlight]))
      : consolidate(root, outlined);
  const eyes = head.children.filter(
    (child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && (child.material === eyeMaterial || child.material === highlight)
  );
  return { root, scale, hips, spine, head, armL, armR, legL, legR, outlinable: outlines, eyes };
}

/**
 * Café work clothes: chefs get a double row of buttons, an apron from the waist and a tall toque;
 * the barista a bib apron and a cap. Worn over the look's shirt and trousers.
 */
function dressForWork(
  look: Appearance,
  width: number,
  hips: THREE.Group,
  spine: THREE.Group,
  head: THREE.Group,
  add: (parent: THREE.Object3D, mesh: THREE.Mesh, outline?: boolean) => THREE.Mesh,
  G: Shapes
): void {
  if (look.uniform === 'chef') {
    const white = mat('#f7f6f2', { roughness: 0.85 });
    const buttons = mat('#2b2f36', { roughness: 0.5 });
    for (const side of [-1, 1])
      for (const y of [0.18, 0.26, 0.34])
        spine.add(part(G.small, buttons, [0.022, 0.022, 0.012], [side * 0.055, y, 0.136]));
    add(hips, part(G.box, white, [0.38 * width, 0.42, 0.025], [0, -0.17, 0.14]));
    add(head, part(G.cylinder, white, [0.27, 0.17, 0.27], [0, HEAD.y + 0.2, -0.015]));
    add(head, part(G.hairBlob, white, [0.36, 0.2, 0.36], [0, HEAD.y + 0.32, -0.015]));
    return;
  }
  const apron = mat('#8a5a3c', { roughness: 0.9 });
  const cap = mat('#2f6f68', { roughness: 0.8 });
  add(spine, part(G.box, apron, [0.3 * width, 0.3, 0.02], [0, 0.22, 0.136]));
  add(hips, part(G.box, apron, [0.38 * width, 0.36, 0.022], [0, -0.14, 0.14]));
  add(
    head,
    part(
      G.hairCap,
      cap,
      [HEAD.w * 1.12, HEAD.h * 1.05, HEAD.d * 1.12],
      [0, HEAD.y + 0.01, -0.008],
      [-0.2, 0, 0]
    )
  );
  add(head, part(G.box, cap, [0.2, 0.015, 0.13], [0, HEAD.y + 0.1, 0.17], [0.15, 0, 0]));
}

function buildHair(
  head: THREE.Group,
  look: Appearance,
  hair: THREE.Material,
  add: (parent: THREE.Object3D, mesh: THREE.Mesh, outline?: boolean) => THREE.Mesh,
  G: Shapes
): void {
  const y = HEAD.y;
  const cap = (grow: number) =>
    add(
      head,
      part(
        G.hairCap,
        hair,
        [HEAD.w * grow, HEAD.h * grow, HEAD.d * grow],
        [0, y + 0.005, -0.008],
        [-0.3, 0, 0]
      )
    );
  switch (look.hairStyle) {
    case 'short':
      cap(1.08);
      add(head, part(G.hairBlob, hair, [0.28, 0.2, 0.15], [0, y - 0.03, -0.095]));
      return;
    case 'bob':
      cap(1.1);
      add(head, part(G.hairBlob, hair, [0.35, 0.31, 0.3], [0, y - 0.07, -0.05]));
      return;
    case 'bun':
      cap(1.08);
      add(head, part(G.hairBlob, hair, [0.15, 0.14, 0.15], [0, y + 0.17, -0.12]));
      return;
    case 'ponytail':
      cap(1.09);
      add(head, part(G.hairBlob, hair, [0.09, 0.09, 0.09], [0, y + 0.06, -0.165]));
      add(head, part(G.capsule, hair, [0.09, 0.12, 0.085], [0, y - 0.1, -0.2], [0.3, 0, 0]));
      return;
    case 'curly':
      cap(1.2);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        add(
          head,
          part(
            G.lowSphere,
            hair,
            [0.13, 0.13, 0.13],
            [Math.sin(angle) * 0.15, y + 0.09 + (i % 2) * 0.05, Math.cos(angle) * 0.13 - 0.04]
          )
        );
      }
      add(head, part(G.hairBlob, hair, [0.34, 0.28, 0.25], [0, y - 0.04, -0.09]));
      return;
    case 'wavy':
      cap(1.09);
      add(head, part(G.hairBlob, hair, [0.18, 0.09, 0.13], [0.05, y + 0.15, 0.085], [0, 0, -0.3]));
      add(head, part(G.hairBlob, hair, [0.28, 0.2, 0.15], [0, y - 0.03, -0.095]));
      return;
    case 'crop':
      cap(1.04);
      return;
    case 'buzz':
      cap(1.02);
      return;
    case 'side-part':
      cap(1.08);
      add(head, part(G.hairBlob, hair, [0.2, 0.08, 0.16], [-0.06, y + 0.15, 0.07], [0, 0, 0.35]));
      add(head, part(G.hairBlob, hair, [0.28, 0.2, 0.15], [0, y - 0.03, -0.095]));
      return;
    case 'long':
      cap(1.1);
      add(head, part(G.hairBlob, hair, [0.36, 0.5, 0.2], [0, y - 0.18, -0.08]));
      return;
    case 'afro':
      cap(1.42);
      for (const side of [-1, 1])
        add(head, part(G.hairBlob, hair, [0.2, 0.26, 0.26], [0.15 * side, y + 0.02, -0.05]));
      return;
    case 'braids':
      cap(1.07);
      for (const side of [-1, 1])
        add(head, part(G.capsule, hair, [0.055, 0.16, 0.055], [0.085 * side, y - 0.2, -0.13], [0.2, 0, 0]));
      return;
    case 'bald':
      return;
  }
}

function applyLimb(limbRig: Limb, value: LimbPose, side: 1 | -1, isLeg: boolean): void {
  limbRig.root.rotation.set(-value.fwd, 0, side * value.out);
  limbRig.joint.rotation.x = isLeg ? value.bend : -value.bend;
}

export function applyPose(rig: HumanoidRig, pose: Pose): void {
  rig.hips.position.y = pose.hipsY;
  rig.hips.position.z = pose.hipsZ;
  rig.spine.rotation.set(pose.lean, pose.twist, pose.tilt);
  rig.head.rotation.set(pose.headPitch, pose.headYaw, pose.headRoll);
  applyLimb(rig.armL, pose.armL, 1, false);
  applyLimb(rig.armR, pose.armR, -1, false);
  applyLimb(rig.legL, pose.legL, 1, true);
  applyLimb(rig.legR, pose.legR, -1, true);
  // Keep feet level with the floor whatever the knees are doing.
  rig.legL.end.rotation.x = (pose.legL.fwd - pose.legL.bend) * 0.8;
  rig.legR.end.rotation.x = (pose.legR.fwd - pose.legR.bend) * 0.8;
}

/** The one material every joint of a close-up person shares; colour rides in the geometry. */
const bodyMaterial = () => mat('#ffffff', { vertexColors: true, roughness: 0.8 });

/** A mesh's geometry in its joint's frame, unindexed, with its material's colour on every vertex. */
function paintedPart(mesh: THREE.Mesh, withColor: boolean): THREE.BufferGeometry {
  mesh.updateMatrix();
  const source = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  const geometry = source.index ? source.toNonIndexed() : source;
  for (const name of Object.keys(geometry.attributes))
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  const material = mesh.material as THREE.MeshStandardMaterial;
  // Faceted things (hair) keep their facets through face normals, as the shared material is smooth.
  if (material.flatShading) geometry.computeVertexNormals();
  if (withColor) {
    const count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) material.color.toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geometry;
}

/**
 * Collapses each joint of a close-up person into one vertex-coloured mesh (eyes apart, so they can
 * blink): about a third fewer draw calls than a mesh per material. Selection outlines come from
 * invisible copies of the outlined parts only, so faces never get outlined brows. Returns those.
 */
function paintJoints(
  root: THREE.Object3D,
  outlinable: Set<THREE.Mesh>,
  apart: ReadonlySet<THREE.Material>
): THREE.Mesh[] {
  const joints: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) joints.push(object);
  });
  const outlines: THREE.Mesh[] = [];
  for (const parent of joints) {
    const body = parent.children.filter(
      (child): child is THREE.Mesh =>
        child instanceof THREE.Mesh && !Array.isArray(child.material) && !apart.has(child.material)
    );
    if (!body.length) continue;
    const merged = new THREE.Mesh(
      mergeGeometries(body.map((mesh) => paintedPart(mesh, true))),
      bodyMaterial()
    );
    merged.castShadow = body.some((mesh) => mesh.castShadow);
    merged.receiveShadow = false;
    merged.userData.ownsGeometry = true;
    const outlined = body.filter((mesh) => outlinable.has(mesh));
    if (outlined.length) {
      const source = new THREE.Mesh(
        mergeGeometries(outlined.map((mesh) => paintedPart(mesh, false))),
        bodyMaterial()
      );
      source.visible = false;
      source.userData.ownsGeometry = true;
      parent.add(source);
      outlines.push(source);
    }
    for (const mesh of body) parent.remove(mesh);
    parent.add(merged);
  }
  // Eyes and their highlights: one mesh per material on the head.
  consolidate(root, new Set(), apart);
  return outlines;
}

/**
 * Merges the meshes that share a joint and a material into one, so a person costs about half the
 * draw calls. Joints still move independently. Returns the meshes that get a selection outline.
 */
function consolidate(
  root: THREE.Object3D,
  outlinable: Set<THREE.Mesh>,
  only?: ReadonlySet<THREE.Material>
): THREE.Mesh[] {
  const joints: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) joints.push(object);
  });
  const outlined: THREE.Mesh[] = [];
  for (const parent of joints) {
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
      if (only && !only.has(child.material)) continue;
      const list = byMaterial.get(child.material);
      if (list) list.push(child);
      else byMaterial.set(child.material, [child]);
    }
    for (const [material, list] of byMaterial) {
      const outline = list.some((mesh) => outlinable.has(mesh));
      if (list.length === 1) {
        if (outline) outlined.push(list[0]);
        continue;
      }
      const geometry = mergeGeometries(
        list.map((mesh) => {
          mesh.updateMatrix();
          const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
          for (const name of Object.keys(g.attributes))
            if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
          return g.index ? g.toNonIndexed() : g;
        })
      );
      if (!geometry) continue;
      const merged = new THREE.Mesh(geometry, material);
      merged.castShadow = list.some((mesh) => mesh.castShadow);
      merged.receiveShadow = false;
      merged.userData.ownsGeometry = true;
      for (const mesh of list) parent.remove(mesh);
      parent.add(merged);
      if (outline) outlined.push(merged);
    }
  }
  return outlined;
}
