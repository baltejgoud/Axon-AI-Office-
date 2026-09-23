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

/** Close-up detail for the full characters; a lighter set for the instanced crowd seen from afar. */
const SHAPES = {
  full: {
    box: GEOMETRY.box,
    sphere: GEOMETRY.sphere,
    capsule: GEOMETRY.capsule,
    cylinder: GEOMETRY.cylinder,
    lowSphere: GEOMETRY.lowSphere,
    hairCap: new THREE.SphereGeometry(0.5, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    lens: new THREE.TorusGeometry(0.04, 0.006, 6, 18)
  },
  low: {
    box: GEOMETRY.box,
    sphere: new THREE.SphereGeometry(0.5, 10, 7),
    capsule: new THREE.CapsuleGeometry(0.5, 1, 3, 8),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    lowSphere: new THREE.IcosahedronGeometry(0.5, 0),
    hairCap: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    lens: new THREE.TorusGeometry(0.04, 0.006, 3, 10)
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
}

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
  const hair = mat(look.hair, { roughness: 0.95 });
  const width = look.build;

  // Hips and legs
  const hips = joint(body, 0, STANDING_HIP_HEIGHT, 0);
  add(hips, part(G.sphere, trousers, [0.36 * width, 0.2, 0.25], [0, -0.02, 0]));
  const leg = (side: 1 | -1): Limb => {
    const hip = joint(hips, 0.1 * side * width, -0.03, 0);
    add(hip, part(G.capsule, trousers, [0.16, THIGH / 2, 0.16], [0, -THIGH / 2, 0]));
    const knee = joint(hip, 0, -THIGH, 0);
    add(knee, part(G.capsule, trousers, [0.13, SHIN / 2, 0.13], [0, -SHIN / 2, 0]));
    const foot = joint(knee, 0, -SHIN, 0);
    add(foot, part(G.sphere, mat(look.shoes, { roughness: 0.6 }), [0.11, 0.075, 0.24], [0, -0.02, 0.05]));
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
  add(
    spine,
    part(G.box, mat(look.accent, { roughness: 0.5 }), [0.06, 0.04, 0.012], [0.1 * width, 0.33, 0.138]),
    false
  );

  // Neck and head
  const neck = joint(spine, 0, 0.47, 0);
  add(neck, part(G.cylinder, skin, [0.11, 0.07, 0.11], [0, 0.02, 0]));
  const head = joint(neck, 0, 0.05, 0);
  add(head, part(G.sphere, skin, [HEAD.w, HEAD.h, HEAD.d], [0, HEAD.y, 0]));
  const faceZ = HEAD.d / 2 - 0.012;
  for (const side of [1, -1]) {
    add(head, part(G.sphere, skin, [0.05, 0.08, 0.05], [0.148 * side, HEAD.y, 0]));
    head.add(
      part(
        G.sphere,
        mat('#23262b', { roughness: 0.3 }),
        [0.034, 0.042, 0.026],
        [0.058 * side, HEAD.y + 0.025, faceZ]
      )
    );
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
  add(head, part(G.sphere, skin, [0.045, 0.055, 0.05], [0, HEAD.y - 0.015, faceZ + 0.008]), false);
  // Small face details remain warm and legible in close-up.
  for (const side of [-1, 1]) {
    head.add(
      part(G.sphere, mat('#ffffff'), [0.009, 0.011, 0.006], [0.055 * side, HEAD.y + 0.033, faceZ + 0.014])
    );
    head.add(
      part(
        G.box,
        hair,
        [0.042, 0.009, 0.009],
        [0.058 * side, HEAD.y + 0.067, faceZ - 0.007],
        [0, 0, side * -0.1]
      )
    );
  }
  head.add(part(G.sphere, mat('#a36d5b'), [0.055, 0.012, 0.01], [0, HEAD.y - 0.065, faceZ - 0.002]));
  if (look.jacket)
    for (const side of [-1, 1])
      spine.add(part(G.box, shirt, [0.065, 0.13, 0.014], [side * 0.058, 0.38, 0.137], [0, 0, side * 0.3]));
  buildHair(head, look, hair, add, G);

  // Arms
  const arm = (side: 1 | -1): Limb => {
    const shoulder = joint(spine, 0.235 * side * width, 0.41, 0);
    add(shoulder, part(G.capsule, outer, [0.115, UPPER_ARM / 2, 0.115], [0, -UPPER_ARM / 2, 0]));
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    add(elbow, part(G.capsule, outer, [0.1, FOREARM / 2 - 0.01, 0.1], [0, -FOREARM / 2 + 0.01, 0]));
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
  return { root, scale, hips, spine, head, armL, armR, legL, legR, outlinable: consolidate(root, outlined) };
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
      add(head, part(G.sphere, hair, [0.28, 0.2, 0.15], [0, y - 0.03, -0.095]));
      return;
    case 'bob':
      cap(1.1);
      add(head, part(G.sphere, hair, [0.35, 0.31, 0.3], [0, y - 0.07, -0.05]));
      return;
    case 'bun':
      cap(1.08);
      add(head, part(G.sphere, hair, [0.15, 0.14, 0.15], [0, y + 0.17, -0.12]));
      return;
    case 'ponytail':
      cap(1.09);
      add(head, part(G.sphere, hair, [0.09, 0.09, 0.09], [0, y + 0.06, -0.165]));
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
      add(head, part(G.sphere, hair, [0.34, 0.28, 0.25], [0, y - 0.04, -0.09]));
      return;
    case 'wavy':
      cap(1.09);
      add(head, part(G.sphere, hair, [0.18, 0.09, 0.13], [0.05, y + 0.15, 0.085], [0, 0, -0.3]));
      add(head, part(G.sphere, hair, [0.28, 0.2, 0.15], [0, y - 0.03, -0.095]));
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

/**
 * Merges the meshes that share a joint and a material into one, so a person costs about half the
 * draw calls. Joints still move independently. Returns the meshes that get a selection outline.
 */
function consolidate(root: THREE.Object3D, outlinable: Set<THREE.Mesh>): THREE.Mesh[] {
  const joints: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) joints.push(object);
  });
  const outlined: THREE.Mesh[] = [];
  for (const parent of joints) {
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
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
