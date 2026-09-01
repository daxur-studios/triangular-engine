import { createHumanoidRig, DEFAULT_HUMANOID_PROPORTIONS } from './character-rig';
import { HUMAN_BONE_NAMES } from './humanoid-bones';

describe('createHumanoidRig', () => {
  const rig = createHumanoidRig();

  it('emits every canonical bone in parent-before-child order', () => {
    const names = rig.bones.map((bone) => bone.name);
    expect(new Set(names).size).toBe(names.length);
    expect(rig.bones.length).toBe(24);
    for (const bone of rig.bones) {
      if (bone.parent === null) continue;
      expect(names.indexOf(bone.parent)).toBeLessThan(names.indexOf(bone.name));
    }
  });

  it('stands with feet at ground and head above the hips', () => {
    const hips = rig.boneByName.get(HUMAN_BONE_NAMES.hips)!;
    const chest = rig.boneByName.get(HUMAN_BONE_NAMES.chest)!;
    const head = rig.boneByName.get(HUMAN_BONE_NAMES.head)!;
    const leftFoot = rig.boneByName.get(HUMAN_BONE_NAMES.leftFoot)!;
    expect(leftFoot.restPosition.y).toBeCloseTo(0, 6);
    expect(hips.restPosition.y).toBeGreaterThan(0);
    expect(chest.restPosition.y).toBeGreaterThan(hips.restPosition.y);
    expect(head.restPosition.y).toBeGreaterThan(chest.restPosition.y);
  });

  it('measures limb segment lengths ready for two-bone IK', () => {
    const upperArm = rig.boneByName.get(HUMAN_BONE_NAMES.leftUpperArm)!;
    const lowerArm = rig.boneByName.get(HUMAN_BONE_NAMES.leftLowerArm)!;
    const upperLeg = rig.boneByName.get(HUMAN_BONE_NAMES.leftUpperLeg)!;
    const lowerLeg = rig.boneByName.get(HUMAN_BONE_NAMES.leftLowerLeg)!;
    expect(upperArm.length).toBeCloseTo(DEFAULT_HUMANOID_PROPORTIONS.upperArmLength, 6);
    expect(lowerArm.length).toBeCloseTo(DEFAULT_HUMANOID_PROPORTIONS.lowerArmLength, 6);
    expect(upperLeg.length).toBeCloseTo(DEFAULT_HUMANOID_PROPORTIONS.upperLegLength, 6);
    expect(lowerLeg.length).toBeCloseTo(DEFAULT_HUMANOID_PROPORTIONS.lowerLegLength, 6);
  });

  it('mirrors left and right limbs across the sagittal plane', () => {
    const leftHand = rig.boneByName.get(HUMAN_BONE_NAMES.leftHand)!;
    const rightHand = rig.boneByName.get(HUMAN_BONE_NAMES.rightHand)!;
    const leftFoot = rig.boneByName.get(HUMAN_BONE_NAMES.leftFoot)!;
    const rightFoot = rig.boneByName.get(HUMAN_BONE_NAMES.rightFoot)!;
    expect(leftHand.restPosition.y).toBeCloseTo(rightHand.restPosition.y, 6);
    expect(leftHand.restPosition.x).toBeCloseTo(-rightHand.restPosition.x, 6);
    expect(leftFoot.restPosition.y).toBeCloseTo(rightFoot.restPosition.y, 6);
    expect(leftFoot.restPosition.x).toBeCloseTo(-rightFoot.restPosition.x, 6);
  });
});
