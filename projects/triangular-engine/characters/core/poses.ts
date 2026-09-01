import { HUMAN_BONE_NAMES, HUMAN_BONE_NAMES_ARRAY } from './humanoid-bones';
import type { BoneRotation, RigPose } from './forward-kinematics';

function rotation(x: number, y: number, z: number): BoneRotation {
  return [x, y, z];
}

/** Relaxed standing pose: the rig's A-pose rest state. */
export const IDLE_POSE: RigPose = {};

/** Approximate seated pose: hips/legs fold, knees bend, arms rest forward. */
export const SIT_POSE: RigPose = {
  hips: rotation(-0.22, 0, 0),
  spine: rotation(0.08, 0, 0),
  chest: rotation(0.05, 0, 0),
  leftUpperLeg: rotation(-1.25, 0, 0),
  leftLowerLeg: rotation(-1.35, 0, 0),
  rightUpperLeg: rotation(-1.25, 0, 0),
  rightLowerLeg: rotation(-1.35, 0, 0),
  leftUpperArm: rotation(-0.4, 0, 0.3),
  leftLowerArm: rotation(-0.6, 0, 0),
  rightUpperArm: rotation(-0.4, 0, -0.3),
  rightLowerArm: rotation(-0.6, 0, 0),
};

function blendRotation(from: BoneRotation | undefined, to: BoneRotation | undefined, t: number): BoneRotation {
  const a = from ?? [0, 0, 0];
  const b = to ?? [0, 0, 0];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Componentwise lerp between two poses; missing bones are treated as zero. */
export function blendPoses(from: RigPose, to: RigPose, amount: number): RigPose {
  const t = Math.min(1, Math.max(0, amount));
  const result: Partial<Record<keyof RigPose, BoneRotation>> = {};
  for (const name of HUMAN_BONE_NAMES_ARRAY) {
    const a = from[name];
    const b = to[name];
    if (a === undefined && b === undefined) continue;
    result[name] = blendRotation(a, b, t);
  }
  return result;
}
