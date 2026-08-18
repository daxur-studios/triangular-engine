import { vec3Length, vec3Sub } from '../math/vec3';
import { IKeplerianElements } from './kepler-elements';
import { keplerianElementsToStateVector } from './state-elements';
import { sampleEllipticOrbit, sampleHyperbolicTrajectory } from './sampling';

function elements(overrides: Partial<IKeplerianElements>): IKeplerianElements {
  return {
    semiMajorAxisM: 7_000_000,
    eccentricity: 0.3,
    inclinationRad: 0.5,
    longitudeOfAscendingNodeRad: 1.1,
    argumentOfPeriapsisRad: 0.7,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
    ...overrides,
  };
}

describe('sampleEllipticOrbit', () => {
  it('closes the loop: first and last points coincide', () => {
    const points = sampleEllipticOrbit(elements({}));
    const first = points[0];
    const last = points[points.length - 1];
    expect(vec3Length(vec3Sub(first, last))).toBeCloseTo(0, 6);
  });

  it('defaults to 256 segments (257 points)', () => {
    const points = sampleEllipticOrbit(elements({}));
    expect(points.length).toBe(257);
  });

  it('honors a custom segment count', () => {
    const points = sampleEllipticOrbit(elements({}), { segments: 16 });
    expect(points.length).toBe(17);
  });

  it('rejects segment counts outside [16, 4096]', () => {
    expect(() =>
      sampleEllipticOrbit(elements({}), { segments: 15 }),
    ).toThrowError(RangeError);
    expect(() =>
      sampleEllipticOrbit(elements({}), { segments: 4097 }),
    ).toThrowError(RangeError);
    expect(() =>
      sampleEllipticOrbit(elements({}), { segments: 100.5 }),
    ).toThrowError(RangeError);
  });

  it('reaches periapsis and apoapsis distances from the body center', () => {
    const a = 7_000_000;
    const e = 0.3;
    const points = sampleEllipticOrbit(
      elements({ semiMajorAxisM: a, eccentricity: e }),
    );
    const distances = points.map(vec3Length);
    expect(Math.min(...distances)).toBeCloseTo(a * (1 - e), 3);
    expect(Math.max(...distances)).toBeCloseTo(a * (1 + e), 3);
  });

  it('produces a perfect circle of radius a for eccentricity 0', () => {
    const a = 7_000_000;
    const points = sampleEllipticOrbit(
      elements({
        semiMajorAxisM: a,
        eccentricity: 0,
        inclinationRad: 0,
        longitudeOfAscendingNodeRad: 0,
        argumentOfPeriapsisRad: 0,
      }),
    );
    for (const point of points) {
      expect(vec3Length(point)).toBeCloseTo(a, 3);
      expect(point[1]).toBeCloseTo(0, 3);
    }
  });
});

function hyperbolicElements(
  overrides: Partial<IKeplerianElements>,
): IKeplerianElements {
  return elements({
    semiMajorAxisM: -1_000_000,
    eccentricity: 2,
    ...overrides,
  });
}

describe('sampleHyperbolicTrajectory', () => {
  it('defaults to 256 segments (257 points), open (not closed)', () => {
    const points = sampleHyperbolicTrajectory(
      hyperbolicElements({}),
      10_000_000,
    );
    expect(points.length).toBe(257);
    expect(
      vec3Length(vec3Sub(points[0], points[points.length - 1])),
    ).toBeGreaterThan(0);
  });

  it('honors a custom segment count', () => {
    const points = sampleHyperbolicTrajectory(
      hyperbolicElements({}),
      10_000_000,
      { segments: 16 },
    );
    expect(points.length).toBe(17);
  });

  it('rejects segment counts outside [16, 4096]', () => {
    expect(() =>
      sampleHyperbolicTrajectory(hyperbolicElements({}), 10_000_000, {
        segments: 15,
      }),
    ).toThrowError(RangeError);
    expect(() =>
      sampleHyperbolicTrajectory(hyperbolicElements({}), 10_000_000, {
        segments: 4097,
      }),
    ).toThrowError(RangeError);
  });

  it('rejects an elliptic eccentricity', () => {
    expect(() =>
      sampleHyperbolicTrajectory(elements({ eccentricity: 0.5 }), 10_000_000),
    ).toThrowError(RangeError);
  });

  it('rejects a maxRadiusM at or below periapsis', () => {
    const els = hyperbolicElements({});
    const periapsisM = els.semiMajorAxisM * (1 - els.eccentricity);
    expect(() => sampleHyperbolicTrajectory(els, periapsisM)).toThrowError(
      RangeError,
    );
  });

  it('every sampled point stays within maxRadiusM, and the closest point matches periapsis', () => {
    const els = hyperbolicElements({});
    const periapsisM = els.semiMajorAxisM * (1 - els.eccentricity);
    const maxRadiusM = 5_000_000;
    const points = sampleHyperbolicTrajectory(els, maxRadiusM);

    const distances = points.map(vec3Length);
    for (const d of distances) {
      expect(d).toBeLessThanOrEqual(maxRadiusM + 1e-3);
    }
    expect(Math.min(...distances)).toBeCloseTo(periapsisM, 2);
    // Symmetric range about periapsis: both endpoints should reach maxRadiusM.
    expect(distances[0]).toBeCloseTo(maxRadiusM, 1);
    expect(distances[distances.length - 1]).toBeCloseTo(maxRadiusM, 1);
  });

  it('its periapsis point (middle sample, even segment count) matches keplerianElementsToStateVector at H = 0', () => {
    const els = hyperbolicElements({ meanAnomalyAtEpochRad: 0, epochUt: 0 });
    const mu = 3.986e14;
    const points = sampleHyperbolicTrajectory(els, 10_000_000, {
      segments: 256,
    });
    const periapsisPoint = points[128]; // H = 0 exactly at the midpoint of a symmetric, even-segment sampling.

    const expectedState = keplerianElementsToStateVector(els, mu, 0);
    expect(
      vec3Length(vec3Sub(periapsisPoint, expectedState.positionM)),
    ).toBeLessThanOrEqual(1e-3);
  });
});
