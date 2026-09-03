import { Matrix4, Quaternion, Skeleton, SkeletonHelper, type AnimationClip, type Bone } from 'three';
import {
  retargetClip,
  type RetargetClipOptions,
} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  HUMAN_BONE_NAMES,
  type HumanoidBoneName,
} from 'triangular-engine/characters';

/**
 * Canonical bone name → Mixamo bone name, used as three.js `retargetClip`'s
 * `names` option (target → source).
 *
 * Two Mixamo quirks are encoded here:
 *
 * 1. **Prefix.** Some Mixamo exports name bones `mixamorig:Hips` (which
 *    `FBXLoader` sanitizes to `mixamorigHips`) while others use the bare
 *    `Hips`. This table stores the bare name; `retargetMixamoClip` strips a
 *    leading `mixamorig` from each source bone before matching, so both
 *    conventions resolve.
 *
 * 2. **Left/right mirror.** Mixamo places its `Left*` bones on the world +X
 *    side and its `Right*` bones on −X, while the canonical rig has `left*` on
 *    −X and `right*` on +X (both face +Z). Naively copying left→left would make
 *    the motion appear cross-limbed, so every left/right pair is swapped here.
 *
 * The Mixamo humanoid has a longer spine (`Spine`, `Spine1`, `Spine2`) than
 * this rig (`spine`, `chest`), so `Spine1` folds into `chest` and the extra
 * segment is dropped. Finger, toe-end, and head-end bones are intentionally
 * left out. Jaw and eye bones have no Mixamo equivalent.
 */
export const MIXAMO_BONE_MAP: Readonly<Partial<Record<HumanoidBoneName, string>>> = {
  [HUMAN_BONE_NAMES.hips]: 'Hips',
  [HUMAN_BONE_NAMES.spine]: 'Spine',
  [HUMAN_BONE_NAMES.chest]: 'Spine1',
  [HUMAN_BONE_NAMES.neck]: 'Neck',
  [HUMAN_BONE_NAMES.head]: 'Head',
  [HUMAN_BONE_NAMES.leftShoulder]: 'RightShoulder',
  [HUMAN_BONE_NAMES.rightShoulder]: 'LeftShoulder',
  [HUMAN_BONE_NAMES.leftUpperArm]: 'RightArm',
  [HUMAN_BONE_NAMES.leftLowerArm]: 'RightForeArm',
  [HUMAN_BONE_NAMES.leftHand]: 'RightHand',
  [HUMAN_BONE_NAMES.rightUpperArm]: 'LeftArm',
  [HUMAN_BONE_NAMES.rightLowerArm]: 'LeftForeArm',
  [HUMAN_BONE_NAMES.rightHand]: 'LeftHand',
  [HUMAN_BONE_NAMES.leftUpperLeg]: 'RightUpLeg',
  [HUMAN_BONE_NAMES.leftLowerLeg]: 'RightLeg',
  [HUMAN_BONE_NAMES.leftFoot]: 'RightFoot',
  [HUMAN_BONE_NAMES.leftToes]: 'RightToeBase',
  [HUMAN_BONE_NAMES.rightUpperLeg]: 'LeftUpLeg',
  [HUMAN_BONE_NAMES.rightLowerLeg]: 'LeftLeg',
  [HUMAN_BONE_NAMES.rightFoot]: 'LeftFoot',
  [HUMAN_BONE_NAMES.rightToes]: 'LeftToeBase',
};

export interface RetargetMixamoOptions {
  /** Overrides the default Mixamo name map (target → source). */
  readonly boneMap?: Readonly<Partial<Record<HumanoidBoneName, string>>>;
}

/**
 * Wraps a `THREE.Skeleton` as the `Object3D` shape that `SkeletonUtils`'
 * `retargetClip` expects: a `SkeletonHelper` carrying the `.skeleton` reference
 * so the internal `AnimationMixer` can resolve `.bones[...]` tracks by name.
 */
function skeletonAsRoot(skeleton: Skeleton): SkeletonHelper {
  const helper = new SkeletonHelper(skeleton.bones[0]);
  (helper as SkeletonHelper & { skeleton: Skeleton }).skeleton = skeleton;
  return helper;
}

const MIXAMO_PREFIX = 'mixamorig';
const _sourceRestQuaternion = new Quaternion();

/** Strips the optional `mixamorig` prefix, leaving the bare Mixamo bone name. */
function baseName(name: string): string {
  return name.startsWith(MIXAMO_PREFIX) ? name.slice(MIXAMO_PREFIX.length) : name;
}

/**
 * Retargets a Mixamo-authored `AnimationClip` onto a target `THREE.Skeleton`
 * that shares the canonical VRM/Mixamo bone names (for example the skeleton
 * produced by `HumanoidRigVisualization`).
 *
 * Delegates the resampling and bone-name remapping to three.js's
 * `SkeletonUtils.retargetClip`, and adds per-bone rest-pose offsets so the
 * source's T-pose is reconciled with the target's A-pose. Root-motion
 * translation is intentionally not captured, so the clip plays in place.
 */
export function retargetMixamoClip(
  targetSkeleton: Skeleton,
  sourceSkeleton: Skeleton,
  clip: AnimationClip,
  options: RetargetMixamoOptions = {},
): AnimationClip {
  const boneMap = options.boneMap ?? MIXAMO_BONE_MAP;

  const sourceBoneByName = new Map<string, Bone>();
  for (const bone of sourceSkeleton.bones) {
    const normalized = baseName(bone.name);
    if (!sourceBoneByName.has(normalized)) sourceBoneByName.set(normalized, bone);
  }

  const sourceRoot = sourceSkeleton.bones[0];
  sourceRoot.updateWorldMatrix(true, true);

  const names: Record<string, string> = {};
  const localOffsets: Record<string, Matrix4> = {};
  for (const [canonicalName, mixamoBaseName] of Object.entries(boneMap)) {
    const sourceBone = sourceBoneByName.get(mixamoBaseName as string);
    if (!sourceBone) continue;
    names[canonicalName] = sourceBone.name;
    sourceBone.getWorldQuaternion(_sourceRestQuaternion).invert();
    localOffsets[canonicalName] = new Matrix4().makeRotationFromQuaternion(_sourceRestQuaternion);
  }

  const targetRoot = skeletonAsRoot(targetSkeleton);
  const sourceWrapper = skeletonAsRoot(sourceSkeleton);
  try {
    return retargetClip(targetRoot, sourceWrapper, clip, {
      names,
      localOffsets,
    } as RetargetClipOptions & { localOffsets: Record<string, Matrix4> });
  } finally {
    targetRoot.dispose();
    sourceWrapper.dispose();
  }
}
