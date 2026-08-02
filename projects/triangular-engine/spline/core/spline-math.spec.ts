import {
  addVec3,
  crossVec3,
  distanceVec3,
  dotVec3,
  isFiniteVec3,
  lengthVec3,
  lerpVec3,
  normalizeVec3,
  scaleVec3,
  subVec3,
} from './spline-math';

describe('spline vector math', () => {
  it('adds and subtracts componentwise', () => {
    expect(addVec3([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(subVec3([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
  });

  it('scales componentwise', () => {
    expect(scaleVec3([1, -2, 3], 2)).toEqual([2, -4, 6]);
  });

  it('computes dot and cross products', () => {
    expect(dotVec3([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(dotVec3([2, 3, 4], [1, 1, 1])).toBe(9);
    expect(crossVec3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('computes length and distance', () => {
    expect(lengthVec3([3, 4, 0])).toBe(5);
    expect(distanceVec3([0, 0, 0], [3, 4, 0])).toBe(5);
  });

  it('normalizes to unit length', () => {
    const n = normalizeVec3([3, 4, 0]);
    expect(lengthVec3(n)).toBeCloseTo(1, 10);
  });

  it('throws normalizing a zero-length vector', () => {
    expect(() => normalizeVec3([0, 0, 0])).toThrowError(RangeError);
  });

  it('lerps componentwise', () => {
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0)).toEqual([0, 0, 0]);
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 1)).toEqual([10, 20, 30]);
  });

  it('detects non-finite components', () => {
    expect(isFiniteVec3([1, 2, 3])).toBeTrue();
    expect(isFiniteVec3([1, NaN, 3])).toBeFalse();
    expect(isFiniteVec3([1, Infinity, 3])).toBeFalse();
  });
});
