import { IKeplerianElements } from './kepler-elements';
import { orbitApsides, orbitalPeriod } from './apsides';

function elements(overrides: Partial<IKeplerianElements>): IKeplerianElements {
  return {
    semiMajorAxisM: 7_000_000,
    eccentricity: 0,
    inclinationRad: 0,
    longitudeOfAscendingNodeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochUt: 0,
    ...overrides,
  };
}

describe('orbitApsides', () => {
  it('reports equal apoapsis/periapsis for a circular orbit', () => {
    const { periapsisM, apoapsisM } = orbitApsides(
      elements({ eccentricity: 0 }),
    );
    expect(periapsisM).toBeCloseTo(7_000_000, 6);
    expect(apoapsisM).toBeCloseTo(7_000_000, 6);
  });

  it('computes periapsis/apoapsis as a(1-e) and a(1+e)', () => {
    const { periapsisM, apoapsisM } = orbitApsides(
      elements({ semiMajorAxisM: 10_000_000, eccentricity: 0.5 }),
    );
    expect(periapsisM).toBeCloseTo(5_000_000, 3);
    expect(apoapsisM).toBeCloseTo(15_000_000, 3);
  });
});

describe('orbitalPeriod', () => {
  it('matches Kepler’s third law for Earth-like mu at a known altitude', () => {
    const mu = 3.986e14;
    const a = 7_000_000;
    const periodS = orbitalPeriod(elements({ semiMajorAxisM: a }), mu);
    expect(periodS).toBeCloseTo(2 * Math.PI * Math.sqrt(a ** 3 / mu), 6);
  });

  it('scales with a^(3/2)', () => {
    const mu = 3.986e14;
    const shortPeriod = orbitalPeriod(
      elements({ semiMajorAxisM: 7_000_000 }),
      mu,
    );
    const longPeriod = orbitalPeriod(
      elements({ semiMajorAxisM: 7_000_000 * 4 }),
      mu,
    );
    expect(longPeriod / shortPeriod).toBeCloseTo(4 ** 1.5, 6);
  });
});

describe('orbitApsides / orbitalPeriod: hyperbolic (e >= 1)', () => {
  const mu = 3.986e14;

  it('reports a finite periapsis but Infinity apoapsis for a hyperbolic orbit', () => {
    const { periapsisM, apoapsisM } = orbitApsides(
      elements({ semiMajorAxisM: -1_000_000, eccentricity: 2 }),
    );
    expect(periapsisM).toBeCloseTo(-1_000_000 * (1 - 2), 6);
    expect(apoapsisM).toBe(Infinity);
  });

  it('reports Infinity orbital period for a hyperbolic orbit', () => {
    const periodS = orbitalPeriod(
      elements({ semiMajorAxisM: -1_000_000, eccentricity: 2 }),
      mu,
    );
    expect(periodS).toBe(Infinity);
  });

  it('reports Infinity apoapsis/period exactly at the parabolic boundary (e = 1)', () => {
    const { apoapsisM } = orbitApsides(
      elements({ semiMajorAxisM: -1_000_000, eccentricity: 1 }),
    );
    expect(apoapsisM).toBe(Infinity);
    expect(
      orbitalPeriod(
        elements({ semiMajorAxisM: -1_000_000, eccentricity: 1 }),
        mu,
      ),
    ).toBe(Infinity);
  });
});
