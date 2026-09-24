import type { AgentBehaviorState, HeldItem } from '../../simulation/types';
import type { StaffAction } from '../staff/routines';

/** What a body can be doing: a coworker's behaviour or a café staff member's action. */
export type PoseBehavior = AgentBehaviorState | StaffAction;

/**
 * Procedural body poses. Angles are radians; lengths are in the unscaled skeleton's units
 * (a 1.68 m figure). Positive `fwd` swings a limb forward, positive `out` lifts it sideways
 * away from the body, positive `bend` folds an elbow forward or a knee backward.
 */
export interface LimbPose {
  fwd: number;
  out: number;
  bend: number;
}

export interface Pose {
  hipsY: number;
  hipsZ: number;
  lean: number;
  twist: number;
  tilt: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  armL: LimbPose;
  armR: LimbPose;
  legL: LimbPose;
  legR: LimbPose;
}

export interface PoseInput {
  behavior: PoseBehavior;
  /** 0 standing, 1 seated. */
  sit: number;
  /** Walking speed in m/s. */
  speed: number;
  /** Walk-cycle phase in radians. */
  phase: number;
  time: number;
  /** Seconds since the behaviour began. */
  since: number;
  /** Per-person 0..1 offset so nobody moves in lockstep. */
  seed: number;
  held: HeldItem | null;
  /** World height of the seat surface. */
  seatHeight: number;
  /** World metres per skeleton unit. */
  scale: number;
  /** Where to look, relative to facing, radians. */
  lookYaw: number;
  /** Sofa or armchair: sit back instead of upright. */
  lounging: boolean;
}

export const STANDING_HIP_HEIGHT = 0.76;
export const WALK_STRIDE = 1.15;

const limb = (fwd: number, out: number, bend: number): LimbPose => ({ fwd, out, bend });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpLimb = (a: LimbPose, b: LimbPose, t: number): LimbPose =>
  limb(lerp(a.fwd, b.fwd, t), lerp(a.out, b.out, t), lerp(a.bend, b.bend, t));

const RELAXED = limb(0.04, 0.16, 0.14);
const CUP_HOLD = limb(0.55, -0.12, 1.5);
const CARRY = limb(0.35, -0.15, 1.55);
const ON_DESK = limb(0.55, -0.2, 1.0);
const ON_LAP = limb(0.38, 0.03, 0.8);

export function neutralPose(): Pose {
  return {
    hipsY: STANDING_HIP_HEIGHT,
    hipsZ: 0,
    lean: 0,
    twist: 0,
    tilt: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    armL: { ...RELAXED },
    armR: { ...RELAXED },
    legL: limb(0, 0.03, 0.02),
    legR: limb(0, 0.03, 0.02)
  };
}

/** Right arm to the lips every eight seconds or so, otherwise holding the cup at chest height. */
function sipping(time: number, seed: number): { arm: LimbPose; headPitch: number } {
  const cycle = (time + seed * 9) % 8;
  if (cycle < 1.4) {
    const lift = Math.sin((cycle / 1.4) * Math.PI);
    return { arm: lerpLimb(CUP_HOLD, limb(0.95, -0.28, 2.35), lift), headPitch: -0.12 * lift };
  }
  return { arm: { ...CUP_HOLD }, headPitch: 0 };
}

