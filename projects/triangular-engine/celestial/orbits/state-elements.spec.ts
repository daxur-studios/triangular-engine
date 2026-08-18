import { Vec3d, vec3Length, vec3Sub } from '../math/vec3';
import { UnsupportedConicError } from './errors';
import { IKeplerianElements, IStateVector } from './kepler-elements';
import {
  keplerianElementsToStateVector,
  stateVectorToKeplerianElements,
} from './state-elements';

const DEG = Math.PI / 180;

/** Textbook Z-up fixtures are transformed with `(x, y, z) -> (x, z, -y)` (map-view-mvp.md §3). */
function zUpToYUp([x, y, z]: Vec3d): Vec3d {
  return [x, z, -y];
}

function assertStateCloseTo(
  actual: IStateVector,
  expected: IStateVector,
  posTol: number,
  velTol: number,
): void {
  const posErrorM = vec3Length(vec3Sub(actual.positionM, expected.positionM));
  const velErrorMPerS = vec3Length(
    vec3Sub(actual.velocityMPerS, expected.velocityMPerS),
  );
  expect(posErrorM).toBeLessThanOrEqual(posTol);
  expect(velErrorMPerS).toBeLessThanOrEqual(velTol);
}

function roundTripTolerances(state: IStateVector): {
  posTol: number;
  velTol: number;
} {
  const rMag = vec3Length(state.positionM);
  const vMag = vec3Length(state.velocityMPerS);
  return {
    posTol: Math.max(1e-6, rMag * 1e-11),
    velTol: Math.max(1e-9, vMag * 1e-11),
  };
}

describe('stateVectorToKeplerianElements / keplerianElementsToStateVector round trips', () => {
  const mu = 3.986e14;
  const epochUt = 1000;

  const cases: { name: string; state: IStateVector }[] = [
    {
      name: 'circular equatorial',
      state: {
        positionM: [7_000_000, 0, 0],
        velocityMPerS: [0, 0, -Math.sqrt(mu / 7_000_000)],
      },
    },
    {
      name: 'circular inclined',
      state: {
        positionM: [7_000_000, 0, 0],
        velocityMPerS: [
          0,
          Math.sqrt(mu / 7_000_000) * Math.SQRT1_2,
          -Math.sqrt(mu / 7_000_000) * Math.SQRT1_2,
        ],
      },
    },
    {
      name: 'near-circular (e = 1e-9) inclined',
      state: (() => {
        const r = 7_000_000;
        const vCircular = Math.sqrt(mu / r);
        return {
          positionM: [r, 0, 0] as Vec3d,
          velocityMPerS: [
            0,
            vCircular * 0.999999999 * Math.SQRT1_2,
            -vCircular * 0.999999999 * Math.SQRT1_2,
          ] as Vec3d,
        };
      })(),
    },
    {
      name: 'ordinary elliptic, inclined',
      state: {
        positionM: [7_500_000, 1_200_000, 500_000],
        velocityMPerS: [-1200, 6800, 2100],
      },
    },
    {
      name: 'non-circular equatorial (prograde)',
      state: {
        positionM: [8_000_000, 0, -1_500_000],
        velocityMPerS: [900, 0, 6500],
      },
    },
    {
      name: 'non-circular equatorial (retrograde)',
      state: {
        positionM: [8_000_000, 0, -1_500_000],
        velocityMPerS: [900, 0, -6500],
      },
    },
    {
      name: 'circular equatorial (retrograde)',
      state: {
        positionM: [7_000_000, 0, 0],
        velocityMPerS: [0, 0, Math.sqrt(mu / 7_000_000)],
      },
    },
    {
      name: 'high eccentricity (e ~ 0.95), inclined',
      state: {
        // Periapsis-ish state: mostly tangential velocity at a modest radius,
        // well inside a much larger implied apoapsis.
        positionM: [1_000_000, 200_000, 300_000],
        velocityMPerS: [-300, 9200, 1800],
      },
    },
    {
      name: 'suborbital ellipse (small a, high e)',
      state: {
        positionM: [650_000, 0, 0],
        velocityMPerS: [0, 6000, 4000],
      },
    },
  ];

  for (const { name, state } of cases) {
    it(`round-trips: ${name}`, () => {
      const elements = stateVectorToKeplerianElements(state, mu, epochUt);
      expect(elements.eccentricity).toBeGreaterThanOrEqual(0);
      expect(elements.eccentricity).toBeLessThan(1);
      expect(elements.semiMajorAxisM).toBeGreaterThan(0);
      expect(elements.inclinationRad).toBeGreaterThanOrEqual(0);
      expect(elements.inclinationRad).toBeLessThanOrEqual(Math.PI);

      const recovered = keplerianElementsToStateVector(elements, mu, epochUt);
      const { posTol, velTol } = roundTripTolerances(state);
      assertStateCloseTo(recovered, state, posTol, velTol);
    });
  }

  it('propagates a circular orbit back to its start after one full period', () => {
    const r = 7_000_000;
    const vCircular = Math.sqrt(mu / r);
    const state: IStateVector = {
      positionM: [r, 0, 0],
      velocityMPerS: [0, 0, -vCircular],
    };
    const elements = stateVectorToKeplerianElements(state, mu, epochUt);
    const periodS = 2 * Math.PI * Math.sqrt(elements.semiMajorAxisM ** 3 / mu);

    const halfPeriod = keplerianElementsToStateVector(
      elements,
      mu,
      epochUt + periodS / 2,
    );
    expect(halfPeriod.positionM[0]).toBeCloseTo(-r, 3);

    const fullPeriod = keplerianElementsToStateVector(
      elements,
      mu,
      epochUt + periodS,
    );
    const { posTol, velTol } = roundTripTolerances(state);
    assertStateCloseTo(fullPeriod, state, posTol, velTol);
  });
});

