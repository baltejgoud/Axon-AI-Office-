import * as THREE from 'three';
import { hashString } from '../../simulation/random';
import { yawTowards, type AgentBehaviorState, type AgentView, type HeldItem } from '../../simulation/types';
import { box, cylinder } from '../room/materials';
import { appearanceFor } from './appearance';
import { applyPose, buildHumanoid, type HumanoidRig } from './HumanoidRig';
import { WALK_STRIDE, computePose, easePose, neutralPose, type Pose } from './poses';

const ringGeometry = new THREE.RingGeometry(0.36, 0.43, 56);
const haloGeometry = new THREE.CircleGeometry(0.43, 40);
const hitGeometry = new THREE.BoxGeometry(0.62, 1.8, 0.62);
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
/** Books, folders, tablets and clipboards are held face-out, tipped back a little. */
const HELD_FLAT_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, -0.35));

export interface SeatInfo {
  height: number;
  lounging: boolean;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

function heldProp(item: HeldItem, accent: string): THREE.Object3D {
  switch (item) {
    case 'cup':
      return new THREE.Group().add(
        cylinder('#fbfaf6', 0.04, 0.1, [0, 0.03, 0]),
        cylinder(accent, 0.041, 0.035, [0, 0.03, 0])
      );
    case 'book':
      return box('#3d5a80', [0.03, 0.22, 0.16], [0, 0, 0.02]);
    case 'folder':
      return box('#e7c77d', [0.02, 0.3, 0.22], [0, 0, 0.02]);
    case 'tablet':
      return new THREE.Group().add(
        box('#262a30', [0.012, 0.25, 0.18], [0, 0, 0.02]),
        box('#9fb7ff', [0.002, 0.22, 0.15], [0.007, 0, 0.02], { emissive: '#7e9cff', emissiveIntensity: 0.4 })
      );
    case 'clipboard':
      return new THREE.Group().add(
        box('#9f7549', [0.012, 0.3, 0.22], [0, 0, 0.02]),
        box('#fbfaf6', [0.002, 0.24, 0.19], [0.007, -0.02, 0.02])
      );
  }
}

/**
 * One coworker in the 3D office: body, selection ring, click target and the prop in hand.
 * Everything it does comes from the simulation's view; this class only animates it.
 */
export class OfficeAgentCharacter {
  readonly root: THREE.Group;
  readonly hitBox: THREE.Mesh;
  readonly accent: string;
  private readonly rig: HumanoidRig;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly halo: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly props = new Map<HeldItem, THREE.Object3D>();
  private readonly seed: number;
  private readonly pose: Pose = neutralPose();
  private outlines: THREE.Mesh[] | null = null;
  private phase = 0;
  private behavior: AgentBehaviorState = 'idle';
  private since = 0;
  private selected = false;
  private hovered = false;
  private working = false;
  private glanceUntil = 0;
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchQuat2 = new THREE.Quaternion();

