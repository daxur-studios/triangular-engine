import { Bone, Euler, Quaternion, Skeleton, Vector3 } from 'three';
import { createHumanoidRig, HUMAN_BONE_NAMES, solveForwardKinematics } from 'triangular-engine/characters';
import { HumanoidRigVisualization } from './bones-visualization';
import { applyPoseToSkeleton } from './pose-to-skeleton';

describe('applyPoseToSkeleton', () => {
  it('matches forward kinematics on the built-in skeleton', () => {
    const rig = createHumanoidRig();
    const view = new HumanoidRigVisualization(rig);
    const pose = { head: [0.3, -0.2, 0], leftUpperArm: [0.4, 0, 0.2] } as const;

    applyPoseToSkeleton(pose, view.skeleton);
    view.group.updateMatrixWorld(true);

    const expected = solveForwardKinematics(rig, pose);
    const position = new Vector3();
    rig.bones.forEach((bone, index) => {
      view.bones[index].getWorldPosition(position);
      expect(position.x).toBeCloseTo(expected.positions[index].x, 5);
      expect(position.y).toBeCloseTo(expected.positions[index].y, 5);
      expect(position.z).toBeCloseTo(expected.positions[index].z, 5);
    });

    view.dispose();
  });

  it('resets absent bones to rest while applying posed bones', () => {
    const rig = createHumanoidRig();
    const view = new HumanoidRigVisualization(rig);

    applyPoseToSkeleton({ head: [0, 0.5, 0] }, view.skeleton);

    const head = view.bones[rig.bones.findIndex((b) => b.name === HUMAN_BONE_NAMES.head)];
    const arm = view.bones[rig.bones.findIndex((b) => b.name === HUMAN_BONE_NAMES.leftUpperArm)];
    expect(head.quaternion.y).toBeGreaterThan(0);
    expect(arm.quaternion.x).toBeCloseTo(0, 6);
    expect(arm.quaternion.y).toBeCloseTo(0, 6);
    expect(arm.quaternion.z).toBeCloseTo(0, 6);
    expect(arm.quaternion.w).toBeCloseTo(1, 6);

    view.dispose();
  });

  it('retargets through a bone-name mapper and skips unmatched bones', () => {
    const head = new Bone();
    head.name = 'customHead';
    const skeleton = new Skeleton([head]);

    applyPoseToSkeleton(
      { head: [0.2, 0, 0] },
      skeleton,
      { boneNameMapper: (name) => (name === HUMAN_BONE_NAMES.head ? 'customHead' : undefined) },
    );

    const expected = new Quaternion().setFromEuler(new Euler(0.2, 0, 0, 'XYZ'));
    expect(head.quaternion.x).toBeCloseTo(expected.x, 6);
    expect(head.quaternion.y).toBeCloseTo(expected.y, 6);
    expect(head.quaternion.z).toBeCloseTo(expected.z, 6);
    expect(head.quaternion.w).toBeCloseTo(expected.w, 6);
  });
});
