import {
  Vec3d,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Scale,
  vec3Sub,
} from '../math/vec3';
import { UniversalTime } from '../time/universal-clock';
import { clampUnit, normalizeRadians } from './angles';
import { UnsupportedConicError } from './errors';
import {
  IKeplerianElements,
  IStateVector,
  PARABOLIC_EPSILON,
  SINGULAR_EPSILON,
} from './kepler-elements';
import { solveEccentricAnomaly, solveHyperbolicAnomaly } from './kepler-solver';
import { perifocalBasis } from './perifocal-basis';
import { REFERENCE_I, REFERENCE_J, REFERENCE_K } from './reference-basis';

/**
 * Converts a PCI state vector to classical orbital elements
 * (map-view-mvp.md §4/§5). Every angle is derived through `atan2` against
 * an explicit in-plane/out-of-plane pair of dot products rather than
 * `acos` plus a branch, which sidesteps quadrant mistakes. The periapsis
 * and anomaly angles use `atan2(dot(x, cross(h, reference))/|h|, dot(x, reference))`
 * — the `/|h|` matters: `cross(h, reference)` is not a unit vector like
 * `REFERENCE_I`/`REFERENCE_J` are, so its dot product is scaled by `|h|`
 * relative to the plain `dot(x, reference)` term, and skipping the
 * division silently produces a wrong-magnitude (but real-looking) angle
 * rather than a NaN.
 *
 * Singular cases follow the plan's canonical rules: circular orbits get
 * `argumentOfPeriapsisRad = 0` and store the argument of latitude (or,
 * additionally equatorial, the true longitude) as
 * `meanAnomalyAtEpochRad` — valid because eccentricity 0 makes mean,
 * eccentric, and true anomaly numerically identical, so that stored phase
 * angle propagates correctly through `keplerianElementsToStateVector`
 * without ever being reinterpreted as a "true" mean anomaly.
 */
