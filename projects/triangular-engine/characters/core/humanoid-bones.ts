/**
 * Canonical humanoid bone vocabulary. Names follow the standard VRM/Mixamo
 * humanoid set so procedural motion and future keyframe retargeting share one
 * skeleton language. The vocabulary is plain data: any model that exposes
 * these names can be driven by the same motion.
 */
export const HUMAN_BONE_NAMES = {
  hips: 'hips',
  spine: 'spine',
  chest: 'chest',
  neck: 'neck',
  head: 'head',
  jaw: 'jaw',
  leftEye: 'leftEye',
  rightEye: 'rightEye',
  leftShoulder: 'leftShoulder',
  rightShoulder: 'rightShoulder',
  leftUpperArm: 'leftUpperArm',
  leftLowerArm: 'leftLowerArm',
  leftHand: 'leftHand',
  rightUpperArm: 'rightUpperArm',
  rightLowerArm: 'rightLowerArm',
  rightHand: 'rightHand',
  leftUpperLeg: 'leftUpperLeg',
  leftLowerLeg: 'leftLowerLeg',
  leftFoot: 'leftFoot',
  leftToes: 'leftToes',
  rightUpperLeg: 'rightUpperLeg',
  rightLowerLeg: 'rightLowerLeg',
  rightFoot: 'rightFoot',
  rightToes: 'rightToes',
} as const;

export type HumanoidBoneName = (typeof HUMAN_BONE_NAMES)[keyof typeof HUMAN_BONE_NAMES];

/** Parent of every canonical bone; `null` marks the root (hips). */
export const HUMAN_BONE_PARENT: Readonly<Record<HumanoidBoneName, HumanoidBoneName | null>> = {
  hips: null,
  spine: HUMAN_BONE_NAMES.hips,
  chest: HUMAN_BONE_NAMES.spine,
  neck: HUMAN_BONE_NAMES.chest,
  head: HUMAN_BONE_NAMES.neck,
  jaw: HUMAN_BONE_NAMES.head,
  leftEye: HUMAN_BONE_NAMES.head,
  rightEye: HUMAN_BONE_NAMES.head,
  leftShoulder: HUMAN_BONE_NAMES.chest,
  rightShoulder: HUMAN_BONE_NAMES.chest,
  leftUpperArm: HUMAN_BONE_NAMES.leftShoulder,
  leftLowerArm: HUMAN_BONE_NAMES.leftUpperArm,
  leftHand: HUMAN_BONE_NAMES.leftLowerArm,
  rightUpperArm: HUMAN_BONE_NAMES.rightShoulder,
  rightLowerArm: HUMAN_BONE_NAMES.rightUpperArm,
  rightHand: HUMAN_BONE_NAMES.rightLowerArm,
  leftUpperLeg: HUMAN_BONE_NAMES.hips,
  leftLowerLeg: HUMAN_BONE_NAMES.leftUpperLeg,
  leftFoot: HUMAN_BONE_NAMES.leftLowerLeg,
  leftToes: HUMAN_BONE_NAMES.leftFoot,
  rightUpperLeg: HUMAN_BONE_NAMES.hips,
  rightLowerLeg: HUMAN_BONE_NAMES.rightUpperLeg,
  rightFoot: HUMAN_BONE_NAMES.rightLowerLeg,
  rightToes: HUMAN_BONE_NAMES.rightFoot,
};

/** Every canonical bone name in a stable, parent-before-child order. */
export const HUMAN_BONE_NAMES_ARRAY: readonly HumanoidBoneName[] = Object.values(HUMAN_BONE_NAMES);
