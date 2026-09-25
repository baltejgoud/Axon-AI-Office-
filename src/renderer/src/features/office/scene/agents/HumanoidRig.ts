import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, part } from '../room/materials';
import { bodyShapes, type BodyShapes } from './bodyShapes';
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
/** From the wrist to the middle of the palm, along the hand: where held things sit. */
export const HAND_GRIP = -0.045;
/** Soles: a pale rubber under casual shoes, dark leather under formal ones. */
export const SOLE = { light: '#ece6dc', dark: '#4a3a30' } as const;

type Shapes = BodyShapes;

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
  const G = bodyShapes(detail);
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
  const hair = mat(look.hair, { roughness: 0.72 });
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
  add(hips, part(G.pelvis, trousers, [0.18 * width, 1, 0.125], [0, 0, 0]));
  // A belt where a shirt is tucked in; jackets and knitwear cover the waist.
  if (look.top === 'shirt' || look.top === 'polo' || look.top === 'vest')
    add(
      hips,
      part(G.cylinder, mat(SOLE.dark, { roughness: 0.8 }), [0.372 * width, 0.03, 0.262], [0, 0.04, 0]),
      false
    );
  const leg = (side: 1 | -1): Limb => {
    const hip = joint(hips, 0.095 * side * width, -0.03, 0);
    add(hip, part(G.limb, trousers, [0.17, THIGH / 2, 0.17], [0, -THIGH / 2, 0]));
    const knee = joint(hip, 0, -THIGH, 0);
    // The knee, so thigh and shin meet without a pinch however far it bends.
    add(knee, part(G.mid, trousers, [0.138, 0.13, 0.138], [0, -0.005, 0]), false);
    add(knee, part(G.limb, trousers, [0.14, SHIN / 2, 0.14], [0, -SHIN / 2, 0]));
    const foot = joint(knee, 0, -SHIN, 0);
    add(foot, part(G.shoe, mat(look.shoes, { roughness: 0.55 }), [1, 1, 1], [0, 0, 0]));
    add(foot, part(G.sole, sole, [1, 1, 1], [0, 0, 0]));
    return { root: hip, joint: knee, end: foot };
  };
  const legL = leg(1);
  const legR = leg(-1);

  // Torso: chest wider than the waist, shoulders rounding into the neck.
  const spine = joint(hips, 0, 0.05, 0);
  if (look.jacket) {
    // A jacket is a little fuller than the shirt and hangs past the waist.
    add(spine, part(G.torso, outer, [0.215 * width, 1.1, 0.138], [0, -0.07, 0]));
    // Its open front shows the shirt in a V, edged by lapels.
    add(spine, part(G.vee, shirt, [0.1 * width, 0.22, 0.05], [0, 0.35, 0.117]), false);
    // The shirt collar standing up around the neck, above the jacket.
    add(spine, part(G.cylinder, shirt, [0.13, 0.028, 0.118], [0, 0.462, 0.008]), false);
    for (const side of [-1, 1])
      add(
        spine,
        part(G.box, outer, [0.03, 0.2, 0.016], [side * 0.045 * width, 0.345, 0.128], [0.12, 0, -side * 0.28]),
        false
      );
  } else {
    add(spine, part(G.torso, shirt, [0.205 * width, 1, 0.128], [0, 0, 0]));
  }
  add(spine, part(G.box, accent, [0.055, 0.035, 0.012], [0.1 * width, 0.33, 0.126], [0, 0.35, 0]), false);
  if (look.top === 'suit') add(spine, part(G.box, accent, [0.03, 0.19, 0.012], [0, 0.31, 0.138]), false);
  if (look.top === 'hoodie') {
    // The hood rests behind the neck.
    add(spine, part(G.sphere, shirt, [0.3 * width, 0.15, 0.15], [0, 0.44, -0.1]));
    for (const side of [-1, 1])
      spine.add(part(G.box, mat('#f3f1ec'), [0.01, 0.1, 0.008], [side * 0.035, 0.36, 0.125]));
  }
  if (look.top === 'tee' || look.top === 'hoodie')
    // A ribbed neckband.
    add(spine, part(G.cylinder, shirt, [0.15, 0.03, 0.13], [0, 0.455, 0.005]), false);
  else if (!look.jacket)
    // Collar points either side of the neck.
    for (const side of [-1, 1])
      spine.add(
        part(G.box, shirt, [0.075, 0.032, 0.05], [side * 0.048, 0.455, 0.075], [0.4, 0, side * 0.35])
      );

  // Neck and head
  const neck = joint(spine, 0, 0.47, 0);
  add(neck, part(G.cylinder, skin, [0.1, 0.08, 0.1], [0, 0.02, 0]));
  const head = joint(neck, 0, 0.05, 0);
  head.scale.setScalar(HEAD_SCALE);
  add(head, part(G.head, skin, [HEAD.w, HEAD.h, HEAD.d], [0, HEAD.y, 0]));
  const faceZ = HEAD.d / 2 - 0.012;
  for (const side of [1, -1]) {
    add(head, part(G.small, skin, [0.045, 0.075, 0.045], [0.146 * side, HEAD.y + 0.005, -0.005]));
    head.add(part(G.small, eyeMaterial, [0.031, 0.04, 0.024], [0.057 * side, HEAD.y + 0.022, faceZ]));
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
  add(head, part(G.small, skin, [0.04, 0.05, 0.05], [0, HEAD.y - 0.018, faceZ + 0.006]), false);
  // Small face details remain warm and legible in close-up.
  for (const side of [-1, 1]) {
    head.add(part(G.small, highlight, [0.009, 0.011, 0.006], [0.052 * side, HEAD.y + 0.032, faceZ + 0.013]));
    head.add(
      part(
        G.capsule,
        hair,
        [0.014, 0.024, 0.012],
        [0.058 * side, HEAD.y + 0.068, faceZ - 0.006],
        [0, 0, Math.PI / 2]
      )
    );
  }
  head.add(part(G.smile, mat('#a36d5b'), [1.15, 0.55, 1], [0, HEAD.y - 0.052, faceZ - 0.004]));
  buildHair(head, look, hair, add, G);
  if (look.beard) {
    const beard = mat(look.beard, { roughness: 0.8 });
    // Along the jaw and chin, with a moustache above the smile.
    add(head, part(G.hairVolume, beard, [0.27, 0.16, 0.22], [0, HEAD.y - 0.085, 0.035]));
    add(
      head,
      part(G.capsule, beard, [0.022, 0.03, 0.02], [0, HEAD.y - 0.036, faceZ + 0.002], [0, 0, Math.PI / 2])
    );
  }
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
    const shoulder = joint(spine, 0.215 * side * width, 0.4, 0);
    add(shoulder, part(G.limb, upperSleeve, [0.115, UPPER_ARM / 2, 0.115], [0, -UPPER_ARM / 2, 0]));
    const elbow = joint(shoulder, 0, -UPPER_ARM, 0);
    add(elbow, part(G.limb, lowerSleeve, [0.1, FOREARM / 2 - 0.01, 0.1], [0, -FOREARM / 2 + 0.01, 0]));
    if (look.top !== 'tee') {
      // Cuffs: the shirt shows at the wrist under a layer; otherwise a band in the sleeve's own colour.
      const cuff = part(
        G.cylinder,
        LAYERED_TOPS.has(look.top) ? shirt : lowerSleeve,
        [0.09, 0.03, 0.09],
        [0, -FOREARM + 0.025, 0]
      );
      cuff.castShadow = false;
      elbow.add(cuff);
    }
    const hand = joint(elbow, 0, -FOREARM, 0);
    add(hand, part(G.hand[side], skin, [1, 1, 1], [0, 0, 0]));
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
    add(head, part(G.curls, white, [0.36, 0.2, 0.36], [0, HEAD.y + 0.32, -0.015]));
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

/**
 * Hair: a cap hugging the skull with a hairline above the brow, then the style's own masses. Every
 * piece is a closed, smooth shape, so no gaps open when a head turns.
 */
function buildHair(
  head: THREE.Group,
  look: Appearance,
  hair: THREE.Material,
  add: (parent: THREE.Object3D, mesh: THREE.Mesh, outline?: boolean) => THREE.Mesh,
  G: Shapes
): void {
  const y = HEAD.y;
  const piece = (
    geometry: THREE.BufferGeometry,
    size: [number, number, number],
    at: [number, number, number],
    turn: [number, number, number] = [0, 0, 0]
  ) => add(head, part(geometry, hair, size, at, turn));
  // Tipped back, so the hairline sits above the brow in front and reaches the nape behind.
  const cap = (grow: number) =>
    piece(G.hairCap, [HEAD.w * grow, HEAD.h * grow, HEAD.d * grow], [0, y + 0.005, -0.004], [-0.6, 0, 0]);
  /** The back of the head down to the nape. */
  const nape = (grow = 1) => piece(G.hairVolume, [0.28 * grow, 0.21 * grow, 0.16], [0, y - 0.025, -0.092]);
  /** A soft sweep across the forehead, falling to one side. */
  const sweep = (side: 1 | -1, size = 1) =>
    piece(
      G.hairVolume,
      [0.2 * size, 0.06 * size, 0.11],
      [side * 0.03, y + 0.112, 0.1],
      [0.55, 0, side * 0.32]
    );
  switch (look.hairStyle) {
    case 'short':
      cap(1.08);
      nape();
      sweep(1, 0.9);
      return;
    case 'crop':
      cap(1.07);
      nape(0.92);
      return;
    case 'buzz':
      cap(1.06);
      nape(0.86);
      return;
    case 'side-part':
      cap(1.08);
      nape();
      sweep(-1, 1.1);
      piece(G.hairVolume, [0.12, 0.055, 0.1], [0.07, y + 0.12, 0.085], [0.5, 0, -0.35]);
      return;
    case 'bob':
      cap(1.1);
      // Chin-length all round, with a straight fringe.
      piece(G.hairVolume, [0.36, 0.3, 0.31], [0, y - 0.05, -0.045]);
      piece(G.hairVolume, [0.27, 0.07, 0.11], [0, y + 0.11, 0.095], [0.5, 0, 0]);
      return;
    case 'long':
      cap(1.1);
      piece(G.hairVolume, [0.36, 0.32, 0.3], [0, y - 0.05, -0.05]);
      // Falling behind the shoulders.
      piece(G.hairVolume, [0.33, 0.5, 0.15], [0, y - 0.24, -0.12], [0.12, 0, 0]);
      sweep(-1, 0.95);
      return;
    case 'wavy':
      cap(1.1);
      piece(G.curls, [0.37, 0.34, 0.29], [0, y - 0.06, -0.06]);
      sweep(1);
      return;
    case 'curly':
      cap(1.1);
      piece(G.curls, [0.39, 0.33, 0.36], [0, y + 0.07, -0.06]);
      piece(G.curls, [0.33, 0.24, 0.2], [0, y - 0.04, -0.1]);
      return;
    case 'afro':
      cap(1.12);
      piece(G.curls, [0.5, 0.44, 0.45], [0, y + 0.09, -0.085]);
      return;
    case 'bun':
      cap(1.08);
      nape(0.95);
      piece(G.curls, [0.15, 0.14, 0.15], [0, y + 0.17, -0.12]);
      return;
    case 'ponytail':
      cap(1.09);
      nape(0.95);
      piece(G.hairVolume, [0.085, 0.085, 0.085], [0, y + 0.06, -0.165]);
      piece(G.strand, [0.1, 0.13, 0.085], [0, y - 0.08, -0.215], [0.32, 0, 0]);
      return;
    case 'braids':
      cap(1.06);
      nape(0.9);
      // Two plaits of rounded sections, hanging behind the shoulders.
      for (const side of [-1, 1])
        for (let i = 0; i < 5; i++)
          piece(
            G.hairVolume,
            [0.058 - i * 0.003, 0.065, 0.058 - i * 0.003],
            [side * (0.085 + i * 0.004), y - 0.07 - i * 0.052, -0.125 - i * 0.012]
          );
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
