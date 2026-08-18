import { IKeplerianElements } from './kepler-elements';

export interface IOrbitApsides {
  /** Distance from the body's center, not altitude above the surface. */
  periapsisM: number;
  /** Distance from the body's center, not altitude above the surface. */
  apoapsisM: number;
}

/**
 * `periapsisM = a(1 - e)` holds unmodified for a hyperbola (`a < 0`, `e > 1`
 * still gives a positive result). `apoapsisM` has no physical meaning for an
 * unbound orbit — `a(1 + e)` would silently compute a negative number — so
 * it is explicit `Infinity` instead (patched-conics.md decision 4).
 */
export function orbitApsides(elements: IKeplerianElements): IOrbitApsides {
  const { semiMajorAxisM, eccentricity } = elements;
  return {
    periapsisM: semiMajorAxisM * (1 - eccentricity),
    apoapsisM:
      eccentricity < 1 ? semiMajorAxisM * (1 + eccentricity) : Infinity,
  };
}

/** `Infinity` for `eccentricity >= 1` — a hyperbolic/parabolic trajectory never repeats (patched-conics.md decision 4). */
export function orbitalPeriod(
  elements: IKeplerianElements,
  mu: number,
): number {
  if (elements.eccentricity >= 1) {
    return Infinity;
  }
  const a = elements.semiMajorAxisM;
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}
