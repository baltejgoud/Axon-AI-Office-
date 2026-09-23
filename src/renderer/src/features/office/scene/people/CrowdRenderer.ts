import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance, HairStyle, Top } from '../agents/appearance';
import { applyPose, buildHumanoid } from '../agents/HumanoidRig';
import { computePose } from '../agents/poses';

/** Seat height the crowd pose is baked at; office chairs sit here. */
const SEAT_HEIGHT = 0.5;
const BASE_HEIGHT = 1.68;
const HAIR_STYLES: HairStyle[] = [
  'short',
  'crop',
  'side-part',
  'buzz',
  'bob',
  'long',
  'ponytail',
  'bun',
  'curly',
  'afro',
  'braids',
  'wavy'
];
/** Tops that share a body shape share a baked template. */
const SHAPE_OF: Record<Top, Top> = {
  tee: 'tee',
  shirt: 'shirt',
  polo: 'shirt',
  hoodie: 'hoodie',
  blazer: 'blazer',
  cardigan: 'blazer',
  suit: 'suit',
  vest: 'vest'
};
const SHAPES: Top[] = ['tee', 'shirt', 'hoodie', 'blazer', 'suit', 'vest'];

type Role =
  | 'skin'
  | 'shirt'
  | 'outer'
  | 'trousers'
  | 'hair'
  | 'shoes'
  | 'badge'
  | 'beard'
  | 'eyes'
  | 'white'
  | 'mouth'
  | 'glasses'
  | 'headphones'
  | 'strings';

/** Colours no real appearance uses, so a baked mesh's material tells us which part it is. */
const SENTINEL: Record<
  'skin' | 'shirt' | 'outer' | 'trousers' | 'hair' | 'shoes' | 'badge' | 'beard',
  string
> = {
  skin: '#010101',
  shirt: '#020202',
  outer: '#030303',
  trousers: '#040404',
  hair: '#050505',
  shoes: '#060606',
  badge: '#070707',
  beard: '#080808'
};
const FIXED: Record<string, Role> = {
  '23262b': 'eyes',
  ffffff: 'white',
  a36d5b: 'mouth',
  '2b2f36': 'glasses',
  '1f2430': 'headphones',
  f3f1ec: 'strings'
};
const FIXED_COLOR: Partial<Record<Role, string>> = {
  eyes: '#23262b',
  white: '#ffffff',
  mouth: '#a36d5b',
  glasses: '#2b2f36',
  headphones: '#1f2430',
  strings: '#f3f1ec'
};
const BY_SENTINEL = new Map(Object.entries(SENTINEL).map(([role, color]) => [color.slice(1), role as Role]));

function roleOf(material: THREE.Material): Role | null {
  const hex = (material as THREE.MeshStandardMaterial).color?.getHexString();
  return (hex && (BY_SENTINEL.get(hex) ?? FIXED[hex])) || null;
}

/** Poses a template person at a desk (typing, seated) and merges its parts by role, in world space. */
function bake(look: Appearance, keep: (role: Role) => boolean): Map<Role, THREE.BufferGeometry> {
  const rig = buildHumanoid(look, 'low');
  applyPose(
    rig,
    computePose({
      behavior: 'typing',
      sit: 1,
      speed: 0,
      phase: 0,
      time: 0,
      since: 10,
      seed: 0.5,
      held: null,
      seatHeight: SEAT_HEIGHT,
      scale: rig.scale,
      lookYaw: 0,
      lounging: false
    })
  );
  rig.root.updateMatrixWorld(true);
  const parts = new Map<Role, THREE.BufferGeometry[]>();
  rig.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const role = roleOf(object.material);
    if (!role || !keep(role)) return;
    const geometry = object.geometry.clone();
    for (const name of Object.keys(geometry.attributes))
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    geometry.applyMatrix4(object.matrixWorld);
    const list = parts.get(role);
    if (list) list.push(geometry);
    else parts.set(role, [geometry]);
  });
  const merged = new Map<Role, THREE.BufferGeometry>();
  for (const [role, list] of parts) {
    const geometry = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
    list.forEach((g) => g.dispose());
    if (geometry) merged.set(role, geometry);
  }
  return merged;
}