export function stateVectorToKeplerianElements(
  state: IStateVector,
  mu: number,
  epochUt: UniversalTime,
): IKeplerianElements {
  const r = state.positionM;
  const v = state.velocityMPerS;
  const rMag = vec3Length(r);
  const vMag = vec3Length(v);

  if (rMag === 0) {
    throw new UnsupportedConicError(
      'stateVectorToKeplerianElements: position is zero',
    );
  }

  const h = vec3Cross(r, v);
  const hMag = vec3Length(h);
  if (hMag < SINGULAR_EPSILON) {
    throw new UnsupportedConicError(
      'stateVectorToKeplerianElements: degenerate radial trajectory (zero angular momentum)',
    );
  }

  const eccentricityVector = vec3Sub(
    vec3Scale(vec3Cross(v, h), 1 / mu),
    vec3Scale(r, 1 / rMag),
  );
  const eccentricity = vec3Length(eccentricityVector);
  if (Math.abs(eccentricity - 1) < PARABOLIC_EPSILON) {
    throw new UnsupportedConicError(
      'stateVectorToKeplerianElements: near-parabolic state ' +
        '(|eccentricity - 1| < PARABOLIC_EPSILON), outside the supported domain',
    );
  }

  // `2/rMag - vMag^2/mu` is `1/a`; its sign always agrees with `eccentricity`
  // above/below 1 except within the near-parabolic band already rejected, so
  // no separate epsilon check is needed here — semiMajorAxisM comes out
  // negative for hyperbolic states, as the hyperbolic branches below expect.
  const inverseSemiMajorAxis = 2 / rMag - (vMag * vMag) / mu;
  const semiMajorAxisM = 1 / inverseSemiMajorAxis;

  const inclinationRad = Math.acos(clampUnit(vec3Dot(h, REFERENCE_K) / hMag));
  const node = vec3Cross(REFERENCE_K, h);
  const nodeMag = vec3Length(node);

  const circular = eccentricity < SINGULAR_EPSILON;
  const equatorial = Math.abs(Math.sin(inclinationRad)) < SINGULAR_EPSILON;
  const prograde = vec3Dot(h, REFERENCE_K) >= 0;

  let longitudeOfAscendingNodeRad: number;
  let argumentOfPeriapsisRad: number;
  let meanAnomalyAtEpochRad: number;

  if (!equatorial) {
    longitudeOfAscendingNodeRad = normalizeRadians(
      Math.atan2(vec3Dot(node, REFERENCE_J), vec3Dot(node, REFERENCE_I)),
    );
  } else {
    longitudeOfAscendingNodeRad = 0;
  }

  if (!circular && !equatorial) {
    argumentOfPeriapsisRad = normalizeRadians(
      Math.atan2(
        vec3Dot(eccentricityVector, vec3Cross(h, node)) / hMag,
        vec3Dot(eccentricityVector, node),
      ),
    );
    const trueAnomalyRad = normalizeRadians(
      Math.atan2(
        vec3Dot(r, vec3Cross(h, eccentricityVector)) / hMag,
        vec3Dot(r, eccentricityVector),
      ),
    );
    meanAnomalyAtEpochRad = trueAnomalyToMeanAnomaly(
      trueAnomalyRad,
      eccentricity,
    );
  } else if (circular && !equatorial) {
    argumentOfPeriapsisRad = 0;
    meanAnomalyAtEpochRad = normalizeRadians(
      Math.atan2(vec3Dot(r, vec3Cross(h, node)) / hMag, vec3Dot(r, node)),
    );
  } else if (!circular && equatorial) {
    const jSign = prograde ? 1 : -1;
    argumentOfPeriapsisRad = normalizeRadians(
      Math.atan2(
        jSign * vec3Dot(eccentricityVector, REFERENCE_J),
        vec3Dot(eccentricityVector, REFERENCE_I),
      ),
    );
    const trueAnomalyRad = normalizeRadians(
      Math.atan2(
        vec3Dot(r, vec3Cross(h, eccentricityVector)) / hMag,
        vec3Dot(r, eccentricityVector),
      ),
    );
    meanAnomalyAtEpochRad = trueAnomalyToMeanAnomaly(
      trueAnomalyRad,
      eccentricity,
    );
  } else {
    // Circular and equatorial: store the true longitude directly.
    argumentOfPeriapsisRad = 0;
    const jSign = prograde ? 1 : -1;
    meanAnomalyAtEpochRad = normalizeRadians(
      Math.atan2(jSign * vec3Dot(r, REFERENCE_J), vec3Dot(r, REFERENCE_I)),
    );
  }

  return {
    semiMajorAxisM,
    eccentricity,
    inclinationRad,
    longitudeOfAscendingNodeRad,
    argumentOfPeriapsisRad,
    meanAnomalyAtEpochRad,
    epochUt,
  };
}

/**
 * Converts true anomaly to mean anomaly for either conic. The elliptic
 * branch (`eccentricity < 1`) goes through eccentric anomaly via `atan2`,
 * exactly as before. The hyperbolic branch (`eccentricity > 1`) goes through
 * `asinh`, which — unlike `atan2` for the periodic elliptic case — is
 * already a true (non-periodic) inverse of `sinh` over all reals, so no
 * quadrant reconstruction is needed. The hyperbolic result is unwrapped and
 * must never pass through `normalizeRadians` (patched-conics.md decision 4).
 */
function trueAnomalyToMeanAnomaly(
  trueAnomalyRad: number,
  eccentricity: number,
): number {
  if (eccentricity < 1) {
    const eccentricAnomalyRad = normalizeRadians(
      Math.atan2(
        Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(trueAnomalyRad),
        eccentricity + Math.cos(trueAnomalyRad),
      ),
    );
    return normalizeRadians(
      eccentricAnomalyRad - eccentricity * Math.sin(eccentricAnomalyRad),
    );
  }

  const denom = 1 + eccentricity * Math.cos(trueAnomalyRad);
  const hyperbolicAnomalyRad = Math.asinh(
    (Math.sqrt(eccentricity * eccentricity - 1) * Math.sin(trueAnomalyRad)) /
      denom,
  );
  return eccentricity * Math.sinh(hyperbolicAnomalyRad) - hyperbolicAnomalyRad;
}