describe('stateVectorToKeplerianElements: singular-case canonical output', () => {
  const mu = 3.986e14;

  it('zeroes argument of periapsis for a circular, inclined orbit', () => {
    const r = 7_000_000;
    const vCircular = Math.sqrt(mu / r);
    const elements = stateVectorToKeplerianElements(
      {
        positionM: [r, 0, 0],
        velocityMPerS: [0, vCircular * Math.SQRT1_2, -vCircular * Math.SQRT1_2],
      },
      mu,
      0,
    );
    expect(elements.argumentOfPeriapsisRad).toBe(0);
  });

  it('zeroes longitude of ascending node for a non-circular equatorial orbit', () => {
    const elements = stateVectorToKeplerianElements(
      { positionM: [8_000_000, 0, -1_500_000], velocityMPerS: [900, 0, 6500] },
      mu,
      0,
    );
    expect(elements.longitudeOfAscendingNodeRad).toBe(0);
  });

  it('zeroes both orientation angles for a circular equatorial orbit', () => {
    const r = 7_000_000;
    const vCircular = Math.sqrt(mu / r);
    const elements = stateVectorToKeplerianElements(
      { positionM: [r, 0, 0], velocityMPerS: [0, 0, -vCircular] },
      mu,
      0,
    );
    expect(elements.longitudeOfAscendingNodeRad).toBe(0);
    expect(elements.argumentOfPeriapsisRad).toBe(0);
  });
});

