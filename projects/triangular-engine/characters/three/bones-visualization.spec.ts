import { Bone, Group, SkeletonHelper, Vector3 } from 'three';
import { createHumanoidRig, solveForwardKinematics } from 'triangular-engine/characters';
import { HumanoidRigVisualization } from './bones-visualization';

describe('HumanoidRigVisualization', () => {
  it('reproduces the rig rest pose in the bone tree', () => {
    const rig = createHumanoidRig();
    const view = new HumanoidRigVisualization(rig);
    view.group.updateMatrixWorld(true);

    const position = new Vector3();
    rig.bones.forEach((bone, index) => {
      view.bones[index].getWorldPosition(position);
      expect(position.x).toBeCloseTo(bone.restPosition.x, 6);
      expect(position.y).toBeCloseTo(bone.restPosition.y, 6);
      expect(position.z).toBeCloseTo(bone.restPosition.z, 6);
    });

    view.dispose();
  });

  it('matches forward kinematics after applying a pose', () => {
    const rig = createHumanoidRig();
    const view = new HumanoidRigVisualization(rig);
    const pose = { head: [0.3, -0.2, 0], leftUpperArm: [0.4, 0, 0.2] } as const;
    view.setPose(pose);
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

  it('keeps helper lines aligned with bones when the group is transformed', () => {
    const rig = createHumanoidRig();
    const view = new HumanoidRigVisualization(rig);

    const parent = new Group();
    parent.position.set(1.5, 0.25, -1.5);
    parent.rotation.y = 0.7;
    parent.add(view.group);
    parent.updateMatrixWorld(true);

    const helper = view.group.children.find((child) => child.type === 'SkeletonHelper') as SkeletonHelper;
    const position = helper.geometry.getAttribute('position');

    const childVertex = new Vector3();
    const parentVertex = new Vector3();
    const expected = new Vector3();
    let segment = 0;

    for (const bone of helper.bones) {
      if (bone.parent && (bone.parent as Bone).isBone) {
        childVertex.fromBufferAttribute(position, segment * 2).applyMatrix4(helper.matrixWorld);
        bone.getWorldPosition(expected);
        expect(childVertex.distanceTo(expected)).toBeLessThan(1e-5);

        parentVertex.fromBufferAttribute(position, segment * 2 + 1).applyMatrix4(helper.matrixWorld);
        bone.parent.getWorldPosition(expected);
        expect(parentVertex.distanceTo(expected)).toBeLessThan(1e-5);

        segment++;
      }
    }

    view.dispose();
  });
});
