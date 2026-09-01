import {
  HUMAN_BONE_NAMES,
  HUMAN_BONE_PARENT,
  type HumanoidBoneName,
} from './humanoid-bones';
import {
  characterVector3,
  characterVectorDistance,
  normalizeCharacterVector3,
  type CharacterVector3,
} from './character-vector';

/** Body dimensions (metres) that drive the procedural humanoid rig. */
export interface HumanoidProportions {
  readonly upperLegLength: number;
  readonly lowerLegLength: number;
  readonly torsoLength: number;
  readonly chestToNeck: number;
  readonly neckLength: number;
  readonly headRadius: number;
  readonly shoulderWidth: number;
  readonly upperArmLength: number;
  readonly lowerArmLength: number;
  readonly handLength: number;
  /** How far the relaxed (A-pose) arm hangs outward from the body. */
  readonly armSpread: number;
  readonly footLength: number;
  readonly hipWidth: number;
}

export const DEFAULT_HUMANOID_PROPORTIONS: HumanoidProportions = {
  upperLegLength: 0.42,
  lowerLegLength: 0.38,
  torsoLength: 0.45,
  chestToNeck: 0.2,
  neckLength: 0.12,
  headRadius: 0.1,
  shoulderWidth: 0.4,
  upperArmLength: 0.3,
  lowerArmLength: 0.28,
  handLength: 0.16,
  armSpread: 0.14,
  footLength: 0.24,
  hipWidth: 0.14,
};

export interface CharacterBone {
  readonly name: HumanoidBoneName;
  readonly parent: HumanoidBoneName | null;
  /** World-space joint position in the rest pose, facing +Z. */
  readonly restPosition: CharacterVector3;
  /** Segment length toward the bone's tip; ready for two-bone IK. */
  readonly length: number;
}

export interface HumanoidRig {
  readonly bones: readonly CharacterBone[];
  readonly boneByName: ReadonlyMap<HumanoidBoneName, CharacterBone>;
}

const RIG_BONE_ORDER: readonly HumanoidBoneName[] = [
  HUMAN_BONE_NAMES.hips,
  HUMAN_BONE_NAMES.spine,
  HUMAN_BONE_NAMES.chest,
  HUMAN_BONE_NAMES.neck,
  HUMAN_BONE_NAMES.head,
  HUMAN_BONE_NAMES.jaw,
  HUMAN_BONE_NAMES.leftEye,
  HUMAN_BONE_NAMES.rightEye,
  HUMAN_BONE_NAMES.leftShoulder,
  HUMAN_BONE_NAMES.leftUpperArm,
  HUMAN_BONE_NAMES.leftLowerArm,
  HUMAN_BONE_NAMES.leftHand,
  HUMAN_BONE_NAMES.rightShoulder,
  HUMAN_BONE_NAMES.rightUpperArm,
  HUMAN_BONE_NAMES.rightLowerArm,
  HUMAN_BONE_NAMES.rightHand,
  HUMAN_BONE_NAMES.leftUpperLeg,
  HUMAN_BONE_NAMES.leftLowerLeg,
  HUMAN_BONE_NAMES.leftFoot,
  HUMAN_BONE_NAMES.leftToes,
  HUMAN_BONE_NAMES.rightUpperLeg,
  HUMAN_BONE_NAMES.rightLowerLeg,
  HUMAN_BONE_NAMES.rightFoot,
  HUMAN_BONE_NAMES.rightToes,
];

