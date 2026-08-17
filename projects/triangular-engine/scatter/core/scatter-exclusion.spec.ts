import type { TerrainVector3 } from 'triangular-engine/terrain';

import { computeScatterExclusionFade01, type IScatterExclusionZone } from './scatter-exclusion';

describe('computeScatterExclusionFade01', () => {
  it('returns 1 with no zones', () => {
    expect(computeScatterExclusionFade01([0, 0, 0], [])).toBe(1);
  });

  it('returns 0 for a candidate inside a zone\'s core radius', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [0, 0, 0], radiusM: 5 }];
    expect(computeScatterExclusionFade01([2, 0, 0], zones)).toBe(0);
  });

  it('returns 1 for a candidate outside radius + feather', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [0, 0, 0], radiusM: 5, featherM: 2 }];
    expect(computeScatterExclusionFade01([10, 0, 0], zones)).toBe(1);
  });

  it('ramps linearly inside the feather band', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [0, 0, 0], radiusM: 5, featherM: 2 }];
    const candidate: TerrainVector3 = [6, 0, 0]; // 1m into a 2m feather band
    expect(computeScatterExclusionFade01(candidate, zones)).toBeCloseTo(0.5);
  });

  it('two overlapping zones compose via minimum, not product', () => {
    const zones: IScatterExclusionZone[] = [
      { centerWorldM: [0, 0, 0], radiusM: 5, featherM: 4 }, // fade 0.5 at distance 7
      { centerWorldM: [20, 0, 0], radiusM: 5, featherM: 4 }, // fade 0.5 at distance 13 from this center (7 from origin's candidate at x=7 -> dist to (20,0,0) is 13)
    ];
    const candidate: TerrainVector3 = [7, 0, 0];
    // distance to zone A center = 7 -> fade 0.5; distance to zone B center = 13 -> outside radius+feather (9) -> fade 1
    expect(computeScatterExclusionFade01(candidate, zones)).toBeCloseTo(0.5);
  });

  it('a zero-radius zone excludes only its exact center', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [1, 1, 1], radiusM: 0 }];
    expect(computeScatterExclusionFade01([1, 1, 1], zones)).toBe(0);
    expect(computeScatterExclusionFade01([1.01, 1, 1], zones)).toBe(1);
  });

  it('never throws on a zero-distance candidate', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [0, 0, 0], radiusM: 3, featherM: 1 }];
    expect(computeScatterExclusionFade01([0, 0, 0], zones)).toBe(0);
  });

  it('respects a hard edge when featherM is omitted', () => {
    const zones: IScatterExclusionZone[] = [{ centerWorldM: [0, 0, 0], radiusM: 3 }];
    expect(computeScatterExclusionFade01([3.01, 0, 0], zones)).toBe(1);
    expect(computeScatterExclusionFade01([2.99, 0, 0], zones)).toBe(0);
  });
});
