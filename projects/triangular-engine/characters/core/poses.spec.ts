import { blendPoses, SIT_POSE } from './poses';
import type { RigPose } from './forward-kinematics';

describe('poses', () => {
  it('blends fully to the target pose at amount 1', () => {
    expect(blendPoses({}, SIT_POSE, 1)).toEqual(SIT_POSE);
  });

  it('blends to an all-zero pose at amount 0', () => {
    const result = blendPoses({}, SIT_POSE, 0) as Record<string, readonly number[]>;
    for (const rotation of Object.values(result)) {
      expect(rotation[0]).toBe(0);
      expect(rotation[1]).toBe(0);
      expect(rotation[2]).toBe(0);
    }
  });

  it('interpolates between two poses at the midpoint', () => {
    const a: RigPose = { head: [1, 0, 0] };
    const b: RigPose = { head: [3, 0, 0] };
    const result = blendPoses(a, b, 0.25);
    expect(result.head![0]).toBeCloseTo(1.5, 6);
  });

  it('clamps the blend amount to the unit range', () => {
    const a: RigPose = { head: [0, 0, 0] };
    const b: RigPose = { head: [2, 2, 2] };
    expect(blendPoses(a, b, 1.5).head![0]).toBeCloseTo(2, 6);
    expect(blendPoses(a, b, -0.5).head![0]).toBeCloseTo(0, 6);
  });
});
