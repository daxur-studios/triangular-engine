import { computeLookAtAngles, applyLookAt } from './look-at';
import { HUMAN_BONE_NAMES } from './humanoid-bones';

describe('computeLookAtAngles', () => {
  const from = { x: 0, y: 1.5, z: 0 };

  it('is zero when the target is directly ahead', () => {
    const angles = computeLookAtAngles(from, { x: 0, y: 1.5, z: 5 });
    expect(angles.yaw).toBeCloseTo(0, 6);
    expect(angles.pitch).toBeCloseTo(0, 6);
  });

  it('yaws toward the right side', () => {
    const angles = computeLookAtAngles(from, { x: 5, y: 1.5, z: 0 });
    expect(angles.yaw).toBeCloseTo(Math.PI / 2, 6);
  });

  it('pitches upward for an elevated target', () => {
    const angles = computeLookAtAngles(from, { x: 0, y: 2.5, z: 0.001 });
    expect(angles.pitch).toBeLessThan(0);
  });
});

describe('applyLookAt', () => {
  it('drives the head harder than the chest', () => {
    const pose = applyLookAt({}, { yaw: 0.8, pitch: -0.4 });
    expect(pose.head![1]).toBeCloseTo(0.8, 6);
    expect(pose.neck![1]).toBeCloseTo(0.8 * 0.55, 6);
    expect(pose.chest![1]).toBeCloseTo(0.8 * 0.3, 6);
    expect(pose.spine![1]).toBeCloseTo(0.8 * 0.15, 6);
  });

  it('preserves unrelated bones from the base pose', () => {
    const base = { leftUpperLeg: [0.3, 0, 0] as const };
    const pose = applyLookAt(base, { yaw: 0.2, pitch: 0 });
    expect(pose.leftUpperLeg![0]).toBeCloseTo(0.3, 6);
    expect(pose[HUMAN_BONE_NAMES.head]).toBeDefined();
  });

  it('clamps yaw to the head range instead of spinning', () => {
    const pose = applyLookAt({}, { yaw: Math.PI, pitch: 0 });
    expect(pose.head![1]).toBeCloseTo(1.4, 6);
  });

  it('clamps pitch within up and down limits', () => {
    const lookingUp = applyLookAt({}, { yaw: 0, pitch: -Math.PI / 2 });
    const lookingDown = applyLookAt({}, { yaw: 0, pitch: Math.PI / 2 });
    expect(lookingUp.head![0]).toBeCloseTo(-0.9, 6);
    expect(lookingDown.head![0]).toBeCloseTo(0.7, 6);
  });
});
