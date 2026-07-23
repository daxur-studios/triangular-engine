import {
  waterDetailCascadeWeights,
  waterDistanceRoughness,
  waterGlintThreshold,
} from './water-farfield-glsl';

describe('water far-field math', () => {
  it('keeps cascade weights non-negative and partitioned to unity', () => {
    for (const distance of [0, 1, 4, 8, 64, 512, 1_000_000]) {
      const weights = waterDetailCascadeWeights(distance, 8, 3);
      expect(weights.every((weight) => weight >= 0 && weight <= 1)).toBeTrue();
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
    }
  });

  it('supports one and two active cascades', () => {
    expect(waterDetailCascadeWeights(64, 8, 1)).toEqual([1, 0, 0]);
    expect(waterDetailCascadeWeights(64, 8, 2)[2]).toBe(0);
  });

  it('increases roughness and lowers the glint threshold with distance', () => {
    expect(waterDistanceRoughness(100, 1000, 0.8)).toBeLessThan(
      waterDistanceRoughness(900, 1000, 0.8),
    );
    expect(waterGlintThreshold(100, 1000)).toBeGreaterThan(
      waterGlintThreshold(900, 1000),
    );
  });
});
