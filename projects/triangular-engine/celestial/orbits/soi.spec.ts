import { ICelestialBody } from '../bodies/celestial-body';
import { HOME_MOON, HOME_PLANET, SUN } from '../bodies/stock-bodies';
import { Vec3d } from '../math/vec3';
import { KeplerianOrbitPropagator } from './propagator';
import { primaryBodyAt, soiRadiusM } from './soi';

describe('soiRadiusM', () => {
  it('matches r_SOI = a * (mu_body / mu_parent)^(2/5) for HOME_MOON around HOME_PLANET', () => {
    const expected =
      HOME_MOON.orbit!.semiMajorAxisM *
      Math.pow(HOME_MOON.muM3PerS2 / HOME_PLANET.muM3PerS2, 2 / 5);
    expect(soiRadiusM(HOME_MOON, HOME_PLANET)).toBeCloseTo(expected, 3);
    // Sanity-check the ballpark named in the plan (~2.43e6 m).
    expect(soiRadiusM(HOME_MOON, HOME_PLANET)).toBeGreaterThan(2e6);
    expect(soiRadiusM(HOME_MOON, HOME_PLANET)).toBeLessThan(3e6);
  });

  it('throws for a body with no orbit', () => {
    expect(() => soiRadiusM(SUN, SUN)).toThrowError();
  });
});

describe('primaryBodyAt', () => {
  const propagator = new KeplerianOrbitPropagator();
  const bodies = [HOME_PLANET, HOME_MOON];

  it('falls back to the root body far from every child SOI', () => {
    const farAway: Vec3d = [1_000_000, 0, 0]; // well inside HOME_PLANET's own domain, far from the moon at ut=0
    expect(primaryBodyAt(bodies, farAway, 0, propagator).id).toBe(
      HOME_PLANET.id,
    );
  });

  it('returns the moon for a position inside its SOI at ut = 0 (moon at +X)', () => {
    const moonPositionM = HOME_MOON.orbit!.semiMajorAxisM;
    const soi = soiRadiusM(HOME_MOON, HOME_PLANET);
    const insideMoonSoi: Vec3d = [moonPositionM - soi * 0.5, 0, 0];
    expect(primaryBodyAt(bodies, insideMoonSoi, 0, propagator).id).toBe(
      HOME_MOON.id,
    );
  });

  it('flips exactly at the SOI boundary along the planet-moon line', () => {
    const moonPositionM = HOME_MOON.orbit!.semiMajorAxisM;
    const soi = soiRadiusM(HOME_MOON, HOME_PLANET);

    const justInside: Vec3d = [moonPositionM - soi * 1.0000001, 0, 0];
    const justOutside: Vec3d = [moonPositionM - soi * 0.9999999, 0, 0];

    expect(primaryBodyAt(bodies, justInside, 0, propagator).id).toBe(
      HOME_PLANET.id,
    );
    expect(primaryBodyAt(bodies, justOutside, 0, propagator).id).toBe(
      HOME_MOON.id,
    );
  });

  it('throws when no root body exists in the given set', () => {
    const noRoot: ICelestialBody[] = [];
    expect(() =>
      primaryBodyAt(noRoot, [0, 0, 0], 0, propagator),
    ).toThrowError();
  });
});
