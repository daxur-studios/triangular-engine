import { HUMAN_BONE_NAMES } from './humanoid-bones';
import type { RigPose } from './forward-kinematics';

export type LocomotionMode = 'idle' | 'walk' | 'run';

export interface LocomotionSample {
  readonly mode: LocomotionMode;
  /** Gait cycle phase in radians. */
  readonly phase: number;
  /** Vertical root bob in metres. */
  readonly bounce: number;
  readonly pose: RigPose;
}

interface GaitProfile {
  readonly frequency: number;
  readonly legSwing: number;
  readonly kneeBend: number;
  readonly armSwing: number;
  readonly bounce: number;
  readonly hipYaw: number;
  readonly shoulderYaw: number;
}

const PROFILES: Record<LocomotionMode, GaitProfile> = {
  idle: { frequency: 0, legSwing: 0, kneeBend: 0, armSwing: 0, bounce: 0, hipYaw: 0, shoulderYaw: 0 },
  walk: { frequency: 1.6, legSwing: 0.55, kneeBend: 0.85, armSwing: 0.45, bounce: 0.02, hipYaw: 0.12, shoulderYaw: 0.16 },
  run: { frequency: 2.6, legSwing: 0.95, kneeBend: 1.4, armSwing: 0.85, bounce: 0.06, hipYaw: 0.2, shoulderYaw: 0.28 },
};

/**
 * Sample an analytic gait pose at a point in time. Legs and arms swing in
 * anti-phase, knees bend on the back half of each stride, and the hips and
 * shoulders counter-rotate to carry the pelvis. Everything is deterministic in
 * `timeSeconds`, so the same instant always produces the same pose.
 */
export function sampleLocomotion(mode: LocomotionMode, timeSeconds: number): LocomotionSample {
  const profile = PROFILES[mode];
  if (mode === 'idle') {
    return { mode, phase: 0, bounce: 0, pose: {} };
  }

  const phase = timeSeconds * profile.frequency * Math.PI * 2;
  const sin = Math.sin(phase);
  const bounce = (0.5 - 0.5 * Math.cos(phase * 2)) * profile.bounce;
  const kneeBend = Math.max(0, -sin) * profile.kneeBend;

  const pose: RigPose = {
    [HUMAN_BONE_NAMES.leftUpperLeg]: [sin * profile.legSwing, 0, 0],
    [HUMAN_BONE_NAMES.rightUpperLeg]: [-sin * profile.legSwing, 0, 0],
    [HUMAN_BONE_NAMES.leftLowerLeg]: [kneeBend, 0, 0],
    [HUMAN_BONE_NAMES.rightLowerLeg]: [Math.max(0, sin) * profile.kneeBend, 0, 0],
    [HUMAN_BONE_NAMES.leftUpperArm]: [-sin * profile.armSwing, 0, 0],
    [HUMAN_BONE_NAMES.rightUpperArm]: [sin * profile.armSwing, 0, 0],
    [HUMAN_BONE_NAMES.leftLowerArm]: [Math.max(0, sin) * profile.armSwing * 0.3, 0, 0],
    [HUMAN_BONE_NAMES.rightLowerArm]: [Math.max(0, -sin) * profile.armSwing * 0.3, 0, 0],
    [HUMAN_BONE_NAMES.hips]: [0, sin * profile.hipYaw, 0],
    [HUMAN_BONE_NAMES.chest]: [0, -sin * profile.shoulderYaw, 0],
  };

  return { mode, phase, bounce, pose };
}
