import { ICelestialBody } from '../bodies/celestial-body';
import { HOME_MOON, HOME_PLANET } from '../bodies/stock-bodies';
import { Vec3d, vec3Length, vec3Sub } from '../math/vec3';
import { bodyWorldStateAt } from './ephemeris';
import { librationPointWorldStateAt } from './libration';
import { KeplerianOrbitPropagator } from './propagator';

const propagator = new KeplerianOrbitPropagator();
const bodies: readonly ICelestialBody[] = [HOME_PLANET, HOME_MOON];

/** `omega² * s - mu1*sign(s-s1)/(s-s1)² - mu2*sign(s-s2)/(s-s2)² == 0` — the defining rotating-frame equilibrium a genuine collinear point must satisfy, evaluated independently of `librationPointWorldStateAt`'s own solver. */
function collinearResidual(
  positionM: Vec3d,
  primaryPositionM: Vec3d,
  secondaryPositionM: Vec3d,
  primaryMuM3PerS2: number,
  secondaryMuM3PerS2: number,
): number {
  const axisM = vec3Sub(secondaryPositionM, primaryPositionM);
  const distanceM = vec3Length(axisM);
  const axis: Vec3d = [
    axisM[0] / distanceM,
    axisM[1] / distanceM,
    axisM[2] / distanceM,
  ];
  const totalMu = primaryMuM3PerS2 + secondaryMuM3PerS2;
  const massRatio = secondaryMuM3PerS2 / totalMu;
  const s1 = -massRatio * distanceM;
  const s2 = (1 - massRatio) * distanceM;
  const omegaSquared = totalMu / distanceM ** 3;

  // Project positionM onto the primary->secondary axis to recover its 1D coordinate s.
  const relM = vec3Sub(positionM, primaryPositionM);
  const s = relM[0] * axis[0] + relM[1] * axis[1] + relM[2] * axis[2] + s1;

  const u = s - s1;
  const w = s - s2;
  const f =
    omegaSquared * s -
    (primaryMuM3PerS2 * Math.sign(u)) / (u * u) -
    (secondaryMuM3PerS2 * Math.sign(w)) / (w * w);
  // Normalize by the acceleration scale (omega^2 * distanceM) so the residual is dimensionless and comparable across mass ratios.
  return Math.abs(f) / (omegaSquared * distanceM);
}

