import {
  HOME_MOON,
  HOME_PLANET,
  STATIONARY_TEST_MOON,
  STOCK_BODIES,
} from '../bodies/stock-bodies';
import { vec3Length, vec3Sub } from '../math/vec3';
import { bodyWorldStateAt, relativeStateTo } from './ephemeris';
import { KeplerianOrbitPropagator } from './propagator';

describe('bodyWorldStateAt', () => {
  const propagator = new KeplerianOrbitPropagator();
  const bodies = [HOME_PLANET, HOME_MOON];

  it('returns zeros for the root body at any ut', () => {
    expect(bodyWorldStateAt(bodies, HOME_PLANET.id, 0, propagator)).toEqual({
      positionM: [0, 0, 0],
      velocityMPerS: [0, 0, 0],
    });
    expect(
      bodyWorldStateAt(bodies, HOME_PLANET.id, 123456, propagator),
    ).toEqual({
      positionM: [0, 0, 0],
      velocityMPerS: [0, 0, 0],
    });
  });

  it('places the moon at its periapsis direction (+X) at ut = epoch, scaled by its semi-major axis', () => {
    const state = bodyWorldStateAt(bodies, HOME_MOON.id, 0, propagator);
    expect(state.positionM[0]).toBeCloseTo(HOME_MOON.orbit!.semiMajorAxisM, 3);
    expect(state.positionM[1]).toBeCloseTo(0, 6);
    expect(state.positionM[2]).toBeCloseTo(0, 6);
  });

  it('places the moon a quarter period later at the in-plane direction (-Z)', () => {
    const a = HOME_MOON.orbit!.semiMajorAxisM;
    const periodS =
      2 * Math.PI * Math.sqrt((a * a * a) / HOME_PLANET.muM3PerS2);
    const state = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      periodS / 4,
      propagator,
    );
    expect(state.positionM[0]).toBeCloseTo(0, 1);
    expect(state.positionM[1]).toBeCloseTo(0, 6);
    expect(state.positionM[2]).toBeCloseTo(-a, 1);
  });

  it('keeps the stationary test moon fixed with zero parent-relative velocity', () => {
    const planetFirst = bodyWorldStateAt(
      STOCK_BODIES,
      HOME_PLANET.id,
      0,
      propagator,
    );
    const first = bodyWorldStateAt(
      STOCK_BODIES,
      STATIONARY_TEST_MOON.id,
      0,
      propagator,
    );
    const relFirst = relativeStateTo(first, planetFirst);

    const planetLater = bodyWorldStateAt(
      STOCK_BODIES,
      HOME_PLANET.id,
      1_000_000,
      propagator,
    );
    const later = bodyWorldStateAt(
      STOCK_BODIES,
      STATIONARY_TEST_MOON.id,
      1_000_000,
      propagator,
    );
    const relLater = relativeStateTo(later, planetLater);

    expect(relFirst).toEqual({
      positionM: STATIONARY_TEST_MOON.fixedPositionRelativeToParentM!,
      velocityMPerS: [0, 0, 0],
    });
    expect(relLater).toEqual(relFirst);
  });

  it('freezes orbital position and clears relative velocity when disableCelestialMovement option is set', () => {
    const frozenState = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      100_000,
      propagator,
      {
        disableCelestialMovement: true,
        frozenUt: 0,
      },
    );
    expect(frozenState.positionM[0]).toBeCloseTo(
      HOME_MOON.orbit!.semiMajorAxisM,
      3,
    );
    expect(frozenState.velocityMPerS).toEqual([0, 0, 0]);
  });

  it('throws for an unknown body id', () => {
    expect(() =>
      bodyWorldStateAt(bodies, 'nonexistent', 0, propagator),
    ).toThrowError();
  });
});

describe('relativeStateTo', () => {
  it('subtracts position and velocity componentwise', () => {
    const state = {
      positionM: [10, 20, 30] as const,
      velocityMPerS: [1, 2, 3] as const,
    };
    const bodyState = {
      positionM: [1, 2, 3] as const,
      velocityMPerS: [0.1, 0.2, 0.3] as const,
    };
    const relative = relativeStateTo(state, bodyState);
    expect(vec3Length(vec3Sub(relative.positionM, [9, 18, 27]))).toBeCloseTo(
      0,
      9,
    );
    expect(
      vec3Length(vec3Sub(relative.velocityMPerS, [0.9, 1.8, 2.7])),
    ).toBeCloseTo(0, 9);
  });
});
