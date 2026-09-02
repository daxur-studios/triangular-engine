import type { CharacterVector3 } from './character-vector';
import {
  characterVectorAdd,
  characterVectorDot,
  characterVectorLength,
  characterVectorLengthSquared,
  characterVectorScale,
  characterVectorSubtract,
  normalizeCharacterVector3,
} from './character-vector';
import {
  characterQuaternionConjugate,
  characterQuaternionFromUnitVectors,
  characterQuaternionIdentity,
  characterQuaternionToEulerXYZ,
  multiplyCharacterQuaternions,
} from './character-quaternion';
import type { HumanoidRig } from './character-rig';
import { solveForwardKinematics, type BoneRotation, type RigPose } from './forward-kinematics';
import type { HumanoidBoneName } from './humanoid-bones';

export interface ReachIkOptions {
  /** World-space direction the mid joint (elbow/knee) bends toward. */
  readonly pole?: CharacterVector3;
}

export interface ReachIkResult {
  /** The input pose with the two chain bones rotated to reach the target. */
  readonly pose: RigPose;
  /** Whether the end effector lands exactly on the requested target. */
  readonly reached: boolean;
  /** Solved world-space position of the mid joint (e.g. elbow). */
  readonly elbow: CharacterVector3;
  /** Clamped world-space position of the end effector (e.g. wrist). */
  readonly end: CharacterVector3;
}

const DEFAULT_POLE: CharacterVector3 = { x: 0, y: -1, z: 0 };

/**
 * Analytic two-bone inverse kinematics for a parent→mid→end chain.
 *
 * `root` is the bone whose joint is the pivot (upper arm/leg), `mid` the
 * elbow/knee, and `end` the wrist/ankle. Segment lengths come from each bone's
 * `length`. The elbow is solved in the plane spanned by the root→target axis
 * and `pole`, which keeps the bend direction predictable. Targets beyond full
 * extension are clamped along the axis (`reached` is then `false`); targets
 * inside the fully folded arm collapse to a bent configuration.
 */
export function solveTwoBoneIk(
  rig: HumanoidRig,
  basePose: RigPose,
  root: HumanoidBoneName,
  mid: HumanoidBoneName,
  end: HumanoidBoneName,
  target: CharacterVector3,
  options: ReachIkOptions = {},
): ReachIkResult {
  const rootBone = rig.boneByName.get(root)!;
  const midBone = rig.boneByName.get(mid)!;
  const endBone = rig.boneByName.get(end)!;
  const l1 = rootBone.length;
  const l2 = midBone.length;

  const solved = solveForwardKinematics(rig, basePose);
  const rootPosition = solved.positionByName.get(root)!;
  const parentWorld = rootBone.parent === null
    ? characterQuaternionIdentity()
    : solved.orientationByName.get(rootBone.parent)!;

  const toTarget = characterVectorSubtract(target, rootPosition);
  const rawDistance = characterVectorLength(toTarget);
  const maxDistance = l1 + l2;
  const minDistance = Math.abs(l1 - l2);
  const clampedDistance = Math.min(maxDistance, Math.max(minDistance, rawDistance));
  const reached = rawDistance >= minDistance && rawDistance <= maxDistance;

  const axis = rawDistance > 1e-8
    ? characterVectorScale(toTarget, 1 / rawDistance)
    : { x: 0, y: 0, z: 1 };

  const a = (l1 * l1 - l2 * l2 + clampedDistance * clampedDistance) / (2 * clampedDistance);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

  const pole = options.pole ?? DEFAULT_POLE;
  let polePerpendicular = characterVectorSubtract(pole, characterVectorScale(axis, characterVectorDot(pole, axis)));
  if (characterVectorLengthSquared(polePerpendicular) < 1e-10) {
    const fallback = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    polePerpendicular = characterVectorSubtract(fallback, characterVectorScale(axis, characterVectorDot(fallback, axis)));
  }
  const elbowDirection = normalizeCharacterVector3(polePerpendicular);

  const center = characterVectorAdd(rootPosition, characterVectorScale(axis, a));
  const elbow = characterVectorAdd(center, characterVectorScale(elbowDirection, h));
  const endPosition = characterVectorAdd(rootPosition, characterVectorScale(axis, clampedDistance));

  const upperRest = normalizeCharacterVector3(characterVectorSubtract(midBone.restPosition, rootBone.restPosition));
  const lowerRest = normalizeCharacterVector3(characterVectorSubtract(endBone.restPosition, midBone.restPosition));
  const upperDirection = normalizeCharacterVector3(characterVectorSubtract(elbow, rootPosition));
  const lowerDirection = normalizeCharacterVector3(characterVectorSubtract(endPosition, elbow));

  const upperWorld = characterQuaternionFromUnitVectors(upperRest, upperDirection);
  const lowerWorld = characterQuaternionFromUnitVectors(lowerRest, lowerDirection);
  const localUpper = multiplyCharacterQuaternions(characterQuaternionConjugate(parentWorld), upperWorld);
  const localLower = multiplyCharacterQuaternions(characterQuaternionConjugate(upperWorld), lowerWorld);

  const rotations: Partial<Record<HumanoidBoneName, BoneRotation>> = {};
  rotations[root] = characterQuaternionToEulerXYZ(localUpper);
  rotations[mid] = characterQuaternionToEulerXYZ(localLower);

  return { pose: { ...basePose, ...rotations }, reached, elbow, end: endPosition };
}
