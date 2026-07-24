import { computeScatterDistanceFade01 } from './scatter-distance-fade';

describe('computeScatterDistanceFade01', () => {
  it('is fully opaque before fadeStartM', () => {
    expect(computeScatterDistanceFade01(5, 20, 40)).toBe(1);
    expect(computeScatterDistanceFade01(20, 20, 40)).toBe(1);
  });

  it('is fully culled at or beyond fadeEndM', () => {
    expect(computeScatterDistanceFade01(40, 20, 40)).toBe(0);
    expect(computeScatterDistanceFade01(100, 20, 40)).toBe(0);
  });

  it('ramps linearly between fadeStartM and fadeEndM', () => {
    expect(computeScatterDistanceFade01(30, 20, 40)).toBeCloseTo(0.5, 5);
  });

  it('treats a degenerate (non-positive) band as a hard cutoff at fadeEndM', () => {
    expect(computeScatterDistanceFade01(10, 20, 20)).toBe(1);
    expect(computeScatterDistanceFade01(25, 20, 20)).toBe(0);
  });
});
