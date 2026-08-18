import { clampUnit, normalizeRadians } from './angles';

describe('normalizeRadians', () => {
  it('leaves values already in [0, 2pi) unchanged', () => {
    expect(normalizeRadians(0)).toBe(0);
    expect(normalizeRadians(Math.PI)).toBeCloseTo(Math.PI, 12);
  });

  it('wraps negative angles up into [0, 2pi)', () => {
    expect(normalizeRadians(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 12);
  });

  it('wraps angles at or beyond 2pi back down', () => {
    expect(normalizeRadians(2 * Math.PI)).toBeCloseTo(0, 12);
    expect(normalizeRadians(2 * Math.PI + Math.PI / 4)).toBeCloseTo(
      Math.PI / 4,
      12,
    );
  });

  it('wraps large multiples of 2pi', () => {
    expect(normalizeRadians(10 * Math.PI + 0.1)).toBeCloseTo(0.1, 9);
    expect(normalizeRadians(-10 * Math.PI - 0.1)).toBeCloseTo(
      2 * Math.PI - 0.1,
      9,
    );
  });
});

describe('clampUnit', () => {
  it('passes values already within [-1, 1] through unchanged', () => {
    expect(clampUnit(0.5)).toBe(0.5);
    expect(clampUnit(-0.5)).toBe(-0.5);
  });

  it('clamps out-of-range values to the nearest bound', () => {
    expect(clampUnit(1.0000001)).toBe(1);
    expect(clampUnit(-1.0000001)).toBe(-1);
  });
});
