import { normalizeRadians } from './angles';
import { KeplerConvergenceError } from './errors';

const TWO_PI = 2 * Math.PI;

export interface SolveEccentricAnomalyOptions {
  /** Test-only override to force deterministic non-convergence. Default 32. */
  maxIterations?: number;
  /** Test-only override of the step/residual tolerance. Default 1e-13 rad. */
  toleranceRad?: number;
}

/**
 * Solves Kepler's equation `E - e*sin(E) = M` for the eccentric anomaly
 * (map-view-mvp.md §5). Starts at `M + e*sin(M)` below `e = 0.8`, otherwise
 * at `pi`, then runs safeguarded Newton-Raphson: a bracket `[lower, upper]`
 * is maintained from `f`'s sign (monotonic since `f' = 1 - e*cos(E) > 0`
 * for `e < 1`), and any Newton step that leaves the bracket or produces a
 * non-finite value falls back to bisection. This guarantees convergence
 * even where a bare Newton iteration stalls near periapsis at high
 * eccentricity.
 */
export function solveEccentricAnomaly(
  meanAnomalyRad: number,
  eccentricity: number,
  options?: SolveEccentricAnomalyOptions,
): number {
  if (!(eccentricity >= 0) || eccentricity >= 1) {
    throw new RangeError(`eccentricity must be in [0, 1): got ${eccentricity}`);
  }

  const maxIterations = options?.maxIterations ?? 32;
  const toleranceRad = options?.toleranceRad ?? 1e-13;

  const M = normalizeRadians(meanAnomalyRad);
  const e = eccentricity;

  let lower = 0;
  let upper = TWO_PI;
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const f = E - e * Math.sin(E) - M;
    if (Math.abs(f) <= toleranceRad) {
      return E;
    }

    if (f > 0) {
      upper = E;
    } else {
      lower = E;
    }

    const derivative = 1 - e * Math.cos(E);
    let candidate = E - f / derivative;
    let step: number;
    if (Number.isFinite(candidate) && candidate > lower && candidate < upper) {
      step = candidate - E;
    } else {
      candidate = (lower + upper) / 2;
      step = candidate - E;
    }

    E = candidate;
  }

  const residual = Math.abs(E - e * Math.sin(E) - M);
  throw new KeplerConvergenceError(M, e, residual, maxIterations);
}

export interface SolveHyperbolicAnomalyOptions {
  /** Test-only override to force deterministic non-convergence. Default 32. */
  maxIterations?: number;
  /** Test-only override of the residual tolerance's absolute floor. Default 1e-13. */
  toleranceRad?: number;
}

/**
 * Solves the hyperbolic Kepler equation `e*sinh(H) - H = M` for the
 * hyperbolic anomaly (patched-conics.md decision 4). `M` is the *hyperbolic*
 * mean anomaly — unwrapped, never normalized, since it grows without bound
 * along an escape trajectory. Starts at `H0 = asinh(M / e)` and runs plain
 * Newton-Raphson: unlike the elliptic solver, no bracket/bisection safeguard
 * is needed because `d/dH (e*sinh(H) - H) = e*cosh(H) - 1 > 0` everywhere
 * for `e > 1`, so the equation is strictly monotonic with a single root and
 * this standard starting guess converges quadratically without stalling.
 *
 * The convergence check scales `toleranceRad` by `max(1, |M|)`: `e*sinh(H)`
 * grows with `M`, so its float64 rounding floor does too — for large `M` an
 * absolute-only tolerance is unreachable no matter how many iterations run,
 * not because the root isn't found.
 */
export function solveHyperbolicAnomaly(
  meanAnomalyRad: number,
  eccentricity: number,
  options?: SolveHyperbolicAnomalyOptions,
): number {
  if (!(eccentricity > 1)) {
    throw new RangeError(`eccentricity must be > 1: got ${eccentricity}`);
  }

  const maxIterations = options?.maxIterations ?? 32;
  const toleranceRad =
    (options?.toleranceRad ?? 1e-13) * Math.max(1, Math.abs(meanAnomalyRad));

  const M = meanAnomalyRad;
  const e = eccentricity;

  let H = Math.asinh(M / e);

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const f = e * Math.sinh(H) - H - M;
    if (Math.abs(f) <= toleranceRad) {
      return H;
    }

    const derivative = e * Math.cosh(H) - 1;
    H -= f / derivative;

    if (!Number.isFinite(H)) {
      break;
    }
  }

  const residual = Math.abs(e * Math.sinh(H) - H - M);
  throw new KeplerConvergenceError(M, e, residual, maxIterations);
}