const CHAIN_CHILD: Partial<Record<HumanoidBoneName, HumanoidBoneName>> = {
  hips: HUMAN_BONE_NAMES.spine,
  spine: HUMAN_BONE_NAMES.chest,
  chest: HUMAN_BONE_NAMES.neck,
  neck: HUMAN_BONE_NAMES.head,
  leftShoulder: HUMAN_BONE_NAMES.leftUpperArm,
  leftUpperArm: HUMAN_BONE_NAMES.leftLowerArm,
  leftLowerArm: HUMAN_BONE_NAMES.leftHand,
  rightShoulder: HUMAN_BONE_NAMES.rightUpperArm,
  rightUpperArm: HUMAN_BONE_NAMES.rightLowerArm,
  rightLowerArm: HUMAN_BONE_NAMES.rightHand,
  leftUpperLeg: HUMAN_BONE_NAMES.leftLowerLeg,
  leftLowerLeg: HUMAN_BONE_NAMES.leftFoot,
  leftFoot: HUMAN_BONE_NAMES.leftToes,
  rightUpperLeg: HUMAN_BONE_NAMES.rightLowerLeg,
  rightLowerLeg: HUMAN_BONE_NAMES.rightFoot,
  rightFoot: HUMAN_BONE_NAMES.rightToes,
};

function terminalLength(name: HumanoidBoneName, proportions: HumanoidProportions): number {
  switch (name) {
    case HUMAN_BONE_NAMES.head:
      return proportions.headRadius * 2;
    case HUMAN_BONE_NAMES.jaw:
      return proportions.headRadius * 0.35;
    case HUMAN_BONE_NAMES.leftEye:
    case HUMAN_BONE_NAMES.rightEye:
      return proportions.headRadius * 0.2;
    case HUMAN_BONE_NAMES.leftHand:
    case HUMAN_BONE_NAMES.rightHand:
      return proportions.handLength;
    case HUMAN_BONE_NAMES.leftToes:
    case HUMAN_BONE_NAMES.rightToes:
      return proportions.footLength * 0.4;
    default:
      return 0;
  }
}