describe('stateVectorToKeplerianElements: published fixture (Curtis, orbital-mechanics.space)', () => {
  // r = (1000, 5000, 7000) km, v = (3, 4, 5) km/s, mu = 3.986e5 km^3/s^2, in the
  // source's Z-up equatorial frame. Published (to the site's own precision):
  // h = 19646.883 km^2/s, i = 124.05 deg, RAAN = 190.62 deg, e = 0.948,
  // omega = 303.09 deg, true anomaly = 159.61 deg. Cross-checked by hand
  // against the eccentricity-vector/node-vector formulas before encoding.
  // Tolerance matches the site's published 2-decimal-degree precision, not
  // the plan's blanket 1e-9 — that tolerance is instead enforced on the
  // round-trip tests above, which don't depend on external reference data.
  const muM3PerS2 = 3.986e5 * 1e9;
  const rZUpKm: Vec3d = [1000, 5000, 7000];
  const vZUpKmPerS: Vec3d = [3, 4, 5];
  const state: IStateVector = {
    positionM: zUpToYUp(rZUpKm).map((c) => c * 1000) as unknown as Vec3d,
    velocityMPerS: zUpToYUp(vZUpKmPerS).map(
      (c) => c * 1000,
    ) as unknown as Vec3d,
  };

  let elements: IKeplerianElements;
  beforeAll(() => {
    elements = stateVectorToKeplerianElements(state, muM3PerS2, 0);
  });

  it('matches published eccentricity', () => {
    expect(elements.eccentricity).toBeCloseTo(0.948, 3);
  });

  it('matches published inclination', () => {
    expect(elements.inclinationRad / DEG).toBeCloseTo(124.05, 1);
  });

  it('matches published longitude of ascending node', () => {
    expect(elements.longitudeOfAscendingNodeRad / DEG).toBeCloseTo(190.62, 1);
  });

  it('matches published argument of periapsis', () => {
    expect(elements.argumentOfPeriapsisRad / DEG).toBeCloseTo(303.09, 1);
  });

  it('round-trips through keplerianElementsToStateVector back to the transformed state', () => {
    const recovered = keplerianElementsToStateVector(elements, muM3PerS2, 0);
    const posErrorM = vec3Length(vec3Sub(recovered.positionM, state.positionM));
    const velErrorMPerS = vec3Length(
      vec3Sub(recovered.velocityMPerS, state.velocityMPerS),
    );
    expect(posErrorM).toBeLessThanOrEqual(
      Math.max(1e-6, vec3Length(state.positionM) * 1e-9),
    );
    expect(velErrorMPerS).toBeLessThanOrEqual(
      Math.max(1e-9, vec3Length(state.velocityMPerS) * 1e-9),
    );
  });
});

describe('stateVectorToKeplerianElements: failure modes', () => {
  const mu = 3.986e14;

  it('rejects a zero position', () => {
    expect(() =>
      stateVectorToKeplerianElements(
        { positionM: [0, 0, 0], velocityMPerS: [1, 0, 0] },
        mu,
        0,
      ),
    ).toThrowError(UnsupportedConicError);
  });

  it('rejects a purely radial (degenerate, zero angular momentum) trajectory', () => {
    expect(() =>
      stateVectorToKeplerianElements(
        { positionM: [7_000_000, 0, 0], velocityMPerS: [500, 0, 0] },
        mu,
        0,
      ),
    ).toThrowError(UnsupportedConicError);
  });

  it('rejects a parabolic state (escape velocity)', () => {
    const r = 7_000_000;
    const vEscape = Math.sqrt((2 * mu) / r);
    expect(() =>
      stateVectorToKeplerianElements(
        { positionM: [r, 0, 0], velocityMPerS: [0, 0, -vEscape] },
        mu,
        0,
      ),
    ).toThrowError(UnsupportedConicError);
  });

  it('rejects a near-parabolic state just above e = 1', () => {
    // e grows roughly like 4x this fractional velocity bump above escape
    // speed for a purely tangential launch, so 1e-10 keeps |e - 1| well
    // inside PARABOLIC_EPSILON (1e-8) while still being strictly above 1.
    const r = 7_000_000;
    const vEscape = Math.sqrt((2 * mu) / r);
    expect(() =>
      stateVectorToKeplerianElements(
        { positionM: [r, 0, 0], velocityMPerS: [0, 0, -vEscape * (1 + 1e-10)] },
        mu,
        0,
      ),
    ).toThrowError(UnsupportedConicError);
  });
});

