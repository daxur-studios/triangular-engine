import { UniversalTime } from '../time/universal-clock';
import { Vec3d } from '../math/vec3';

/** Eccentricity/`abs(sin(i))` threshold below which an orbit is treated as circular/equatorial (map-view-mvp.md §4). */
export const SINGULAR_EPSILON = 1e-10;

/**
 * `|eccentricity - 1|` threshold below which a state is treated as
 * unsupported near-parabolic rather than hyperbolic (patched-conics.md
 * decision 4). Set well above `SINGULAR_EPSILON`: the elliptic/hyperbolic
 * conversion formulas lose precision (division by a near-zero
 * `1 - eccentricity`) long before eccentricity reaches exactly 1.
 */
export const PARABOLIC_EPSILON = 1e-8;

/**
 * Classical orbital elements (map-view-mvp.md §4). Angle fields are
 * canonicalized per the singular-case rules in `stateVectorToKeplerianElements`
 * — they are not scattered epsilon fixes elsewhere.
 */
export interface IKeplerianElements {
  semiMajorAxisM: number;
  eccentricity: number;
  /** `[0, pi]`. */
  inclinationRad: number;
  /** `[0, 2*pi)`. */
  longitudeOfAscendingNodeRad: number;
  /** `[0, 2*pi)`. */
  argumentOfPeriapsisRad: number;
  /**
   * `[0, 2*pi)` when `eccentricity < 1`. For `eccentricity > 1` this is the
   * *hyperbolic* mean anomaly instead: unwrapped, unbounded, and never passed
   * through `normalizeRadians` — it is not an angle (patched-conics.md
   * decision 4).
   */
  meanAnomalyAtEpochRad: number;
  epochUt: UniversalTime;
}

export interface IStateVector {
  positionM: Vec3d;
  velocityMPerS: Vec3d;
}