function computeRestPositions(proportions: HumanoidProportions): Map<HumanoidBoneName, CharacterVector3> {
  const positions = new Map<HumanoidBoneName, CharacterVector3>();
  const hipY = proportions.upperLegLength + proportions.lowerLegLength;
  const halfShoulder = proportions.shoulderWidth / 2;
  const halfHip = proportions.hipWidth / 2;

  const upperArmLeft = normalizeCharacterVector3(characterVector3(-proportions.armSpread, -1, 0));
  const lowerArmLeft = normalizeCharacterVector3(characterVector3(-proportions.armSpread * 0.6, -1, 0.35));
  const upperArmRight = normalizeCharacterVector3(characterVector3(proportions.armSpread, -1, 0));
  const lowerArmRight = normalizeCharacterVector3(characterVector3(proportions.armSpread * 0.6, -1, 0.35));

  positions.set(HUMAN_BONE_NAMES.hips, characterVector3(0, hipY, 0));
  positions.set(HUMAN_BONE_NAMES.spine, characterVector3(0, hipY + proportions.torsoLength * 0.5, 0));
  positions.set(HUMAN_BONE_NAMES.chest, characterVector3(0, hipY + proportions.torsoLength, 0));
  positions.set(
    HUMAN_BONE_NAMES.neck,
    characterVector3(0, hipY + proportions.torsoLength + proportions.chestToNeck, 0),
  );

  const headY =
    hipY + proportions.torsoLength + proportions.chestToNeck + proportions.neckLength + proportions.headRadius;
  positions.set(HUMAN_BONE_NAMES.head, characterVector3(0, headY, 0));
  positions.set(
    HUMAN_BONE_NAMES.jaw,
    characterVector3(0, headY - proportions.headRadius * 0.3, proportions.headRadius * 0.45),
  );
  positions.set(
    HUMAN_BONE_NAMES.leftEye,
    characterVector3(-proportions.headRadius * 0.4, headY + proportions.headRadius * 0.35, proportions.headRadius * 0.8),
  );
  positions.set(
    HUMAN_BONE_NAMES.rightEye,
    characterVector3(proportions.headRadius * 0.4, headY + proportions.headRadius * 0.35, proportions.headRadius * 0.8),
  );

  const shoulderY = hipY + proportions.torsoLength - 0.02;
  const leftUpperArm = characterVector3(-halfShoulder, shoulderY - 0.05, 0);
  const rightUpperArm = characterVector3(halfShoulder, shoulderY - 0.05, 0);
  positions.set(HUMAN_BONE_NAMES.leftShoulder, characterVector3(-halfShoulder, shoulderY, 0));
  positions.set(HUMAN_BONE_NAMES.rightShoulder, characterVector3(halfShoulder, shoulderY, 0));
  positions.set(HUMAN_BONE_NAMES.leftUpperArm, leftUpperArm);
  positions.set(HUMAN_BONE_NAMES.rightUpperArm, rightUpperArm);

  const leftLowerArm = characterVector3(
    leftUpperArm.x + upperArmLeft.x * proportions.upperArmLength,
    leftUpperArm.y + upperArmLeft.y * proportions.upperArmLength,
    leftUpperArm.z + upperArmLeft.z * proportions.upperArmLength,
  );
  const rightLowerArm = characterVector3(
    rightUpperArm.x + upperArmRight.x * proportions.upperArmLength,
    rightUpperArm.y + upperArmRight.y * proportions.upperArmLength,
    rightUpperArm.z + upperArmRight.z * proportions.upperArmLength,
  );
  positions.set(HUMAN_BONE_NAMES.leftLowerArm, leftLowerArm);
  positions.set(HUMAN_BONE_NAMES.rightLowerArm, rightLowerArm);

  positions.set(
    HUMAN_BONE_NAMES.leftHand,
    characterVector3(
      leftLowerArm.x + lowerArmLeft.x * proportions.lowerArmLength,
      leftLowerArm.y + lowerArmLeft.y * proportions.lowerArmLength,
      leftLowerArm.z + lowerArmLeft.z * proportions.lowerArmLength,
    ),
  );
  positions.set(
    HUMAN_BONE_NAMES.rightHand,
    characterVector3(
      rightLowerArm.x + lowerArmRight.x * proportions.lowerArmLength,
      rightLowerArm.y + lowerArmRight.y * proportions.lowerArmLength,
      rightLowerArm.z + lowerArmRight.z * proportions.lowerArmLength,
    ),
  );

  positions.set(HUMAN_BONE_NAMES.leftUpperLeg, characterVector3(-halfHip, hipY, 0));
  positions.set(HUMAN_BONE_NAMES.rightUpperLeg, characterVector3(halfHip, hipY, 0));
  positions.set(
    HUMAN_BONE_NAMES.leftLowerLeg,
    characterVector3(-halfHip, hipY - proportions.upperLegLength, 0),
  );
  positions.set(
    HUMAN_BONE_NAMES.rightLowerLeg,
    characterVector3(halfHip, hipY - proportions.upperLegLength, 0),
  );
  positions.set(
    HUMAN_BONE_NAMES.leftFoot,
    characterVector3(-halfHip, hipY - proportions.upperLegLength - proportions.lowerLegLength, 0),
  );
  positions.set(
    HUMAN_BONE_NAMES.rightFoot,
    characterVector3(halfHip, hipY - proportions.upperLegLength - proportions.lowerLegLength, 0),
  );
  positions.set(
    HUMAN_BONE_NAMES.leftToes,
    characterVector3(-halfHip, hipY - proportions.upperLegLength - proportions.lowerLegLength, proportions.footLength),
  );
  positions.set(
    HUMAN_BONE_NAMES.rightToes,
    characterVector3(halfHip, hipY - proportions.upperLegLength - proportions.lowerLegLength, proportions.footLength),
  );

  return positions;
}

export function createHumanoidRig(proportions: HumanoidProportions = DEFAULT_HUMANOID_PROPORTIONS): HumanoidRig {
  const positions = computeRestPositions(proportions);
  const bones: CharacterBone[] = [];
  const boneByName = new Map<HumanoidBoneName, CharacterBone>();

  for (const name of RIG_BONE_ORDER) {
    const restPosition = positions.get(name)!;
    const child = CHAIN_CHILD[name];
    const length = child
      ? characterVectorDistance(positions.get(child)!, restPosition)
      : terminalLength(name, proportions);
    const bone: CharacterBone = { name, parent: HUMAN_BONE_PARENT[name], restPosition, length };
    bones.push(bone);
    boneByName.set(name, bone);
  }

  return { bones, boneByName };
}