describe('hyperbolic orbits: round trips and closed-form fixture', () => {
  const mu = 3.986e14;
  const epochUt = 500;

  const cases: { name: string; state: IStateVector }[] = [
    {
      name: 'mildly hyperbolic, equatorial',
      state: {
        positionM: [7_000_000, 0, 0],
        velocityMPerS: [0, 0, -Math.sqrt((3 * mu) / 7_000_000)],
      },
    },
    {
      name: 'strongly hyperbolic, inclined',
      state: {
        // v_esc at this radius is ~27,381 m/s; this velocity is well above it.
        positionM: [1_000_000, 200_000, 300_000],
        velocityMPerS: [-1750, 52500, 14000],
      },
    },
    {
      name: 'hyperbolic, non-equatorial retrograde-ish',
      state: {
        // v_esc at this radius is ~19,761 m/s; this velocity is well above it.
        positionM: [2_000_000, -400_000, 100_000],
        velocityMPerS: [7500, -22500, 20000],
      },
    },
  ];

  for (const { name, state } of cases) {
    it(`round-trips: ${name}`, () => {
      const elements = stateVectorToKeplerianElements(state, mu, epochUt);
      expect(elements.eccentricity).toBeGreaterThan(1);
      expect(elements.semiMajorAxisM).toBeLessThan(0);

      const recovered = keplerianElementsToStateVector(elements, mu, epochUt);
      const rMag = vec3Length(state.positionM);
      const vMag = vec3Length(state.velocityMPerS);
      const posTol = Math.max(1e-6, rMag * 1e-9);
      const velTol = Math.max(1e-9, vMag * 1e-9);
      expect(
        vec3Length(vec3Sub(recovered.positionM, state.positionM)),
      ).toBeLessThanOrEqual(posTol);
      expect(
        vec3Length(vec3Sub(recovered.velocityMPerS, state.velocityMPerS)),
      ).toBeLessThanOrEqual(velTol);
    });
  }

  it('matches a hand-constructed periapsis fixture (every element closed-form checkable)', () => {
    // At periapsis, velocity is purely tangential: v_p = sqrt(mu/|a| * (e+1)/(e-1))
    // for a hyperbola with periapsis radius r_p = a(1-e).
    const e = 1.5;
    const rP = 6_500_000;
    const a = rP / (1 - e); // negative, as expected for a hyperbola
    const vP = Math.sqrt((mu / -a) * ((e + 1) / (e - 1)));
    const state: IStateVector = {
      positionM: [rP, 0, 0],
      velocityMPerS: [0, 0, -vP],
    };

    const elements = stateVectorToKeplerianElements(state, mu, 0);
    expect(elements.semiMajorAxisM).toBeCloseTo(a, 3);
    expect(elements.eccentricity).toBeCloseTo(e, 9);
    expect(elements.meanAnomalyAtEpochRad).toBeCloseTo(0, 9); // periapsis: H = 0

    const recovered = keplerianElementsToStateVector(elements, mu, 0);
    expect(
      vec3Length(vec3Sub(recovered.positionM, state.positionM)),
    ).toBeLessThanOrEqual(1e-3);
    expect(
      vec3Length(vec3Sub(recovered.velocityMPerS, state.velocityMPerS)),
    ).toBeLessThanOrEqual(1e-6);
  });

  it('propagates forward and back through solveHyperbolicAnomaly without wrapping the mean anomaly', () => {
    const state: IStateVector = {
      positionM: [7_000_000, 0, 0],
      velocityMPerS: [0, 0, -Math.sqrt((3 * mu) / 7_000_000)],
    };
    const elements = stateVectorToKeplerianElements(state, mu, 0);

    const laterUt = 10_000;
    const later = keplerianElementsToStateVector(elements, mu, laterUt);
    const backAgain = keplerianElementsToStateVector(elements, mu, 0);

    // Moving forward along a hyperbola strictly increases distance from periapsis-ish region here.
    expect(vec3Length(later.positionM)).toBeGreaterThan(
      vec3Length(state.positionM),
    );
    expect(
      vec3Length(vec3Sub(backAgain.positionM, state.positionM)),
    ).toBeLessThanOrEqual(1e-3);
  });
});
