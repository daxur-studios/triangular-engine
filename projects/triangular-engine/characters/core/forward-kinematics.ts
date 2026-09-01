import type { HumanoidRig } from './character-rig';
import type { HumanoidBoneName } from './humanoid-bones';
import type { CharacterVector3 } from './character-vector';
import {
  characterQuaternionFromEuler,
  multiplyCharacterQuaternions,
  rotateCharacterVector3,
  type CharacterQuaternion,
} from './character-quaternion';

/** Local XYZ Euler rotation (radians) for a single bone. */
export type BoneRotation = readonly [number, number, number];

/** A pose maps canonical bone names to local rotations; absent bones keep rest. */
export type RigPose = Readonly<Partial<Record<HumanoidBoneName, BoneRotation>>>;

export const IDENTITY_POSE: RigPose = {};

const IDENTITY_ROTATION: BoneRotation = [0, 0, 0];

export interface RigWorldPose {
  /** World-space joint positions, aligned with `rig.bones`. */
  readonly positions: readonly CharacterVector3[];
  /** World-space bone orientations, aligned with `rig.bones`. */
  readonly orientations: readonly CharacterQuaternion[];
  readonly positionByName: ReadonlyMap<HumanoidBoneName, CharacterVector3>;
}

/**
 * Resolve a pose into world-space joint positions via forward kinematics.
 *
 * Each bone stores its rest offset from its parent. A bone's world orientation
 * is `parentOrientation · localRotation`, and its world position is its parent's
 * position plus the parent's orientation applied to that rest offset. Rotating
 * a bone therefore moves every descendant while leaving its own joint in place.
 */
export function solveForwardKinematics(rig: HumanoidRig, pose: RigPose = IDENTITY_POSE): RigWorldPose {
  const positions: CharacterVector3[] = new Array(rig.bones.length);
  const orientations: CharacterQuaternion[] = new Array(rig.bones.length);
  const positionByName = new Map<HumanoidBoneName, CharacterVector3>();
  const orientationByName = new Map<HumanoidBoneName, CharacterQuaternion>();

  for (let index = 0; index < rig.bones.length; index++) {
    const bone = rig.bones[index];
    const rotation = pose[bone.name] ?? IDENTITY_ROTATION;
    const localOrientation = characterQuaternionFromEuler(rotation[0], rotation[1], rotation[2]);

    if (bone.parent === null) {
      positions[index] = { x: bone.restPosition.x, y: bone.restPosition.y, z: bone.restPosition.z };
      orientations[index] = localOrientation;
    } else {
      const parentOrientation = orientationByName.get(bone.parent)!;
      const parentPosition = positionByName.get(bone.parent)!;
      const parentBone = rig.boneByName.get(bone.parent)!;
      const rotatedOffset = rotateCharacterVector3(parentOrientation, {
        x: bone.restPosition.x - parentBone.restPosition.x,
        y: bone.restPosition.y - parentBone.restPosition.y,
        z: bone.restPosition.z - parentBone.restPosition.z,
      });
      positions[index] = {
        x: parentPosition.x + rotatedOffset.x,
        y: parentPosition.y + rotatedOffset.y,
        z: parentPosition.z + rotatedOffset.z,
      };
      orientations[index] = multiplyCharacterQuaternions(parentOrientation, localOrientation);
    }

    positionByName.set(bone.name, positions[index]);
    orientationByName.set(bone.name, orientations[index]);
  }

  return { positions, orientations, positionByName };
}
