import { HUMAN_BONE_NAMES } from './humanoid-bones';
import type { CharacterVector3 } from './character-vector';
import type { RigPose } from './forward-kinematics';

export interface LookAtAngles {
  /** Yaw about the vertical axis; 0 points along the character's +Z. */
  readonly yaw: number;
  /** Pitch about the lateral axis; negative looks up. */
  readonly pitch: number;
}

/** Head yaw limit (~80°); beyond this a character must turn its body. */
const HEAD_YAW_LIMIT = 1.4;
/** Head extension limit (~52° up); pitch is negative when looking up. */
const HEAD_PITCH_UP_LIMIT = 0.9;
/** Head flexion limit (~40° down). */
const HEAD_PITCH_DOWN_LIMIT = 0.7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Yaw/pitch (radians) to aim a +Z-forward head from `from` toward `target`. */
export function computeLookAtAngles(from: CharacterVector3, target: CharacterVector3): LookAtAngles {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dz = target.z - from.z;
  const horizontal = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.atan2(dy, horizontal);
  return { yaw, pitch };
}

/**
 * Spread a look direction up the spine so the neck and chest help the head.
 *
 * `yaw`/`pitch` are the total head rotation. The per-bone weights below sum to
 * 1.0 (head 0.5 + neck 0.25 + chest 0.15 + spine 0.1 for yaw; head 0.5 +
 * neck 0.3 + chest 0.2 for pitch) so the accumulated chain rotation nets out
 * to exactly the requested angle instead of overshooting it.
 */
export function applyLookAt(pose: RigPose, angles: LookAtAngles): RigPose {
  const yaw = clamp(angles.yaw, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT);
  const pitch = clamp(angles.pitch, -HEAD_PITCH_UP_LIMIT, HEAD_PITCH_DOWN_LIMIT);
  return {
    ...pose,
    [HUMAN_BONE_NAMES.head]: [pitch * 0.5, yaw * 0.5, 0],
    [HUMAN_BONE_NAMES.neck]: [pitch * 0.3, yaw * 0.25, 0],
    [HUMAN_BONE_NAMES.chest]: [pitch * 0.2, yaw * 0.15, 0],
    [HUMAN_BONE_NAMES.spine]: [0, yaw * 0.1, 0],
  };
}

export function sampleLookAtPose(
  from: CharacterVector3,
  target: CharacterVector3,
  basePose: RigPose = {},
): RigPose {
  return applyLookAt(basePose, computeLookAtAngles(from, target));
}
