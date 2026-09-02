import { Bone, Euler, Quaternion, Skeleton } from 'three';
import { HUMAN_BONE_NAMES_ARRAY, type HumanoidBoneName, type RigPose } from 'triangular-engine/characters';

export interface PoseToSkeletonOptions {
  /**
   * Maps a canonical bone name to the target skeleton's bone name. Return
   * `undefined` to skip that bone. Defaults to an identity mapping (the target
   * uses the canonical VRM/Mixamo names directly).
   */
  readonly boneNameMapper?: (canonicalName: HumanoidBoneName) => string | undefined;
}

const euler = new Euler(0, 0, 0, 'XYZ');
const quaternion = new Quaternion();

/**
 * Retargets a `RigPose` onto an arbitrary `THREE.Skeleton` by bone name, so a
 * GLB/glTF skeleton that shares the canonical VRM/Mixamo bone names can be
 * driven by the same procedural motion as the built-in rig.
 *
 * Every canonical bone is applied — those absent from `pose` are reset to rest
 * — while bones the target may have beyond the canonical set are left untouched.
 */
export function applyPoseToSkeleton(
  pose: RigPose,
  skeleton: Skeleton,
  options: PoseToSkeletonOptions = {},
): void {
  const boneByName = new Map<string, Bone>();
  for (const bone of skeleton.bones) boneByName.set(bone.name, bone);
  const mapper = options.boneNameMapper;

  for (const canonicalName of HUMAN_BONE_NAMES_ARRAY) {
    const targetName = mapper ? mapper(canonicalName) : canonicalName;
    if (targetName === undefined) continue;
    const bone = boneByName.get(targetName);
    if (!bone) continue;

    const rotation = pose[canonicalName] ?? [0, 0, 0];
    euler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
    quaternion.setFromEuler(euler);
    bone.quaternion.copy(quaternion);
  }
}
