import { sampleLocomotion } from './locomotion';

describe('sampleLocomotion', () => {
  it('returns a static pose with no bounce when idle', () => {
    const sample = sampleLocomotion('idle', 3.7);
    expect(sample.bounce).toBe(0);
    expect(sample.phase).toBe(0);
    expect(Object.keys(sample.pose).length).toBe(0);
  });

  it('is deterministic for a fixed time', () => {
    expect(sampleLocomotion('walk', 1.234)).toEqual(sampleLocomotion('walk', 1.234));
  });

  it('swings the legs in anti-phase', () => {
    const sample = sampleLocomotion('walk', 0.3);
    expect(sample.pose.leftUpperLeg![0]).toBeCloseTo(-sample.pose.rightUpperLeg![0], 6);
  });

  it('reaches the peak forward leg swing at a quarter stride', () => {
    const walk = sampleLocomotion('walk', 1 / (4 * 1.6));
    const run = sampleLocomotion('run', 1 / (4 * 2.6));
    expect(walk.pose.leftUpperLeg![0]).toBeCloseTo(0.55, 6);
    expect(run.pose.leftUpperLeg![0]).toBeCloseTo(0.95, 6);
  });

  it('uses a larger swing amplitude when running than walking', () => {
    const walk = sampleLocomotion('walk', 1 / (4 * 1.6));
    const run = sampleLocomotion('run', 1 / (4 * 2.6));
    expect(Math.abs(run.pose.leftUpperLeg![0])).toBeGreaterThan(Math.abs(walk.pose.leftUpperLeg![0]));
  });
});
