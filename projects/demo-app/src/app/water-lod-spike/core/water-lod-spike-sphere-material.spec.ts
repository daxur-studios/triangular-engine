import { SPHERE_WATER_AMBIENT, SPHERE_WATER_TERMINATOR, sphereWaterDayFactor } from './water-lod-spike-sphere-material';

describe('water-lod-spike sphere water day factor', () => {
  it('is 1 by day and 0 at night, across the terminator range', () => {
    expect(sphereWaterDayFactor(1)).toBe(1);
    expect(sphereWaterDayFactor(SPHERE_WATER_TERMINATOR[1])).toBe(1);
    expect(sphereWaterDayFactor(SPHERE_WATER_TERMINATOR[0])).toBe(0);
    expect(sphereWaterDayFactor(-1)).toBe(0);
  });

  it('is half at the middle of the range and rises monotonically through it', () => {
    const [low, high] = SPHERE_WATER_TERMINATOR;
    expect(sphereWaterDayFactor((low + high) / 2)).toBeCloseTo(0.5, 12);
    let last = -1;
    for (let i = 0; i <= 20; i++) {
      const value = sphereWaterDayFactor(low + ((high - low) * i) / 20);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it('keeps a small ambient floor of the day light', () => {
    expect(SPHERE_WATER_AMBIENT).toBeGreaterThan(0);
    expect(SPHERE_WATER_AMBIENT).toBeLessThan(0.2);
  });
});