const template = (overrides: Partial<Appearance>): Appearance => ({
  height: BASE_HEIGHT,
  build: 1,
  skin: SENTINEL.skin,
  hair: SENTINEL.hair,
  hairStyle: 'short',
  shirt: SENTINEL.shirt,
  jacket: null,
  trousers: SENTINEL.trousers,
  shoes: SENTINEL.shoes,
  accent: SENTINEL.badge,
  glasses: false,
  top: 'shirt',
  beard: null,
  headphones: false,
  ...overrides
});

export interface CrowdPerson {
  id: string;
  look: Appearance;
  seat: { x: number; z: number; facing: number };
}

interface Group {
  mesh: THREE.InstancedMesh;
  /** Index into `people` for each instance. */
  members: number[];
  slot: Map<number, number>;
}

/**
 * Everyone seated quietly at their desk, drawn as instanced figures: a handful of draw calls for the
 * whole campus. The figures are baked from the same rig and seated pose as the full characters,
 * with per-person colours, so swapping between the two is not noticeable.
 */
export class CrowdRenderer {
  readonly object = new THREE.Group();
  private readonly people: CrowdPerson[];
  private readonly index = new Map<string, number>();
  private readonly base: THREE.Matrix4[] = [];
  private readonly visible: boolean[] = [];
  private readonly groups: Group[] = [];
  private readonly hits: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh;
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly scratch = new THREE.Matrix4();
  private readonly lift = new THREE.Matrix4();
  private dirty = false;
  private frame = 0;

