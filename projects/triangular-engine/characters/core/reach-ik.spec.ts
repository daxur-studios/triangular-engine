import { createHumanoidRig } from './character-rig';
import { HUMAN_BONE_NAMES } from './humanoid-bones';
import { solveForwardKinematics } from './forward-kinematics';
import { solveTwoBoneIk } from './reach-ik';
import { characterVectorDistance } from './character-vector';

describe('solveTwoBoneIk', () => {
  const rig = createHumanoidRig();
  const { leftUpperArm, leftLowerArm, leftHand } = HUMAN_BONE_NAMES;
  const upperArm = rig.boneByName.get(leftUpperArm)!;
  const lowerArm = rig.boneByName.get(leftLowerArm)!;

  it('places the end effector on an in-range target', () => {
    const target = {
      x: upperArm.restPosition.x + 0.2,
      y: upperArm.restPosition.y - 0.3,
      z: 0.25,
    };
    const result = solveTwoBoneIk(rig, {}, leftUpperArm, leftLowerArm, leftHand, target);
    const hand = solveForwardKinematics(rig, result.pose).positionByName.get(leftHand)!;
    expect(hand.x).toBeCloseTo(target.x, 5);
    expect(hand.y).toBeCloseTo(target.y, 5);
    expect(hand.z).toBeCloseTo(target.z, 5);
    expect(result.reached).toBe(true);
  });

  it('clamps targets beyond full extension and reports unreached', () => {
    const target = { x: upperArm.restPosition.x + 5, y: upperArm.restPosition.y, z: 0 };
    const result = solveTwoBoneIk(rig, {}, leftUpperArm, leftLowerArm, leftHand, target);
    const hand = solveForwardKinematics(rig, result.pose).positionByName.get(leftHand)!;
    expect(characterVectorDistance(hand, upperArm.restPosition)).toBeCloseTo(
      upperArm.length + lowerArm.length,
      5,
    );
    expect(result.reached).toBe(false);
  });

  it('folds the chain for targets inside the folded arm', () => {
    const target = { x: upperArm.restPosition.x, y: upperArm.restPosition.y + 0.01, z: 0 };
    const result = solveTwoBoneIk(rig, {}, leftUpperArm, leftLowerArm, leftHand, target);
    expect(result.reached).toBe(false);
    expect(characterVectorDistance(result.end, upperArm.restPosition)).toBeCloseTo(
      Math.abs(upperArm.length - lowerArm.length),
      5,
    );
  });

  it('keeps the elbow at the exact segment lengths', () => {
    const target = { x: upperArm.restPosition.x, y: upperArm.restPosition.y - 0.2, z: 0.4 };
    const result = solveTwoBoneIk(rig, {}, leftUpperArm, leftLowerArm, leftHand, target);
    expect(characterVectorDistance(result.elbow, upperArm.restPosition)).toBeCloseTo(
      upperArm.length,
      5,
    );
    expect(characterVectorDistance(result.elbow, result.end)).toBeCloseTo(lowerArm.length, 5);
  });

  it('preserves unrelated bones from the base pose', () => {
    const base = { leftUpperLeg: [0.4, 0, 0] as const };
    const target = { x: upperArm.restPosition.x, y: upperArm.restPosition.y - 0.3, z: 0.2 };
    const result = solveTwoBoneIk(rig, base, leftUpperArm, leftLowerArm, leftHand, target);
    expect(result.pose.leftUpperLeg![0]).toBeCloseTo(0.4, 6);
  });
});
