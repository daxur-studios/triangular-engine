import { Vec3d } from '../math/vec3';
import { IKeplerianElements } from './kepler-elements';
import { perifocalBasis } from './perifocal-basis';

export interface SampleEllipticOrbitOptions {
  /** Default 256, allowed 16-4096. */
  segments?: number;
}

const DEFAULT_SEGMENTS = 256;
const MIN_SEGMENTS = 16;
const MAX_SEGMENTS = 4096;

/**
 * Samples a closed PCI polyline uniformly in eccentric anomaly — not true
 * anomaly, which would bunch points near apoapsis — using the same
 * `perifocalBasis` construction propagation uses, so the map can never
 * acquire a second orientation formula (map-view-mvp.md §5). The first and
 * last points coincide, closing the loop.
 */
export function sampleEllipticOrbit(
  elements: IKeplerianElements,
  options?: SampleEllipticOrbitOptions,
): Vec3d[] {
  const segments = options?.segments ?? DEFAULT_SEGMENTS;
  if (
    !Number.isInteger(segments) ||
    segments < MIN_SEGMENTS ||
    segments > MAX_SEGMENTS
  ) {
    throw new RangeError(
      `sampleEllipticOrbit: segments must be an integer in [${MIN_SEGMENTS}, ${MAX_SEGMENTS}]: got ${segments}`,
    );
  }

  const { semiMajorAxisM: a, eccentricity: e } = elements;
  const { periapsisDirection, inPlaneDirection } = perifocalBasis(
    elements.longitudeOfAscendingNodeRad,
    elements.inclinationRad,
    elements.argumentOfPeriapsisRad,
  );
  const semiMinorAxisM = a * Math.sqrt(1 - e * e);

  const points: Vec3d[] = [];
  for (let k = 0; k <= segments; k++) {
    const eccentricAnomalyRad = (k / segments) * 2 * Math.PI;
    const perifocalX = a * (Math.cos(eccentricAnomalyRad) - e);
    const perifocalY = semiMinorAxisM * Math.sin(eccentricAnomalyRad);

    points.push([
      perifocalX * periapsisDirection[0] + perifocalY * inPlaneDirection[0],
      perifocalX * periapsisDirection[1] + perifocalY * inPlaneDirection[1],
      perifocalX * periapsisDirection[2] + perifocalY * inPlaneDirection[2],
    ]);
  }

  return points;
}

export interface SampleHyperbolicTrajectoryOptions {
  /** Default 256, allowed 16-4096. */
  segments?: number;
}

/**
 * Samples an open PCI polyline for a hyperbolic trajectory, uniformly in
 * hyperbolic anomaly over the symmetric range (about periapsis, `H = 0`)
 * where the body-relative distance stays within `maxRadiusM` — the clip an
 * unbounded curve needs to be drawable at all (patched-conics.md decision
 * 4). Callers pass the current SOI radius, or a map-extent radius for the
 * root body. Uses the perifocal position formulas `x = a(cosh(H) - e)`,
 * `y = -a*sqrt(e^2-1)*sinh(H)` — the same sign convention verified by
 * `state-elements.spec.ts`'s hyperbolic round-trip tests.
 */
export function sampleHyperbolicTrajectory(
  elements: IKeplerianElements,
  maxRadiusM: number,
  options?: SampleHyperbolicTrajectoryOptions,
): Vec3d[] {
  const segments = options?.segments ?? DEFAULT_SEGMENTS;
  if (
    !Number.isInteger(segments) ||
    segments < MIN_SEGMENTS ||
    segments > MAX_SEGMENTS
  ) {
    throw new RangeError(
      `sampleHyperbolicTrajectory: segments must be an integer in [${MIN_SEGMENTS}, ${MAX_SEGMENTS}]: got ${segments}`,
    );
  }

  const { semiMajorAxisM: a, eccentricity: e } = elements;
  if (!(e > 1)) {
    throw new RangeError(
      `sampleHyperbolicTrajectory: eccentricity must be > 1: got ${e}`,
    );
  }

  const periapsisM = a * (1 - e);
  if (!(maxRadiusM > periapsisM)) {
    throw new RangeError(
      `sampleHyperbolicTrajectory: maxRadiusM (${maxRadiusM}) must exceed the periapsis distance (${periapsisM})`,
    );
  }

  const hMax = Math.acosh((maxRadiusM / -a + 1) / e);
  const { periapsisDirection, inPlaneDirection } = perifocalBasis(
    elements.longitudeOfAscendingNodeRad,
    elements.inclinationRad,
    elements.argumentOfPeriapsisRad,
  );

  const points: Vec3d[] = [];
  for (let k = 0; k <= segments; k++) {
    const hyperbolicAnomalyRad = -hMax + (k / segments) * 2 * hMax;
    const perifocalX = a * (Math.cosh(hyperbolicAnomalyRad) - e);
    const perifocalY =
      -a * Math.sqrt(e * e - 1) * Math.sinh(hyperbolicAnomalyRad);

    points.push([
      perifocalX * periapsisDirection[0] + perifocalY * inPlaneDirection[0],
      perifocalX * periapsisDirection[1] + perifocalY * inPlaneDirection[1],
      perifocalX * periapsisDirection[2] + perifocalY * inPlaneDirection[2],
    ]);
  }

  return points;
}
