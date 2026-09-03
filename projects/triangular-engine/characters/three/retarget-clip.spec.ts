import { AnimationClip, Bone, Euler, Quaternion, QuaternionKeyframeTrack, Skeleton } from 'three';
import { createHumanoidRig } from 'triangular-engine/characters';
import { HumanoidRigVisualization } from './bones-visualization';
import { MIXAMO_BONE_MAP, retargetMixamoClip } from './retarget-clip';

function quaternionTrackValues(clip: AnimationClip, boneName: string): Float32Array | null {
  const track = clip.tracks.find((candidate) => candidate.name.includes(boneName));
  if (!track) return null;
  return track.values as Float32Array;
}

describe('retargetMixamoClip', () => {
  it('maps every mapped canonical bone to a distinct Mixamo name', () => {
    const values = Object.values(MIXAMO_BONE_MAP);
    expect(new Set(values).size).toBe(values.length);
    expect(MIXAMO_BONE_MAP.hips).toBe('Hips');
    expect(MIXAMO_BONE_MAP.leftUpperArm).toBe('RightArm');
    expect(MIXAMO_BONE_MAP.rightUpperArm).toBe('LeftArm');
  });

  it('swaps every left/right pair to undo the Mixamo mirror', () => {
    expect(MIXAMO_BONE_MAP.leftUpperLeg).toBe('RightUpLeg');
    expect(MIXAMO_BONE_MAP.rightUpperLeg).toBe('LeftUpLeg');
    expect(MIXAMO_BONE_MAP.leftLowerArm).toBe('RightForeArm');
    expect(MIXAMO_BONE_MAP.rightLowerArm).toBe('LeftForeArm');
    expect(MIXAMO_BONE_MAP.leftFoot).toBe('RightFoot');
    expect(MIXAMO_BONE_MAP.rightFoot).toBe('LeftFoot');
  });

  it('reconciles a T-pose source into the A-pose target rest', () => {
    const visualization = new HumanoidRigVisualization(createHumanoidRig());

    const hips = new Bone();
    hips.name = 'mixamorigHips';
    const arm = new Bone();
    arm.name = 'mixamorigRightArm';
    hips.add(arm);

    const tPose = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 2, 'XYZ'));
    arm.quaternion.copy(tPose);
    hips.updateMatrixWorld(true);

    const sourceSkeleton = new Skeleton([hips, arm]);

    const rest = arm.quaternion.toArray();
    const clip = new AnimationClip('rest', 1, [
      new QuaternionKeyframeTrack('mixamorigRightArm.quaternion', [0, 1], [...rest, ...rest]),
    ]);

    const retargeted = retargetMixamoClip(visualization.skeleton, sourceSkeleton, clip);

    const values = quaternionTrackValues(retargeted, 'leftUpperArm');
    expect(values).not.toBeNull();
    expect(values![0]).toBeCloseTo(0, 5);
    expect(values![1]).toBeCloseTo(0, 5);
    expect(values![2]).toBeCloseTo(0, 5);
    expect(values![3]).toBeCloseTo(1, 5);

    visualization.dispose();
  });

  it('resolves both bare and mixamorig-prefixed source names', () => {
    const visualization = new HumanoidRigVisualization(createHumanoidRig());

    const hips = new Bone();
    hips.name = 'Hips';
    const arm = new Bone();
    arm.name = 'LeftArm';
    hips.add(arm);
    hips.updateMatrixWorld(true);

    const sourceSkeleton = new Skeleton([hips, arm]);
    const rest = arm.quaternion.toArray();
    const clip = new AnimationClip('rest', 1, [
      new QuaternionKeyframeTrack('LeftArm.quaternion', [0, 1], [...rest, ...rest]),
    ]);

    const retargeted = retargetMixamoClip(visualization.skeleton, sourceSkeleton, clip);

    expect(quaternionTrackValues(retargeted, 'rightUpperArm')).not.toBeNull();

    visualization.dispose();
  });

  it('leaves unmapped bones without a track', () => {
    const visualization = new HumanoidRigVisualization(createHumanoidRig());
    const hips = new Bone();
    hips.name = 'mixamorigHips';
    hips.updateMatrixWorld(true);
    const sourceSkeleton = new Skeleton([hips]);

    const clip = new AnimationClip('empty', 1, []);
    const retargeted = retargetMixamoClip(visualization.skeleton, sourceSkeleton, clip);

    expect(retargeted.tracks.some((track) => track.name.includes('jaw'))).toBe(false);
    expect(retargeted.tracks.some((track) => track.name.includes('leftEye'))).toBe(false);

    visualization.dispose();
  });
});
