import * as THREE from 'three';
import type { Appearance } from '../agents/appearance';
import { applyPose, buildHumanoid, type HumanoidRig } from '../agents/HumanoidRig';
import { WALK_STRIDE, computePose, easePose, neutralPose, type Pose } from '../agents/poses';
import { GEOMETRY, box, mat, part } from '../room/materials';
import { group } from '../room/kit';
import { cupOfCoffee, plate } from '../room/food';
import { fryingPan } from '../room/kitchen';
import { StaffRoutines, type StaffId, type StaffState, type StaffTool } from './routines';

/**
 * Draws the café staff from their routines: two chefs and a barista on the same rig as everyone
 * else, in work clothes, with the tool of the moment in hand. They have no click targets, labels or
 * portraits, and the scene hides them whenever the café is far away or off screen.
 */

const base = (look: Partial<Appearance>): Appearance => ({
  height: 1.72,
  build: 1,
  skin: '#c89574',
  hair: '#2b2220',
  hairStyle: 'crop',
  shirt: '#f7f6f2',
  jacket: null,
  trousers: '#3b4048',
  shoes: '#1f2328',
  accent: '#e24b4b',
  glasses: false,
  top: 'shirt',
  beard: null,
  headphones: false,
  ...look
});

const LOOKS: Record<StaffId, Appearance> = {
  'chef-grill': base({ uniform: 'chef', beard: '#2b2220', height: 1.78, build: 1.06 }),
  'chef-prep': base({
    uniform: 'chef',
    skin: '#f1d0b5',
    hair: '#b0703a',
    hairStyle: 'bun',
    height: 1.66,
    build: 0.94
  }),
  barista: base({
    uniform: 'barista',
    skin: '#9a6647',
    hair: '#141110',
    hairStyle: 'short',
    shirt: '#2b2f36',
    top: 'tee',
    trousers: '#35507a',
    shoes: '#f2f2f2',
    height: 1.7,
    build: 0.96
  })
};

/** A tool for the right hand, laid out level with the body: forward is +z. */
function tool(kind: StaffTool): THREE.Object3D {
  const steel = { metalness: 0.5, roughness: 0.3 } as const;
  switch (kind) {
    case 'spatula':
      return group(
        part(GEOMETRY.box, mat('#2b2f36'), [0.02, 0.02, 0.18], [0, -0.02, 0.1], [0.5, 0, 0]),
        box('#9aa1ab', [0.07, 0.006, 0.08], [0, -0.1, 0.22], steel)
      );
    case 'pan': {
      const pan = fryingPan();
      pan.rotation.y = Math.PI;
      pan.position.set(0, -0.05, 0.3);
      return group(pan);
    }
    case 'knife':
      return group(
        box('#2b2f36', [0.022, 0.025, 0.09], [0, -0.02, 0.03]),
        box('#d9dce1', [0.006, 0.035, 0.16], [0, -0.02, 0.15], steel)
      );
    case 'plate': {
      const dish = plate(0.1);
      dish.position.set(0, -0.02, 0.12);
      return group(dish);
    }
    case 'cloth':
      return group(box('#e3ecef', [0.12, 0.014, 0.1], [0, -0.05, 0.05], { roughness: 0.95 }));
    case 'cup': {
      const cup = cupOfCoffee();
      cup.position.set(0, -0.03, 0.06);
      return group(cup);
    }
  }
}

interface Member {
  id: StaffId;
  rig: HumanoidRig;
  pose: Pose;
  tools: Map<StaffTool, THREE.Object3D>;
  phase: number;
  since: number;
  action: string;
  heading: number;
  seed: number;
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export class StaffLayer {
  readonly object = new THREE.Group();
  private readonly routines: StaffRoutines;
  private readonly members: Member[] = [];
  private states: readonly StaffState[] = [];
  private readonly handQuat = new THREE.Quaternion();
  private readonly rootQuat = new THREE.Quaternion();

  constructor(private readonly reducedMotion: boolean) {
    this.routines = new StaffRoutines(reducedMotion);
    this.object.name = 'staff';
    (Object.keys(LOOKS) as StaffId[]).forEach((id, index) => {
      const rig = buildHumanoid(LOOKS[id], 'full');
      rig.root.name = `staff-${id}`;
      const tools = new Map<StaffTool, THREE.Object3D>();
      for (const kind of ['spatula', 'pan', 'knife', 'plate', 'cloth', 'cup'] as const) {
        const object = tool(kind);
        object.visible = false;
        object.traverse((child) => (child.castShadow = false));
        rig.armR.end.add(object);
        tools.set(kind, object);
      }
      this.object.add(rig.root);
      this.members.push({
        id,
        rig,
        pose: neutralPose(),
        tools,
        phase: 0,
        since: 0,
        action: '',
        heading: 0,
        seed: 0.2 + index * 0.3
      });
    });
    this.states = this.routines.update(0, []);
  }

  /** Where everyone is and what they are doing. */
  info(): readonly StaffState[] {
    return this.states;
  }

  /**
   * Moves the routines on and, when `visible`, poses everyone. `waiting` lists the café pickups
   * where a coworker stands. The routines keep time while hidden, so the café is mid-flow on return.
   */
  update(dt: number, time: number, waiting: readonly string[], visible: boolean): readonly StaffState[] {
    this.states = this.routines.update(dt, waiting);
    this.object.visible = visible;
    if (!visible) return this.states;
    const clock = this.reducedMotion ? 0 : time;
    this.states.forEach((state, i) => {
      const member = this.members[i];
      const { rig } = member;
      rig.root.position.set(state.x, 0, state.z);
      member.heading = wrap(member.heading + wrap(state.heading - member.heading) * (1 - Math.exp(-10 * dt)));
      rig.root.rotation.y = member.heading;
      const behavior = state.walking ? 'walking' : state.action;
      if (behavior !== member.action) {
        member.action = behavior;
        member.since = 0;
      } else member.since += dt;
      member.phase += (state.speed * dt * Math.PI * 2) / WALK_STRIDE;
      const target = computePose({
        behavior,
        sit: 0,
        speed: state.speed,
        phase: member.phase,
        time: clock,
        since: member.since,
        seed: member.seed,
        held: null,
        seatHeight: 0.48,
        scale: rig.scale,
        lookYaw: 0,
        lounging: false
      });
      easePose(member.pose, target, 1 - Math.exp(-14 * dt));
      applyPose(rig, member.pose);
      // The tool in hand stays level with the body however the arm turns.
      rig.root.updateMatrixWorld(true);
      rig.armR.end.getWorldQuaternion(this.handQuat);
      rig.root.getWorldQuaternion(this.rootQuat);
      for (const [kind, object] of member.tools) {
        object.visible = kind === state.holding;
        if (object.visible) object.quaternion.copy(this.handQuat.invert().multiply(this.rootQuat));
      }
    });
    return this.states;
  }

  /** Where a staff member's head is on screen, in canvas pixels. */
  screenPoint(
    id: StaffId,
    camera: THREE.Camera,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    const member = this.members.find((m) => m.id === id);
    if (!member) return null;
    const point = member.rig.head.getWorldPosition(new THREE.Vector3()).project(camera);
    return { x: ((point.x + 1) * width) / 2, y: ((1 - point.y) * height) / 2 };
  }

  dispose(): void {
    for (const member of this.members)
      member.rig.root.traverse((object) => {
        if (object instanceof THREE.Mesh && object.userData.ownsGeometry) object.geometry.dispose();
      });
    this.object.removeFromParent();
  }
}
