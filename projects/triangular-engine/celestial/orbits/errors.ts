/** Thrown by `solveEccentricAnomaly`/`solveHyperbolicAnomaly` when neither step nor residual reaches tolerance within the iteration cap. */
export class KeplerConvergenceError extends Error {
  constructor(
    public readonly meanAnomalyRad: number,
    public readonly eccentricity: number,
    public readonly residualRad: number,
    public readonly iterations: number,
  ) {
    super(
      `Kepler's equation did not converge: M=${meanAnomalyRad} rad, e=${eccentricity}, ` +
        `residual=${residualRad} rad after ${iterations} iterations`,
    );
    this.name = 'KeplerConvergenceError';
  }
}

/**
 * Thrown for inputs outside the supported conic domain: degenerate radial
 * (zero angular momentum) states, and near-parabolic states
 * (`|eccentricity - 1| < PARABOLIC_EPSILON`). Since patched-conics.md
 * decision 4, ordinary elliptic (`0 <= eccentricity < 1`) *and* hyperbolic
 * (`eccentricity > 1`) states are both supported — this error no longer
 * fires for `eccentricity >= 1` alone. Callers (the map, rails capture)
 * catch only this typed error to show an explicit "unsupported" state
 * instead of drawing/propagating NaNs.
 */
export class UnsupportedConicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConicError';
  }
}
