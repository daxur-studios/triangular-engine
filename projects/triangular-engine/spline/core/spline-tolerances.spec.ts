import {
  computeDefaultTolerances,
  DEFAULT_SPLINE_TOLERANCES,
} from './spline-tolerances';

describe('computeDefaultTolerances', () => {
  it('scales tolerances with the given extent', () => {
    const small = computeDefaultTolerances(10);
    const large = computeDefaultTolerances(500_000);
    expect(large.duplicatePointTol).toBeGreaterThan(small.duplicatePointTol);
    expect(large.chordTol).toBeGreaterThan(small.chordTol);
    expect(large.closestPointTol).toBeGreaterThan(small.closestPointTol);
    expect(large.projectionTol).toBeGreaterThan(small.projectionTol);
  });

  it('keeps bvhLeafSpan and frameClosureTol extent-independent', () => {
    const small = computeDefaultTolerances(10);
    const large = computeDefaultTolerances(500_000);
    expect(large.bvhLeafSpan).toBe(small.bvhLeafSpan);
    expect(large.frameClosureTol).toBe(small.frameClosureTol);
  });

  it('rejects a non-positive or non-finite extent', () => {
    expect(() => computeDefaultTolerances(0)).toThrowError(RangeError);
    expect(() => computeDefaultTolerances(-5)).toThrowError(RangeError);
    expect(() => computeDefaultTolerances(NaN)).toThrowError(RangeError);
  });

  it('exposes a usable fallback constant', () => {
    expect(DEFAULT_SPLINE_TOLERANCES.duplicatePointTol).toBeGreaterThan(0);
    expect(DEFAULT_SPLINE_TOLERANCES.chordTol).toBeGreaterThan(0);
  });
});