export function computePose(input: PoseInput): Pose {
  const { behavior, sit, time, seed, held, since } = input;
  const pose = neutralPose();
  const seated = sit > 0.5;
  const t = time + seed * 40;

  // ---- legs and hips: standing, walking, or seated (blended by `sit`)
  const seatedHips = input.seatHeight / input.scale + 0.075;
  const seatedLeg = input.lounging ? limb(1.2, 0.1, 0.85) : limb(1.25, 0.06, 1.05);
  if (behavior === 'walking' && sit < 0.01) {
    const stride = Math.min(1.3, input.speed / 1.2);
    const swing = Math.sin(input.phase);
    const lift = Math.cos(input.phase);
    pose.legL = limb(0.46 * stride * swing, 0.03, 0.08 + 0.95 * stride * Math.max(0, lift));
    pose.legR = limb(-0.46 * stride * swing, 0.03, 0.08 + 0.95 * stride * Math.max(0, -lift));
    pose.hipsY = STANDING_HIP_HEIGHT - 0.025 * stride * (1 - Math.abs(lift));
    pose.lean = 0.06 * stride;
    pose.twist = 0.08 * stride * swing;
    pose.armL = limb(-0.38 * stride * swing, 0.15, 0.3);
    pose.armR = limb(0.38 * stride * swing, 0.15, 0.3);
    pose.headPitch = 0.04;
    pose.headYaw = input.lookYaw * 0.4;
  } else {
    pose.legL = lerpLimb(pose.legL, seatedLeg, sit);
    pose.legR = lerpLimb(pose.legR, seatedLeg, sit);
    pose.hipsY = lerp(STANDING_HIP_HEIGHT, seatedHips, sit);
    pose.hipsZ = lerp(0, -0.05, sit);
    pose.lean = lerp(0.02 + 0.012 * Math.sin(t * 1.6), input.lounging ? -0.22 : 0.05, sit);
    pose.tilt = seated ? 0 : 0.015 * Math.sin(t * 0.4);
    pose.headYaw = input.lookYaw * 0.7;
    pose.twist = input.lookYaw * 0.3;
    pose.headPitch = 0.03;
  }

  // ---- upper body by behaviour
  switch (behavior) {
    case 'walking':
      break;
    case 'typing': {
      const burst = 0.6 + 0.4 * Math.sin(t * 1.1);
      const left = Math.sin(t * 15);
      const right = Math.sin(t * 13.7 + Math.PI);
      pose.lean = seated ? 0.12 : pose.lean;
      pose.headPitch = 0.26 + 0.03 * Math.sin(t * 0.9);
      pose.armL = limb(0.55 + 0.045 * burst * left, -0.2, 0.95 + 0.09 * burst * left);
      pose.armR = limb(0.55 + 0.045 * burst * right, -0.2, 0.95 + 0.09 * burst * right);
      break;
    }
    case 'reading':
      if (seated && !held) {
        pose.lean = input.lounging ? -0.1 : 0.17;
        pose.headPitch = 0.32;
        pose.armL = { ...ON_DESK };
        pose.armR = limb(0.55, 0.06, 0.95 + 0.03 * Math.sin(t * 2.3));
      } else {
        // Holding a book, folder or tablet up to read.
        pose.headPitch = 0.38;
        pose.armL = limb(0.72, -0.24, 1.45);
        pose.armR = limb(0.64, -0.3, 1.36);
        if (seated) pose.lean = input.lounging ? -0.12 : 0.05;
      }
      break;
    case 'thinking':
      pose.lean = seated ? -0.1 : 0;
      pose.headPitch = -0.08;
      pose.headRoll = 0.08;
      pose.armR = limb(1.2, -0.35, 2.2);
      pose.armL = seated ? limb(0.4, -0.2, 1.35) : limb(0.3, -0.25, 1.4);
      break;
    case 'celebrating':
      if (since < 1.3) {
        pose.lean = -0.12;
        pose.headPitch = -0.2;
        pose.armL = limb(2.7, 0.35, 0.25 + 0.2 * Math.sin(t * 9));
        pose.armR = limb(2.7, 0.35, 0.25 + 0.2 * Math.sin(t * 9 + 1));
      } else {
        pose.lean = -0.18;
        pose.headPitch = -0.05;
        pose.armL = { ...ON_LAP };
        pose.armR = { ...ON_LAP };
      }
      break;
    case 'meeting': {
      const nod = Math.pow(Math.max(0, Math.sin(t * 1.9)), 6);
      pose.lean = seated ? 0.07 : 0.02;
      pose.headPitch = 0.06 + 0.07 * nod;
      pose.armL = seated ? limb(0.6, -0.18, 0.95) : { ...RELAXED };
      pose.armR = seated ? limb(0.6, -0.18, 0.95) : { ...RELAXED };
      break;
    }
    case 'talking':
      pose.headPitch = 0.02 + 0.04 * Math.sin(t * 3.4);
      pose.armR = limb(
        0.75 + 0.22 * Math.sin(t * 2.3),
        0.18 + 0.1 * Math.sin(t * 1.6),
        1.25 + 0.25 * Math.sin(t * 3.2)
      );
      pose.armL = seated
        ? limb(0.6, -0.18, 0.95)
        : held
          ? { ...CARRY }
          : limb(0.2 + 0.1 * Math.sin(t * 1.7), 0.16, 0.5);
      if (seated) pose.lean = 0.08;
      break;
    case 'coffee': {
      const sip = sipping(t, seed);
      pose.armR = sip.arm;
      pose.headPitch += sip.headPitch;
      pose.armL = seated ? { ...ON_LAP } : { ...RELAXED };
      break;
    }
    case 'waiting':
      pose.lean = 0.02;
      pose.armL = limb(0.3, -0.3, 1.25);
      pose.armR = limb(0.3, -0.3, 1.25);
      pose.headPitch = 0.08;
      break;
    case 'whiteboard':
      pose.headPitch = -0.15;
      pose.headYaw = 0.15 * Math.sin(t * 1.2);
      pose.armR = limb(
        1.5 + 0.1 * Math.sin(t * 4.5),
        0.12 + 0.18 * Math.sin(t * 1.2),
        0.5 + 0.15 * Math.sin(t * 4.5)
      );
      pose.armL = { ...RELAXED };
      break;
    case 'sitting':
      pose.armL = { ...ON_LAP };
      pose.armR = { ...ON_LAP };
      break;
    // ---- café staff, standing at their stations
    case 'stir':
      // Left hand on the pan's handle, the right stirring in small circles.
      pose.lean = 0.1;
      pose.headPitch = 0.38;
      pose.armL = limb(0.72, -0.18, 0.95);
      pose.armR = limb(0.92 + 0.1 * Math.sin(t * 5), -0.12 + 0.12 * Math.cos(t * 5), 1.0);
      break;
    case 'flip': {
      // Both hands on the pan, tossing it every second or so.
      const toss = Math.pow(Math.max(0, Math.sin(t * 5.2)), 3);
      pose.lean = 0.06 - 0.06 * toss;
      pose.headPitch = 0.3 - 0.25 * toss;
      pose.armR = limb(0.85 + 0.45 * toss, -0.2, 1.15 - 0.45 * toss);
      pose.armL = limb(0.7 + 0.2 * toss, -0.25, 1.1);
      break;
    }
    case 'season':
      pose.headPitch = 0.2;
      pose.armR = limb(1.25, -0.15, 1.2 + 0.18 * Math.sin(t * 16));
      pose.armL = limb(0.55, -0.2, 1.1);
      break;
    case 'chop': {
      const beat = Math.sin(t * 9);
      pose.lean = 0.14;
      pose.headPitch = 0.42;
      pose.armL = limb(0.72, -0.32, 1.15);
      pose.armR = limb(0.8 + 0.12 * Math.max(0, beat), -0.08, 1.05 + 0.3 * beat);
      break;
    }
    case 'plate': {
      const reach = 0.5 + 0.5 * Math.sin(t * 1.6);
      pose.lean = 0.1;
      pose.headPitch = 0.4;
      pose.armR = limb(0.7 + 0.15 * reach, -0.15, 0.95);
      pose.armL = limb(0.7 + 0.15 * (1 - reach), -0.15, 0.95);
      break;
    }
    case 'wipe':
      // Circles with a cloth on the counter, leaning over it.
      pose.lean = 0.2;
      pose.headPitch = 0.3;
      pose.twist = 0.08 * Math.sin(t * 3);
      pose.armR = limb(0.85 + 0.12 * Math.sin(t * 3), -0.1 + 0.28 * Math.cos(t * 3), 0.7);
      pose.armL = limb(0.6, -0.2, 0.8);
      break;
    case 'brew':
      // Working the machine: tamp, lock the handle in, wait for the shot.
      pose.headPitch = 0.25;
      pose.armR = limb(0.95, -0.2, 1.35 + 0.2 * Math.sin(t * 2.2));
      pose.armL = limb(0.85, -0.25, 1.3);
      break;
    case 'idle':
      if (seated) {
        pose.armL = input.lounging ? { ...ON_LAP } : { ...ON_DESK };
        pose.armR = input.lounging ? { ...ON_LAP } : limb(0.55, 0.05, 0.95);
      }
      break;
  }

  // ---- whatever is in hand overrides the arm that holds it
  if (held === 'cup' && behavior !== 'coffee') pose.armR = { ...CUP_HOLD };
  if (held && held !== 'cup' && behavior !== 'reading' && behavior !== 'talking') pose.armL = { ...CARRY };
  return pose;
}

/** Eases every channel of `current` toward `target`. */
export function easePose(current: Pose, target: Pose, amount: number): void {
  const scalars = ['hipsY', 'hipsZ', 'lean', 'twist', 'tilt', 'headPitch', 'headYaw', 'headRoll'] as const;
  for (const key of scalars) current[key] += (target[key] - current[key]) * amount;
  for (const key of ['armL', 'armR', 'legL', 'legR'] as const) {
    current[key].fwd += (target[key].fwd - current[key].fwd) * amount;
    current[key].out += (target[key].out - current[key].out) * amount;
    current[key].bend += (target[key].bend - current[key].bend) * amount;
  }
}
