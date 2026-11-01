import type { Vector3Tuple } from 'three';
import { cylinderGravityField, sphereGravityField } from './gravity-fields';

const TOLERANCE = 1e-9;

function expectVectorClose(actual: Vector3Tuple | undefined, expected: Vector3Tuple): void {
  expect(actual).toBeDefined();
  if (!actual) return;
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(TOLERANCE);
  }
}

describe('sphereGravityField', () => {
  it('points from a position toward the centre at the given magnitude', () => {
    const field = sphereGravityField([0, 0, 0], 9.8);
    expect(field([1, 0, 0])).toEqual([-9.8, 0, 0]);
  });

  it('points toward a centre on the positive Z side', () => {
    const field = sphereGravityField([0, 0, 5], 9.8);
    expectVectorClose(field([0, 0, -5]), [0, 0, 9.8]);
  });

  it('matches the planet-scale case with the centre far below the position', () => {
    const field = sphereGravityField([0, -6.371e6, 0], 9.8);
    expectVectorClose(field([0, 0, 0]), [0, -9.8, 0]);
  });

  it('returns undefined at the centre', () => {
    const field = sphereGravityField([2, 3, 4], 9.8);
    expect(field([2, 3, 4])).toBeUndefined();
  });

  it('keeps the magnitude equal to the acceleration at arbitrary positions', () => {
    const field = sphereGravityField([0, 0, 0], 9.8);
    const positions: Vector3Tuple[] = [
      [3, -2, 7],
      [-10, 4, 1],
      [0.5, 0.5, 0.5],
      [100, -200, 300],
      [-1, -1, -1],
    ];
    for (const position of positions) {
      const result = field(position);
      expect(result).toBeDefined();
      if (!result) continue;
      const magnitude = Math.hypot(result[0], result[1], result[2]);
      expect(Math.abs(magnitude - 9.8)).toBeLessThan(TOLERANCE);
    }
  });
});

describe('cylinderGravityField', () => {
  it('points radially outward from a Z axis through the origin', () => {
    const field = cylinderGravityField([0, 0, 0], [0, 0, 1], 9.8);
    expectVectorClose(field([3, 0, 10]), [9.8, 0, 0]);
    expectVectorClose(field([0, -4, -2]), [0, -9.8, 0]);
  });

  it('returns undefined on the axis', () => {
    const field = cylinderGravityField([0, 0, 0], [0, 0, 1], 9.8);
    expect(field([0, 0, 7])).toBeUndefined();
  });

  it('gives the same result for a non-unit axis direction', () => {
    const unit = cylinderGravityField([0, 0, 0], [0, 0, 1], 9.8);
    const scaled = cylinderGravityField([0, 0, 0], [0, 0, 5], 9.8);
    expectVectorClose(scaled([3, 0, 10]), unit([3, 0, 10]) as Vector3Tuple);
    expectVectorClose(scaled([0, -4, -2]), unit([0, -4, -2]) as Vector3Tuple);
  });

  it('gives magnitude a and no component along an oblique axis', () => {
    const axis: Vector3Tuple = [1, 1, 0];
    const field = cylinderGravityField([0, 0, 0], axis, 9.8);
    const result = field([1, -1, 3]);
    expect(result).toBeDefined();
    if (!result) return;
    const magnitude = Math.hypot(result[0], result[1], result[2]);
    expect(Math.abs(magnitude - 9.8)).toBeLessThan(TOLERANCE);
    const alongAxis = result[0] * axis[0] + result[1] * axis[1] + result[2] * axis[2];
    expect(Math.abs(alongAxis)).toBeLessThan(TOLERANCE);
  });

  it('throws when the axis direction is zero', () => {
    expect(() => cylinderGravityField([0, 0, 0], [0, 0, 0], 9.8)).toThrowError(
      'axisDirection must be non-zero',
    );
  });

  it('measures radius from an offset axis point', () => {
    const field = cylinderGravityField([0, 10, 0], [0, 0, 1], 9.8);
    expectVectorClose(field([0, 12, 0]), [0, 9.8, 0]);
    expectVectorClose(field([0, 8, 0]), [0, -9.8, 0]);
  });
});
