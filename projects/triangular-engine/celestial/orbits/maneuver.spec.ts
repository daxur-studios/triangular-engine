import { vec3Cross, vec3Dot, vec3Length, vec3Sub } from '../math/vec3';
import { orbitApsides } from './apsides';
import {
  applyManeuverNode,
  IManeuverNode,
  maneuverNodeBasis,
} from './maneuver';
import { IKeplerianElements } from './kepler-elements';
import { keplerianElementsToStateVector } from './state-elements';

const mu = 3.986e14;

function circularEquatorialElements(radiusM: number): IKeplerianElements {
  return {
    semiMajorAxisM: radiusM,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
  };
}

const zeroNode = (ut: number): IManeuverNode => ({
  ut,
  progradeDvMPerS: 0,
  normalDvMPerS: 0,
  radialDvMPerS: 0,
});

function inclinedEllipticalElements(): IKeplerianElements {
  return {
    semiMajorAxisM: 8_000_000,
    eccentricity: 0.2,
    inclinationRad: 0.5,
    longitudeOfAscendingNodeRad: 1.1,
    argumentOfPeriapsisRad: 0.4,
    meanAnomalyAtEpochRad: 0.9,
    epochUt: 0,
  };
}

describe('applyManeuverNode: zero node is identity', () => {
  it('leaves orbit shape unchanged for a zero-Δv node', () => {
    const elements = circularEquatorialElements(7_000_000);
    const result = applyManeuverNode(elements, mu, zeroNode(0));

    expect(result.semiMajorAxisM).toBeCloseTo(elements.semiMajorAxisM, 3);
    expect(result.eccentricity).toBeCloseTo(elements.eccentricity, 9);
    expect(result.inclinationRad).toBeCloseTo(elements.inclinationRad, 9);
  });

  it('leaves the state vector at the burn time unchanged for a zero-Δv node', () => {
    const elements = circularEquatorialElements(7_000_000);
    const beforeState = keplerianElementsToStateVector(elements, mu, 500);
    const result = applyManeuverNode(elements, mu, zeroNode(500));
    const afterState = keplerianElementsToStateVector(result, mu, 500);

    expect(
      vec3Length(vec3Sub(afterState.positionM, beforeState.positionM)),
    ).toBeLessThan(1e-3);
    expect(
      vec3Length(vec3Sub(afterState.velocityMPerS, beforeState.velocityMPerS)),
    ).toBeLessThan(1e-6);
  });
});

describe('applyManeuverNode: prograde burn raises apoapsis per vis-viva', () => {
  it('matches the vis-viva-predicted apoapsis for a prograde burn on a circular orbit', () => {
    const r = 7_000_000;
    const elements = circularEquatorialElements(r);
    const node: IManeuverNode = {
      ut: 0,
      progradeDvMPerS: 500,
      normalDvMPerS: 0,
      radialDvMPerS: 0,
    };

    const result = applyManeuverNode(elements, mu, node);

    const vCircular = Math.sqrt(mu / r);
    const vAfterBurn = vCircular + node.progradeDvMPerS;
    const aAfterBurn = 1 / (2 / r - (vAfterBurn * vAfterBurn) / mu);
    const expectedApoapsisM = 2 * aAfterBurn - r; // periapsis stays at the burn radius r

    const { periapsisM, apoapsisM } = orbitApsides(result);
    expect(periapsisM).toBeCloseTo(r, 0);
    expect(apoapsisM).toBeCloseTo(expectedApoapsisM, 0);
  });
});

describe('applyManeuverNode: triad orthonormality / radial direction', () => {
  it('a pure radial-outward burn leaves specific angular momentum unchanged (radialOut is parallel to r-hat)', () => {
    // h = r x v is unchanged exactly when the velocity change is parallel to
    // r — which is the case only if radialOut actually points along r-hat,
    // as decision 9 specifies ("radialOut points away from the body").
    // Energy still rises (|v| increases), so with h fixed, eccentricity must
    // become nonzero: a clean, direction-sensitive check with no ambiguity
    // about which apsis the burn point becomes.
    const r = 7_000_000;
    const elements = circularEquatorialElements(r);
    const vCircular = Math.sqrt(mu / r);
    const hBefore = r * vCircular;

    const node: IManeuverNode = {
      ut: 0,
      progradeDvMPerS: 0,
      normalDvMPerS: 0,
      radialDvMPerS: 50,
    };
    const result = applyManeuverNode(elements, mu, node);

    const hAfter = Math.sqrt(
      mu *
        result.semiMajorAxisM *
        (1 - result.eccentricity * result.eccentricity),
    );
    expect(hAfter).toBeCloseTo(hBefore, 3);
    expect(result.eccentricity).toBeGreaterThan(0);
  });

  it('a pure normal burn tilts inclination, keeps periapsis at the burn radius, and raises apoapsis per vis-viva on the combined speed', () => {
    // normal is perpendicular to both prograde and r-hat, so it adds no
    // radial velocity (periapsis stays at r) but does add speed — energy
    // depends only on |v|, so apoapsis rises by the same vis-viva formula as
    // the prograde case, using the Pythagorean combined speed.
    const r = 7_000_000;
    const elements = circularEquatorialElements(r);
    const node: IManeuverNode = {
      ut: 0,
      progradeDvMPerS: 0,
      normalDvMPerS: 50,
      radialDvMPerS: 0,
    };

    const result = applyManeuverNode(elements, mu, node);
    expect(result.inclinationRad).toBeGreaterThan(0);

    const vCircular = Math.sqrt(mu / r);
    const vAfterBurn = Math.sqrt(
      vCircular * vCircular + node.normalDvMPerS * node.normalDvMPerS,
    );
    const aAfterBurn = 1 / (2 / r - (vAfterBurn * vAfterBurn) / mu);
    const expectedApoapsisM = 2 * aAfterBurn - r;

    const { periapsisM, apoapsisM } = orbitApsides(result);
    expect(periapsisM).toBeCloseTo(r, 0);
    expect(apoapsisM).toBeCloseTo(expectedApoapsisM, 0);
  });
});

describe('maneuverNodeBasis: orthonormal triad', () => {
  it('returns unit-length, mutually orthogonal prograde/normal/radialOut for an inclined elliptical orbit', () => {
    const elements = inclinedEllipticalElements();
    const { prograde, normal, radialOut } = maneuverNodeBasis(
      elements,
      mu,
      1234,
    );

    expect(vec3Length(prograde)).toBeCloseTo(1, 9);
    expect(vec3Length(normal)).toBeCloseTo(1, 9);
    expect(vec3Length(radialOut)).toBeCloseTo(1, 9);

    expect(vec3Dot(prograde, normal)).toBeCloseTo(0, 9);
    expect(vec3Dot(prograde, radialOut)).toBeCloseTo(0, 9);
    expect(vec3Dot(normal, radialOut)).toBeCloseTo(0, 9);

    // radialOut = prograde x normal, right-handed by construction.
    const cross = vec3Cross(prograde, normal);
    expect(vec3Dot(cross, radialOut)).toBeCloseTo(1, 9);
  });
});