  constructor(people: CrowdPerson[]) {
    this.people = people;
    people.forEach((person, i) => {
      this.index.set(person.id, i);
      const s = person.look.height / BASE_HEIGHT;
      this.base.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(person.seat.x, SEAT_HEIGHT * (1 - s), person.seat.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), person.seat.facing),
          new THREE.Vector3(s, s, s)
        )
      );
      this.visible.push(true);
    });

    const colorOf = (look: Appearance, role: Role): string => {
      switch (role) {
        case 'skin':
          return look.skin;
        case 'shirt':
          return look.shirt;
        case 'outer':
          return look.jacket ?? look.shirt;
        case 'trousers':
          return look.trousers;
        case 'hair':
          return look.hair;
        case 'shoes':
          return look.shoes;
        case 'badge':
          return look.accent;
        case 'beard':
          return look.beard ?? look.hair;
        default:
          return FIXED_COLOR[role] ?? '#ffffff';
      }
    };
    const addGroup = (geometry: THREE.BufferGeometry, role: Role, members: number[]) => {
      if (!members.length) return;
      const fixed = FIXED_COLOR[role];
      const material = new THREE.MeshStandardMaterial({
        color: fixed ?? '#ffffff',
        roughness: role === 'eyes' || role === 'glasses' ? 0.35 : 0.85
      });
      const mesh = new THREE.InstancedMesh(geometry, material, members.length);
      mesh.name = `crowd-${role}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const color = new THREE.Color();
      members.forEach((person, slot) => {
        mesh.setMatrixAt(slot, this.base[person]);
        if (!fixed) mesh.setColorAt(slot, color.set(colorOf(people[person].look, role)));
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.computeBoundingSphere();
      this.groups.push({ mesh, members, slot: new Map(members.map((person, slot) => [person, slot])) });
      this.object.add(mesh);
    };

    const all = people.map((_, i) => i);
    const accessory: ReadonlySet<Role> = new Set(['hair', 'glasses', 'beard', 'headphones']);
    for (const shape of SHAPES) {
      const members = all.filter((i) => SHAPE_OF[people[i].look.top] === shape);
      if (!members.length) continue;
      const layered = shape === 'blazer' || shape === 'suit' || shape === 'vest';
      const look = template({ top: shape, jacket: layered ? SENTINEL.outer : null });
      for (const [role, geometry] of bake(look, (role) => !accessory.has(role)))
        addGroup(geometry, role, members);
    }
    const beards = all.filter((i) => people[i].look.beard);
    const beard = bake(
      template({ hairStyle: 'bald', beard: SENTINEL.beard }),
      (role) => role === 'beard'
    ).get('beard');
    if (beard) addGroup(beard, 'beard', beards);
    const listening = all.filter((i) => people[i].look.headphones);
    const phones = bake(
      template({ hairStyle: 'bald', headphones: true }),
      (role) => role === 'headphones'
    ).get('headphones');
    if (phones) addGroup(phones, 'headphones', listening);
    for (const style of HAIR_STYLES) {
      const members = all.filter((i) => people[i].look.hairStyle === style);
      if (!members.length) continue;
      const hair = bake(template({ hairStyle: style }), (role) => role === 'hair').get('hair');
      if (hair) addGroup(hair, 'hair', members);
    }
    const glasses = all.filter((i) => people[i].look.glasses);
    const lenses = bake(template({ glasses: true }), (role) => role === 'glasses').get('glasses');
    if (lenses) addGroup(lenses, 'glasses', glasses);

    // Invisible click targets and soft contact shadows, one instance per person.
    const hitGeometry = new THREE.BoxGeometry(0.62, 1.3, 0.62).translate(0, 0.65, 0);
    this.hits = new THREE.InstancedMesh(
      hitGeometry,
      new THREE.MeshBasicMaterial({ visible: false }),
      people.length
    );
    const blobGeometry = new THREE.CircleGeometry(0.46, 24).rotateX(-Math.PI / 2).translate(0, 0.018, 0);
    this.blobs = new THREE.InstancedMesh(
      blobGeometry,
      new THREE.MeshBasicMaterial({ color: '#1d2433', transparent: true, opacity: 0.13, depthWrite: false }),
      people.length
    );
    this.blobs.renderOrder = 1;
    people.forEach((person, i) => {
      const flat = new THREE.Matrix4().makeTranslation(person.seat.x, 0, person.seat.z);
      this.hits.setMatrixAt(i, flat);
      this.blobs.setMatrixAt(i, flat);
    });
    this.hits.computeBoundingSphere();
    this.blobs.computeBoundingSphere();
    this.object.add(this.blobs, this.hits);
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  /** Hide someone while they are drawn as a full character; show them again when they sit back down. */
  setVisible(id: string, visible: boolean): void {
    const person = this.index.get(id);
    if (person === undefined || this.visible[person] === visible) return;
    this.visible[person] = visible;
    const matrix = visible ? this.base[person] : this.hidden;
    for (const group of this.groups) {
      const slot = group.slot.get(person);
      if (slot !== undefined) group.mesh.setMatrixAt(slot, matrix);
    }
    const flat = visible
      ? this.scratch.makeTranslation(this.people[person].seat.x, 0, this.people[person].seat.z)
      : this.hidden;
    this.hits.setMatrixAt(person, flat);
    this.blobs.setMatrixAt(person, flat);
    this.hits.instanceMatrix.needsUpdate = true;
    this.blobs.instanceMatrix.needsUpdate = true;
    this.dirty = true;
  }

  /** A slow breath for everyone seated, applied every other frame. */
  update(elapsed: number, reducedMotion: boolean): void {
    this.frame++;
    if (!reducedMotion && this.frame % 2 === 0) {
      for (const group of this.groups)
        group.members.forEach((person, slot) => {
          if (!this.visible[person]) return;
          const breath = 1 + 0.012 * Math.sin(elapsed * 1.6 + person * 1.7);
          this.lift.makeScale(1, breath, 1);
          group.mesh.setMatrixAt(slot, this.scratch.multiplyMatrices(this.base[person], this.lift));
        });
      this.dirty = true;
    }
    if (!this.dirty) return;
    for (const group of this.groups) group.mesh.instanceMatrix.needsUpdate = true;
    this.dirty = false;
  }

  /** Which seated person is under the ray, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    const hit = raycaster.intersectObject(this.hits, false)[0];
    if (hit?.instanceId === undefined) return null;
    return this.visible[hit.instanceId] ? this.people[hit.instanceId].id : null;
  }

  /** Point above a seated person's head, for their name tag. */
  labelPoint(id: string, target: THREE.Vector3): THREE.Vector3 | null {
    const person = this.index.get(id);
    if (person === undefined) return null;
    const p = this.people[person];
    return target.set(p.seat.x, 1.45 * (p.look.height / BASE_HEIGHT), p.seat.z);
  }

  dispose(): void {
    for (const group of this.groups) {
      group.mesh.geometry.dispose();
      (group.mesh.material as THREE.Material).dispose();
      group.mesh.dispose();
    }
    for (const mesh of [this.hits, this.blobs]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
