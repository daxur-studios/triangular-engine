import { ICelestialBody } from '../bodies/celestial-body';
import {
  Vec3d,
  vec3Add,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from '../math/vec3';
import { quatApplyToVec3, quatFromAxisAngle } from '../math/quat';
import { UniversalTime } from '../time/universal-clock';
import { bodyWorldStateAt } from './ephemeris';
import { IStateVector } from './kepler-elements';
import { IOrbitPropagator } from './propagator';

export type LibrationId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** Newton iteration cap for the collinear-point solve — see `solveCollinearAxialCoordinate`. Real mass ratios converge in well under 10. */
const MAX_COLLINEAR_ITERATIONS = 50;
/** Step-size convergence tolerance, relative to the current axial coordinate magnitude (or 1 m for a coordinate near the barycenter). */
const COLLINEAR_TOLERANCE_RELATIVE = 1e-12;
/** Half-width of the central-difference sample used for `librationPointWorldStateAt`'s velocity (see its doc comment). */
const VELOCITY_SAMPLE_DT_S = 1;

function findBodyOrThrow(
  bodies: readonly ICelestialBody[],
  bodyId: string,
): ICelestialBody {
  const body = bodies.find((candidate) => candidate.id === bodyId);
  if (!body) {
    throw new Error(`librationPointWorldStateAt: no body with id '${bodyId}'`);
  }
  return body;
}

/**
 * Solves `omega² * s - mu1 * sign(s - s1) / (s - s1)² - mu2 * sign(s - s2) / (s - s2)² = 0`
 * for `s` — the rotating-frame radial force balance (gravity from both
 * bodies plus centrifugal) along the primary→secondary axis, in an
 * arbitrary open interval bounded by the two bodies' own axial coordinates
 * `s1`/`s2` (or unbounded on the far side). `f` is strictly monotonic on
 * each of the three intervals split by `s1`/`s2` (its derivative
 * `omega² + 2*mu1/|s-s1|³ + 2*mu2/|s-s2|³` is always positive), so plain
 * Newton-Raphson from a seed already inside the correct interval converges
 * without a bisection safeguard — unlike `solveEccentricAnomaly`, which
 * needs one because its function is not globally monotonic.
 */
function solveCollinearAxialCoordinate(
  seed: number,
  s1: number,
  s2: number,
  omegaSquared: number,
  primaryMuM3PerS2: number,
  secondaryMuM3PerS2: number,
): number {
  let s = seed;
  for (let iteration = 0; iteration < MAX_COLLINEAR_ITERATIONS; iteration++) {
    const u = s - s1;
    const w = s - s2;
    const f =
      omegaSquared * s -
      (primaryMuM3PerS2 * Math.sign(u)) / (u * u) -
      (secondaryMuM3PerS2 * Math.sign(w)) / (w * w);
    const derivative =
      omegaSquared +
      (2 * primaryMuM3PerS2) / Math.abs(u) ** 3 +
      (2 * secondaryMuM3PerS2) / Math.abs(w) ** 3;
    const next = s - f / derivative;
    if (!Number.isFinite(next)) {
      throw new Error(
        `librationPointWorldStateAt: collinear solve diverged from seed ${seed}`,
      );
    }
    if (
      Math.abs(next - s) <
      COLLINEAR_TOLERANCE_RELATIVE * Math.max(Math.abs(next), 1)
    ) {
      return next;
    }
    s = next;
  }
  throw new Error(
    `librationPointWorldStateAt: collinear solve did not converge from seed ${seed} after ${MAX_COLLINEAR_ITERATIONS} iterations`,
  );
}

/**
 * World position of a collinear point (L1/L2/L3), exact for any mass ratio.
 * Assumes the secondary's motion around the primary is instantaneously
 * circular at `distanceM` — exact for the stock circular moon, a first-order
 * approximation for an eccentric secondary (design doc §1's documented
 * limitation, not re-derived here).
 *
 * Works entirely in a 1D axial coordinate `s`, measured along the
 * primary→secondary unit vector with origin at the pair's own barycenter —
 * `s1`/`s2` are where the primary/secondary themselves sit on that axis.
 * Seeded from the standard small-mass-ratio cube-root/L3 approximations
 * (Wikipedia "Lagrange point"), then refined to the exact root by
 * `solveCollinearAxialCoordinate` — the seed only has to land in the right
 * one of the three open intervals the Newton solve treats as monotonic, it
 * does not need to be numerically close.
 */
function collinearPointPositionM(
  primaryPositionM: Vec3d,
  secondaryPositionM: Vec3d,
  primaryMuM3PerS2: number,
  secondaryMuM3PerS2: number,
  point: 'L1' | 'L2' | 'L3',
): Vec3d {
  const separationM = vec3Sub(secondaryPositionM, primaryPositionM);
  const distanceM = vec3Length(separationM);
  if (distanceM === 0) {
    throw new Error(
      'librationPointWorldStateAt: primary and secondary are coincident',
    );
  }
  const axis = vec3Normalize(separationM);
  const totalMuM3PerS2 = primaryMuM3PerS2 + secondaryMuM3PerS2;
  const massRatio = secondaryMuM3PerS2 / totalMuM3PerS2;
  const s1 = -massRatio * distanceM;
  const s2 = (1 - massRatio) * distanceM;
  const omegaSquared = totalMuM3PerS2 / distanceM ** 3;

  const hillRadiusM = distanceM * Math.cbrt(massRatio / 3);
  let seed: number;
  if (point === 'L1') seed = s2 - hillRadiusM;
  else if (point === 'L2') seed = s2 + hillRadiusM;
  else seed = s1 - distanceM * (1 + (5 * massRatio) / 12);

  const s = solveCollinearAxialCoordinate(
    seed,
    s1,
    s2,
    omegaSquared,
    primaryMuM3PerS2,
    secondaryMuM3PerS2,
  );

  return vec3Add(primaryPositionM, vec3Scale(axis, s - s1));
}

/**
 * World position of an equilateral point (L4/L5) — exact for any mass ratio
 * and any (non-degenerate) relative orbit, since it's pure geometry: rotate
 * the primary→secondary vector ±60° about the pair's own orbital-angular-
 * momentum axis, pivoting at the primary. That construction keeps the point
 * exactly `distanceM` from both bodies by definition (the equilateral
 * triangle IS the equilibrium — no gravity/mu term needed here, unlike the
 * collinear points).
 *
 * L4 leads the secondary along its orbit (rotate toward the direction of
 * motion), L5 trails it — the sign is `+60°`/`-60°` about the right-hand
 * angular-momentum axis `(relativePosition × relativeVelocity)`, which
 * points the same way the secondary is actually revolving.
 */
function equilateralPointPositionM(
  primaryPositionM: Vec3d,
  secondaryPositionM: Vec3d,
  primaryVelocityMPerS: Vec3d,
  secondaryVelocityMPerS: Vec3d,
  point: 'L4' | 'L5',
): Vec3d {
  const relativePositionM = vec3Sub(secondaryPositionM, primaryPositionM);
  const relativeVelocityMPerS = vec3Sub(
    secondaryVelocityMPerS,
    primaryVelocityMPerS,
  );
  const orbitalNormal = vec3Cross(relativePositionM, relativeVelocityMPerS);
  const normalLength = vec3Length(orbitalNormal);
  /** Y-up fallback for the degenerate zero-relative-velocity case — arbitrary but stable, never hit by a real orbiting pair. */
  const axis: Vec3d =
    normalLength > 0 ? vec3Scale(orbitalNormal, 1 / normalLength) : [0, 1, 0];
  const angleRad = point === 'L4' ? Math.PI / 3 : -Math.PI / 3;
  const rotated = quatApplyToVec3(
    quatFromAxisAngle(axis, angleRad),
    relativePositionM,
  );
  return vec3Add(primaryPositionM, rotated);
}

function librationPointPositionM(
  bodies: readonly ICelestialBody[],
  primaryId: string,
  secondaryId: string,
  point: LibrationId,
  ut: UniversalTime,
  propagator: IOrbitPropagator,
): Vec3d {
  const primary = findBodyOrThrow(bodies, primaryId);
  const secondary = findBodyOrThrow(bodies, secondaryId);
  const primaryState = bodyWorldStateAt(bodies, primaryId, ut, propagator);
  const secondaryState = bodyWorldStateAt(bodies, secondaryId, ut, propagator);

  if (point === 'L4' || point === 'L5') {
    return equilateralPointPositionM(
      primaryState.positionM,
      secondaryState.positionM,
      primaryState.velocityMPerS,
      secondaryState.velocityMPerS,
      point,
    );
  }
  return collinearPointPositionM(
    primaryState.positionM,
    secondaryState.positionM,
    primary.muM3PerS2,
    secondary.muM3PerS2,
    point,
  );
}

/**
 * Classical CR3BP equilibrium state of one of the five Lagrange points of a
 * primary/secondary body pair, in the root-inertial (PCI) frame — the same
 * frame `bodyWorldStateAt` and `vesselWorldPositionM` already use, so a
 * caller composes it with everything else in that frame for free (design
 * doc §6: "no new overlay system, no n-body, no frame work").
 *
 * `velocityMPerS` is a central finite difference of position, not a closed
 * form — deliberately: an exact closed-form rate would have to differentiate
 * the primary and secondary's own (possibly non-circular, non-analytic once
 * the propagator interface grows a second implementation) world motion, and
 * the plan this implements is explicit that Lagrange accuracy only needs to
 * be "gameplay-good, not Principia." `VELOCITY_SAMPLE_DT_S` is fixed and
 * small (1 s of universal time) rather than scaled to the pair's orbital
 * period, since every stock/authored pair orbits on an hours-to-days
 * timescale, far slower than a 1 s sample.
 */
export function librationPointWorldStateAt(
  bodies: readonly ICelestialBody[],
  primaryId: string,
  secondaryId: string,
  point: LibrationId,
  ut: UniversalTime,
  propagator: IOrbitPropagator,
): IStateVector {
  const positionM = librationPointPositionM(
    bodies,
    primaryId,
    secondaryId,
    point,
    ut,
    propagator,
  );
  const before = librationPointPositionM(
    bodies,
    primaryId,
    secondaryId,
    point,
    ut - VELOCITY_SAMPLE_DT_S / 2,
    propagator,
  );
  const after = librationPointPositionM(
    bodies,
    primaryId,
    secondaryId,
    point,
    ut + VELOCITY_SAMPLE_DT_S / 2,
    propagator,
  );
  const velocityMPerS = vec3Scale(
    vec3Sub(after, before),
    1 / VELOCITY_SAMPLE_DT_S,
  );
  return { positionM, velocityMPerS };
}
