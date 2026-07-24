import { selectScatterLodTier } from './scatter-lod-selection';
import type { ScatterLodDefinition } from './scatter-species-definition';

describe('selectScatterLodTier', () => {
  const lods: ScatterLodDefinition[] = [
    { kind: 'mesh', maxDistanceM: 50, castShadow: true },
    { kind: 'billboard', maxDistanceM: 200, castShadow: false },
    { kind: 'impostor', maxDistanceM: 500, castShadow: false },
  ];

  it('returns tierIndex -1 for an empty lod list', () => {
    expect(selectScatterLodTier(10, [])).toEqual({
      tierIndex: -1,
      lod: undefined,
      blend01: 0,
    });
  });

  it('picks the nearest tier whose maxDistanceM covers the distance', () => {
    expect(selectScatterLodTier(10, lods).tierIndex).toBe(0);
    expect(selectScatterLodTier(120, lods).tierIndex).toBe(1);
    expect(selectScatterLodTier(300, lods).tierIndex).toBe(2);
  });

  it('treats the boundary distance as inclusive to the nearer tier', () => {
    expect(selectScatterLodTier(50, lods).tierIndex).toBe(0);
  });

  it('culls instances beyond the farthest tier', () => {
    const result = selectScatterLodTier(1000, lods);
    expect(result.tierIndex).toBe(-1);
    expect(result.lod).toBeUndefined();
  });

  it('ramps blend01 toward 1 inside the dither band before a boundary', () => {
    const farFromBoundary = selectScatterLodTier(10, lods, { ditherBandM: 10 });
    expect(farFromBoundary.blend01).toBe(0);

    const atBandStart = selectScatterLodTier(45, lods, { ditherBandM: 10 });
    expect(atBandStart.blend01).toBeCloseTo(0.5, 5);

    const atBoundary = selectScatterLodTier(50, lods, { ditherBandM: 10 });
    expect(atBoundary.blend01).toBeCloseTo(1, 5);
  });

  it('resists switching to a farther tier until past half the hysteresis band', () => {
    const justPastBoundary = selectScatterLodTier(52, lods, {
      previousTierIndex: 0,
      hysteresisM: 10,
    });
    expect(justPastBoundary.tierIndex).toBe(0);

    const clearlyPast = selectScatterLodTier(56, lods, {
      previousTierIndex: 0,
      hysteresisM: 10,
    });
    expect(clearlyPast.tierIndex).toBe(1);
  });

  it('resists switching back to a nearer tier until clearly before the boundary', () => {
    const justInsideBoundary = selectScatterLodTier(48, lods, {
      previousTierIndex: 1,
      hysteresisM: 10,
    });
    expect(justInsideBoundary.tierIndex).toBe(1);

    const clearlyInside = selectScatterLodTier(44, lods, {
      previousTierIndex: 1,
      hysteresisM: 10,
    });
    expect(clearlyInside.tierIndex).toBe(0);
  });

  it('keeps blend01 pinned at 1 when hysteresis resists a tier already past its own boundary', () => {
    // distance 52 is past tier 0's boundary (50), but hysteresis (half=5) resists
    // the raw tier change, so the resisted tier's own distanceToBoundaryM goes
    // negative. The fade must stay fully committed (1), not snap back to 0.
    const resisted = selectScatterLodTier(52, lods, {
      previousTierIndex: 0,
      hysteresisM: 10,
      ditherBandM: 10,
    });
    expect(resisted.tierIndex).toBe(0);
    expect(resisted.blend01).toBeCloseTo(1, 5);
  });

  it('ignores hysteresis across a multi-tier jump (e.g. teleport)', () => {
    const result = selectScatterLodTier(300, lods, {
      previousTierIndex: 0,
      hysteresisM: 10,
    });
    expect(result.tierIndex).toBe(2);
  });
});
