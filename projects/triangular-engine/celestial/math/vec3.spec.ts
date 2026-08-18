import {
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Negate,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from './vec3';

describe('vec3Add/vec3Sub', () => {
  it('adds and subtracts component-wise', () => {
    expect(vec3Add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(vec3Sub([4, 5, 6], [1, 2, 3])).toEqual([3, 3, 3]);
  });
});

describe('vec3Scale/vec3Negate', () => {
  it('scales and negates component-wise', () => {
    expect(vec3Scale([1, -2, 3], 2)).toEqual([2, -4, 6]);
    expect(vec3Negate([1, -2, 3])).toEqual([-1, 2, -3]);
  });
});

describe('vec3Dot/vec3Cross', () => {
  it('computes the dot product', () => {
    expect(vec3Dot([1, 2, 3], [4, 5, 6])).toBe(32);
  });

  it('computes the right-handed cross product', () => {
    expect(vec3Cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(vec3Cross([0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
  });
});

describe('vec3Length', () => {
  it('computes Euclidean length', () => {
    expect(vec3Length([3, 4, 0])).toBeCloseTo(5, 9);
  });
});

describe('vec3Normalize', () => {
  it('scales to unit length', () => {
    const n = vec3Normalize([3, 4, 0]);
    expect(vec3Length(n)).toBeCloseTo(1, 9);
    expect(n[0]).toBeCloseTo(0.6, 9);
    expect(n[1]).toBeCloseTo(0.8, 9);
  });

  it('returns the zero vector for zero-length input instead of NaN', () => {
    expect(vec3Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