  constructor(
    readonly agentId: string,
    accent?: string
  ) {
    const look = appearanceFor(agentId, accent);
    this.accent = look.accent;
    this.seed = (hashString(agentId) % 1000) / 1000;
    this.rig = buildHumanoid(look);
    this.root = this.rig.root;
    this.root.name = `agent-${agentId}`;

    this.halo = new THREE.Mesh(
      haloGeometry,
      new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0, depthWrite: false })
    );
    this.ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0, depthWrite: false })
    );
    for (const disc of [this.halo, this.ring]) {
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.015;
      disc.renderOrder = 2;
      this.root.add(disc);
    }

    this.hitBox = new THREE.Mesh(hitGeometry, hitMaterial);
    this.hitBox.position.y = 0.9;
    this.hitBox.userData.agentId = agentId;
    this.root.add(this.hitBox);

    for (const item of ['cup', 'book', 'folder', 'tablet', 'clipboard'] as const) {
      const prop = heldProp(item, look.accent);
      prop.visible = false;
      prop.traverse((o) => (o.castShadow = true));
      (item === 'cup' ? this.rig.armR : this.rig.armL).end.add(prop);
      this.props.set(item, prop);
    }
  }

  setSelected(value: boolean, now: number): void {
    if (value && !this.selected) this.glanceUntil = now + 1.6;
    this.selected = value;
    if (value && !this.outlines) this.outlines = this.buildOutlines();
    for (const outline of this.outlines ?? []) outline.visible = value;
  }

  setHovered(value: boolean): void {
    this.hovered = value;
  }

  setWorking(value: boolean): void {
    this.working = value;
  }

  /** World point just above the head, for the floating name label. */
  labelPoint(target: THREE.Vector3): THREE.Vector3 {
    this.rig.head.getWorldPosition(target);
    target.y += 0.42 * this.rig.scale;
    return target;
  }

  update(
    view: AgentView,
    dt: number,
    time: number,
    seat: SeatInfo | null,
    cameraYaw: number,
    reducedMotion: boolean
  ): void {
    this.root.position.set(view.position.x, 0, view.position.z);
    this.root.rotation.y = view.heading;

    if (view.behavior !== this.behavior) {
      this.behavior = view.behavior;
      this.since = 0;
    } else this.since += dt;
    this.phase += (view.speed * dt * Math.PI * 2) / WALK_STRIDE;

    let lookYaw: number;
    if (view.attention) lookYaw = wrap(yawTowards(view.position, view.attention) - view.heading);
    else if (time < this.glanceUntil && view.behavior !== 'walking') lookYaw = wrap(cameraYaw - view.heading);
    else if (reducedMotion) lookYaw = 0;
    else
      lookYaw =
        0.45 * Math.sin(time * 0.21 + this.seed * 7) * Math.max(0, Math.sin(time * 0.53 + this.seed * 3));
    lookYaw = Math.max(-1.1, Math.min(1.1, lookYaw));

    const target = computePose({
      behavior: view.behavior,
      sit: view.sit,
      speed: view.speed,
      phase: this.phase,
      time: reducedMotion ? 0 : time,
      since: this.since,
      seed: this.seed,
      held: view.heldItem,
      seatHeight: seat?.height ?? 0.48,
      scale: this.rig.scale,
      lookYaw,
      lounging: seat?.lounging ?? false
    });
    easePose(this.pose, target, 1 - Math.exp(-18 * dt));
    applyPose(this.rig, this.pose);

    // Seated people are shorter targets; keep the click box around the body.
    this.hitBox.scale.y = 1 - 0.3 * view.sit;
    this.hitBox.position.y = 0.9 * this.hitBox.scale.y;

    const pulse = this.working && !reducedMotion ? 0.85 + 0.15 * Math.sin(time * 3) : 1;
    this.ring.material.opacity = this.selected ? 0.95 : this.hovered ? 0.55 : 0;
    this.halo.material.opacity = this.selected ? 0.16 * pulse : this.hovered ? 0.08 : 0;
    this.ring.scale.setScalar(this.selected ? pulse * 1.02 : 1);

    this.updateProps(view.heldItem);
  }

  private updateProps(held: HeldItem | null): void {
    for (const [item, prop] of this.props) prop.visible = item === held;
    if (!held) return;
    // Hold things upright however the arm is bent.
    const prop = this.props.get(held)!;
    this.root.updateMatrixWorld(true);
    prop.parent!.getWorldQuaternion(this.scratchQuat);
    this.root.getWorldQuaternion(this.scratchQuat2);
    prop.quaternion.copy(this.scratchQuat.invert().multiply(this.scratchQuat2));
    if (held !== 'cup') prop.quaternion.multiply(HELD_FLAT_TILT);
  }

  private buildOutlines(): THREE.Mesh[] {
    // Inverted hull, pushed out along the normals, so merged body parts outline cleanly.
    const material = new THREE.MeshBasicMaterial({ color: this.accent, side: THREE.BackSide });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  transformed += normal * 0.016;'
      );
    };
    return this.rig.outlinable.map((mesh) => {
      const outline = new THREE.Mesh(mesh.geometry, material);
      outline.position.copy(mesh.position);
      outline.rotation.copy(mesh.rotation);
      outline.scale.copy(mesh.scale);
      outline.castShadow = false;
      mesh.parent!.add(outline);
      return outline;
    });
  }

  dispose(): void {
    this.ring.material.dispose();
    this.halo.material.dispose();
    const outlineMaterial = this.outlines?.[0]?.material as THREE.Material | undefined;
    outlineMaterial?.dispose();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.ownsGeometry) object.geometry.dispose();
    });
    this.root.removeFromParent();
  }
}