/**
 * Propagates and reconstructs a PCI state vector at absolute time `ut`
 * (map-view-mvp.md §5). The stored `meanAnomalyAtEpochRad` — whatever
 * angle it canonically represents for this orbit's singular case — always
 * advances linearly at the mean-motion rate; solving Kepler's equation and
 * rebuilding position/velocity in the `perifocalBasis` recovers the exact
 * physical state because that basis was itself built to make the singular
 * canonicalizations self-consistent (see `perifocalBasis`).
 */
export function keplerianElementsToStateVector(
  elements: IKeplerianElements,
  mu: number,
  ut: UniversalTime,
): IStateVector {
  const { semiMajorAxisM: a, eccentricity: e } = elements;
  const hyperbolic = e > 1;

  let trueAnomalyRad: number;
  if (hyperbolic) {
    // Mean motion uses `-a` (positive, since a < 0 for a hyperbola); the
    // mean anomaly is unwrapped and never normalized (decision 4).
    const meanMotionRadPerS = Math.sqrt(mu / (-a) ** 3);
    const meanAnomalyRad =
      elements.meanAnomalyAtEpochRad +
      meanMotionRadPerS * (ut - elements.epochUt);
    const H = solveHyperbolicAnomaly(meanAnomalyRad, e);

    // Perifocal position for a hyperbola: x = a(cosh(H) - e),
    // y = -a*sqrt(e^2-1)*sinh(H) (note the minus — the perifocal y-axis
    // and increasing H run opposite ways for a<0; verified against
    // trueAnomalyToMeanAnomaly's forward direction by round-trip spec).
    // True anomaly is atan2(y, x) with those signed components, not their
    // magnitudes — dropping a's sign would silently rotate the result by pi.
    trueAnomalyRad = normalizeRadians(
      Math.atan2(
        -a * Math.sqrt(e * e - 1) * Math.sinh(H),
        a * (Math.cosh(H) - e),
      ),
    );
  } else {
    const meanMotionRadPerS = Math.sqrt(mu / (a * a * a));
    const meanAnomalyRad = normalizeRadians(
      elements.meanAnomalyAtEpochRad +
        meanMotionRadPerS * (ut - elements.epochUt),
    );
    const eccentricAnomalyRad = solveEccentricAnomaly(meanAnomalyRad, e);

    trueAnomalyRad = normalizeRadians(
      Math.atan2(
        Math.sqrt(1 - e * e) * Math.sin(eccentricAnomalyRad),
        Math.cos(eccentricAnomalyRad) - e,
      ),
    );
  }

  const { periapsisDirection, inPlaneDirection } = perifocalBasis(
    elements.longitudeOfAscendingNodeRad,
    elements.inclinationRad,
    elements.argumentOfPeriapsisRad,
  );

  const specificAngularMomentum = Math.sqrt(mu * a * (1 - e * e));
  const cosNu = Math.cos(trueAnomalyRad);
  const sinNu = Math.sin(trueAnomalyRad);
  const radiusM =
    (specificAngularMomentum * specificAngularMomentum) / mu / (1 + e * cosNu);

  const positionM: Vec3d = [
    radiusM * (cosNu * periapsisDirection[0] + sinNu * inPlaneDirection[0]),
    radiusM * (cosNu * periapsisDirection[1] + sinNu * inPlaneDirection[1]),
    radiusM * (cosNu * periapsisDirection[2] + sinNu * inPlaneDirection[2]),
  ];

  const velocityCoeff = mu / specificAngularMomentum;
  const velocityMPerS: Vec3d = [
    velocityCoeff *
      (-sinNu * periapsisDirection[0] + (e + cosNu) * inPlaneDirection[0]),
    velocityCoeff *
      (-sinNu * periapsisDirection[1] + (e + cosNu) * inPlaneDirection[1]),
    velocityCoeff *
      (-sinNu * periapsisDirection[2] + (e + cosNu) * inPlaneDirection[2]),
  ];

  return { positionM, velocityMPerS };
}
