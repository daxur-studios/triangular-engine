import { createHumanoidRig } from './character-rig';
import { HUMAN_BONE_NAMES } from './humanoid-bones';
import { solveForwardKinematics } from './forward-kinematics';

describe('solveForwardKinematics', () => {
  const rig = createHumanoidRig();

  it('reproduces the rest pose exactly for the identity pose', () => {
    const solved = solveForwardKinematics(rig);
    rig.bones.forEach((bone, index) => {
      const position = solved.positions[index];
      expect(position.x).toBeCloseTo(bone.restPosition.x, 6);
      expect(position.y).toBeCloseTo(bone.restPosition.y, 6);
      expect(position.z).toBeCloseTo(bone.restPosition.z, 6);
    });
  });

  it('rotating the hips root yaws the whole body about the vertical axis', () => {
    const solved = solveForwardKinematics(rig, { hips: [0, Math.PI, 0] });
    const leftShoulder = solved.positionByName.get(HUMAN_BONE_NAMES.leftShoulder)!;
    const rightShoulder = rig.boneByName.get(HUMAN_BONE_NAMES.rightShoulder)!;
    expect(leftShoulder.x).toBeCloseTo(rightShoulder.restPosition.x, 6);
    expect(leftShoulder.y).toBeCloseTo(rightShoulder.restPosition.y, 6);
    expect(leftShoulder.z).toBeCloseTo(rightShoulder.restPosition.z, 6);
  });

  it('rotating the head moves its children but not its own joint', () => {
    const rest = solveForwardKinematics(rig);
    const solved = solveForwardKinematics(rig, { head: [0.5, 0.2, 0] });
    const headRest = rest.positionByName.get(HUMAN_BONE_NAMES.head)!;
    const head = solved.positionByName.get(HUMAN_BONE_NAMES.head)!;
    const jawRest = rest.positionByName.get(HUMAN_BONE_NAMES.jaw)!;
    const jaw = solved.positionByName.get(HUMAN_BONE_NAMES.jaw)!;
    expect(head.x).toBeCloseTo(headRest.x, 6);
    expect(head.y).toBeCloseTo(headRest.y, 6);
    expect(head.z).toBeCloseTo(headRest.z, 6);
    const moved = Math.abs(jaw.x - jawRest.x) + Math.abs(jaw.y - jawRest.y) + Math.abs(jaw.z - jawRest.z);
    expect(moved).toBeGreaterThan(1e-6);
  });

  it('returns one position per bone in rig order', () => {
    const solved = solveForwardKinematics(rig);
    expect(solved.positions.length).toBe(rig.bones.length);
    expect(solved.orientations.length).toBe(rig.bones.length);
  });
});