describe('librationPointWorldStateAt', () => {
  const ut = 0; // HOME_MOON's meanAnomalyAtEpochRad is 0, so at ut=0 it sits on the +X axis relative to HOME_PLANET.

  for (const point of ['L1', 'L2', 'L3'] as const) {
    it(`places ${point} on the primary-secondary line satisfying the rotating-frame equilibrium`, () => {
      const { positionM } = librationPointWorldStateAt(
        bodies,
        HOME_PLANET.id,
        HOME_MOON.id,
        point,
        ut,
        propagator,
      );
      const primaryState = bodyWorldStateAt(
        bodies,
        HOME_PLANET.id,
        ut,
        propagator,
      );
      const secondaryState = bodyWorldStateAt(
        bodies,
        HOME_MOON.id,
        ut,
        propagator,
      );

      const residual = collinearResidual(
        positionM,
        primaryState.positionM,
        secondaryState.positionM,
        HOME_PLANET.muM3PerS2,
        HOME_MOON.muM3PerS2,
      );
      expect(residual).toBeLessThan(1e-9);

      // Collinear per construction, but confirm the off-axis components are exactly zero (equatorial circular orbit -> Y/Z stay at the planet's own values).
      expect(positionM[1]).toBeCloseTo(primaryState.positionM[1], 6);
      expect(positionM[2]).toBeCloseTo(primaryState.positionM[2], 6);
    });
  }

  it('places L1 between the two bodies and L2 beyond the secondary, both near the Hill-radius estimate', () => {
    const primaryState = bodyWorldStateAt(
      bodies,
      HOME_PLANET.id,
      ut,
      propagator,
    );
    const secondaryState = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      ut,
      propagator,
    );
    const distanceM = vec3Length(
      vec3Sub(secondaryState.positionM, primaryState.positionM),
    );
    const massRatio =
      HOME_MOON.muM3PerS2 / (HOME_PLANET.muM3PerS2 + HOME_MOON.muM3PerS2);
    const hillRadiusM = distanceM * Math.cbrt(massRatio / 3);

    const l1 = librationPointWorldStateAt(
      bodies,
      HOME_PLANET.id,
      HOME_MOON.id,
      'L1',
      ut,
      propagator,
    );
    const l2 = librationPointWorldStateAt(
      bodies,
      HOME_PLANET.id,
      HOME_MOON.id,
      'L2',
      ut,
      propagator,
    );

    const l1DistanceFromMoonM = vec3Length(
      vec3Sub(l1.positionM, secondaryState.positionM),
    );
    const l2DistanceFromMoonM = vec3Length(
      vec3Sub(l2.positionM, secondaryState.positionM),
    );

    // Cube-root Hill estimate is a leading-order approximation, not exact -- loose bound is intentional.
    expect(l1DistanceFromMoonM).toBeGreaterThan(hillRadiusM * 0.8);
    expect(l1DistanceFromMoonM).toBeLessThan(hillRadiusM * 1.2);
    expect(l2DistanceFromMoonM).toBeGreaterThan(hillRadiusM * 0.8);
    expect(l2DistanceFromMoonM).toBeLessThan(hillRadiusM * 1.2);

    // L1 sits closer to the planet than the moon does; L2 sits farther.
    const planetDistanceM = (p: Vec3d) =>
      vec3Length(vec3Sub(p, primaryState.positionM));
    expect(planetDistanceM(l1.positionM)).toBeLessThan(distanceM);
    expect(planetDistanceM(l2.positionM)).toBeGreaterThan(distanceM);
  });

  it('places L3 beyond the primary, on the far side from the secondary', () => {
    const primaryState = bodyWorldStateAt(
      bodies,
      HOME_PLANET.id,
      ut,
      propagator,
    );
    const secondaryState = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      ut,
      propagator,
    );
    const l3 = librationPointWorldStateAt(
      bodies,
      HOME_PLANET.id,
      HOME_MOON.id,
      'L3',
      ut,
      propagator,
    );

    // secondary is at +X from primary (ut=0); L3 must be at negative X relative to the primary.
    expect(l3.positionM[0]).toBeLessThan(primaryState.positionM[0]);
    // ...and roughly the same distance from the primary as the primary-secondary separation (small-mass-ratio asymptote).
    const distanceM = vec3Length(
      vec3Sub(secondaryState.positionM, primaryState.positionM),
    );
    const l3DistanceFromPrimaryM = vec3Length(
      vec3Sub(l3.positionM, primaryState.positionM),
    );
    expect(l3DistanceFromPrimaryM).toBeGreaterThan(distanceM * 0.9);
    expect(l3DistanceFromPrimaryM).toBeLessThan(distanceM * 1.2);
  });

  for (const point of ['L4', 'L5'] as const) {
    it(`${point} forms an exact equilateral triangle with the primary and secondary`, () => {
      const primaryState = bodyWorldStateAt(
        bodies,
        HOME_PLANET.id,
        ut,
        propagator,
      );
      const secondaryState = bodyWorldStateAt(
        bodies,
        HOME_MOON.id,
        ut,
        propagator,
      );
      const distanceM = vec3Length(
        vec3Sub(secondaryState.positionM, primaryState.positionM),
      );

      const { positionM } = librationPointWorldStateAt(
        bodies,
        HOME_PLANET.id,
        HOME_MOON.id,
        point,
        ut,
        propagator,
      );

      const distanceFromPrimaryM = vec3Length(
        vec3Sub(positionM, primaryState.positionM),
      );
      const distanceFromSecondaryM = vec3Length(
        vec3Sub(positionM, secondaryState.positionM),
      );
      expect(distanceFromPrimaryM).toBeCloseTo(distanceM, 3);
      expect(distanceFromSecondaryM).toBeCloseTo(distanceM, 3);
    });
  }

  it('L4 and L5 sit on opposite sides of the primary-secondary line', () => {
    const l4 = librationPointWorldStateAt(
      bodies,
      HOME_PLANET.id,
      HOME_MOON.id,
      'L4',
      ut,
      propagator,
    );
    const l5 = librationPointWorldStateAt(
      bodies,
      HOME_PLANET.id,
      HOME_MOON.id,
      'L5',
      ut,
      propagator,
    );
    // Equatorial orbit (Y=0 plane is X/Z here per HOME_PLANET's inclination 0) -> the two points mirror across the orbital plane's normal axis, opposite Z sign.
    expect(Math.sign(l4.positionM[2])).not.toBe(Math.sign(l5.positionM[2]));
  });

  it('tracks the moon through time: distance from each L-point to the moon stays constant while the moon orbits', () => {
    const secondaryStateAtEpoch = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      0,
      propagator,
    );
    const distanceAtEpoch: Record<string, number> = {};
    for (const point of ['L1', 'L2', 'L4', 'L5'] as const) {
      const { positionM } = librationPointWorldStateAt(
        bodies,
        HOME_PLANET.id,
        HOME_MOON.id,
        point,
        0,
        propagator,
      );
      distanceAtEpoch[point] = vec3Length(
        vec3Sub(positionM, secondaryStateAtEpoch.positionM),
      );
    }

    const laterUt = 3600; // an hour later; HOME_MOON's period is ~38.6 h so this is a real fraction of an orbit
    const secondaryStateLater = bodyWorldStateAt(
      bodies,
      HOME_MOON.id,
      laterUt,
      propagator,
    );
    for (const point of ['L1', 'L2', 'L4', 'L5'] as const) {
      const { positionM } = librationPointWorldStateAt(
        bodies,
        HOME_PLANET.id,
        HOME_MOON.id,
        point,
        laterUt,
        propagator,
      );
      const distanceLater = vec3Length(
        vec3Sub(positionM, secondaryStateLater.positionM),
      );
      expect(distanceLater).toBeCloseTo(distanceAtEpoch[point], 0);
    }
  });

  it('throws for a coincident primary/secondary pair', () => {
    expect(() =>
      librationPointWorldStateAt(
        bodies,
        HOME_PLANET.id,
        HOME_PLANET.id,
        'L1',
        ut,
        propagator,
      ),
    ).toThrowError();
  });
});
