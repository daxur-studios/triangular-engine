import { KeplerConvergenceError } from './errors';
import { solveEccentricAnomaly, solveHyperbolicAnomaly } from './kepler-solver';

function residual(M: number, e: number, E: number): number {
  return Math.abs(E - e * Math.sin(E) - M);
}

function hyperbolicResidual(M: number, e: number, H: number): number {
  return Math.abs(e * Math.sinh(H) - H - M);
}

describe('solveEccentricAnomaly', () => {
  it('returns E = M for a circular orbit (e = 0)', () => {
    const E = solveEccentricAnomaly(1.23456, 0);
    expect(E).toBeCloseTo(1.23456, 12);
  });

  it('solves an ordinary elliptic case to the documented residual', () => {
    const M = 1.0;
    const e = 0.5;
    const E = solveEccentricAnomaly(M, e);
    expect(residual(M, e, E)).toBeLessThanOrEqual(1e-12);
  });

  it('returns E = 0 at M = 0 for any eccentricity', () => {
    expect(solveEccentricAnomaly(0, 0.7)).toBeCloseTo(0, 12);
  });

  it('returns E = pi at M = pi for any eccentricity', () => {
    expect(solveEccentricAnomaly(Math.PI, 0.6)).toBeCloseTo(Math.PI, 9);
  });

  it('normalizes M outside [0, 2pi) before solving', () => {
    const inRange = solveEccentricAnomaly(1.0, 0.3);
    const wrapped = solveEccentricAnomaly(1.0 + 4 * Math.PI, 0.3);
    expect(wrapped).toBeCloseTo(inRange, 12);
  });

  it('converges near-circular (e = 1e-12)', () => {
    const M = 2.0;
    const e = 1e-12;
    const E = solveEccentricAnomaly(M, e);
    expect(residual(M, e, E)).toBeLessThanOrEqual(1e-12);
  });

  it('converges at high eccentricity (e = 0.999) across the anomaly range', () => {
    const e = 0.999;
    for (const M of [0, 0.001, 0.5, 1.0, Math.PI, 5.0, 6.0]) {
      const E = solveEccentricAnomaly(M, e);
      expect(residual(M, e, E)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('rejects eccentricity outside the elliptic domain', () => {
    expect(() => solveEccentricAnomaly(1, 1)).toThrowError(RangeError);
    expect(() => solveEccentricAnomaly(1, 1.5)).toThrowError(RangeError);
    expect(() => solveEccentricAnomaly(1, -0.1)).toThrowError(RangeError);
  });

  it('throws KeplerConvergenceError with M/e/residual/iterations when forced not to converge', () => {
    let caught: unknown;
    try {
      solveEccentricAnomaly(1.5, 0.9, { maxIterations: 1, toleranceRad: 0 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KeplerConvergenceError);
    const error = caught as KeplerConvergenceError;
    expect(error.meanAnomalyRad).toBeCloseTo(1.5, 12);
    expect(error.eccentricity).toBe(0.9);
    expect(error.iterations).toBe(1);
    expect(error.residualRad).toBeGreaterThanOrEqual(0);
  });
});

describe('solveHyperbolicAnomaly', () => {
  it('returns H = 0 at M = 0 for any eccentricity > 1', () => {
    expect(solveHyperbolicAnomaly(0, 1.5)).toBeCloseTo(0, 12);
    expect(solveHyperbolicAnomaly(0, 5)).toBeCloseTo(0, 12);
  });

  it('solves an ordinary hyperbolic case to the documented residual', () => {
    const M = 10;
    const e = 1.5;
    const H = solveHyperbolicAnomaly(M, e);
    expect(hyperbolicResidual(M, e, H)).toBeLessThanOrEqual(1e-12);
  });

  it('converges for a wide range of M, including large unwrapped values', () => {
    const e = 1.2;
    for (const M of [-500, -10, -0.5, 0.5, 10, 500, 10_000]) {
      const H = solveHyperbolicAnomaly(M, e);
      expect(hyperbolicResidual(M, e, H)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('converges across a range of eccentricities above 1', () => {
    const M = 3.0;
    for (const e of [1.001, 1.05, 1.5, 5, 20]) {
      const H = solveHyperbolicAnomaly(M, e);
      expect(hyperbolicResidual(M, e, H)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('is odd: H(-M) = -H(M)', () => {
    const e = 2.0;
    const H = solveHyperbolicAnomaly(7.0, e);
    const Hneg = solveHyperbolicAnomaly(-7.0, e);
    expect(Hneg).toBeCloseTo(-H, 9);
  });

  it('rejects eccentricity outside the hyperbolic domain', () => {
    expect(() => solveHyperbolicAnomaly(1, 1)).toThrowError(RangeError);
    expect(() => solveHyperbolicAnomaly(1, 0.5)).toThrowError(RangeError);
    expect(() => solveHyperbolicAnomaly(1, -1.5)).toThrowError(RangeError);
  });

  it('throws KeplerConvergenceError with M/e/residual/iterations when forced not to converge', () => {
    let caught: unknown;
    try {
      solveHyperbolicAnomaly(10, 1.5, { maxIterations: 1, toleranceRad: 0 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KeplerConvergenceError);
    const error = caught as KeplerConvergenceError;
    expect(error.meanAnomalyRad).toBe(10);
    expect(error.eccentricity).toBe(1.5);
    expect(error.iterations).toBe(1);
    expect(error.residualRad).toBeGreaterThanOrEqual(0);
  });
});
