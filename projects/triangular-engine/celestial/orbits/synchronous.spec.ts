import { ICelestialBody } from '../bodies/celestial-body';
import { HOME_MOON, HOME_PLANET, SUN } from '../bodies/stock-bodies';
import { synchronousOrbitRadiusM, synchronousOrbitStatus } from './synchronous';

describe('synchronous orbits', () => {
  it('returns null for a body without rotation period or zero rotation', () => {
    const nonRotatingBody: ICelestialBody = {
      ...HOME_MOON,
      rotationPeriodS: undefined,
    };
    expect(synchronousOrbitRadiusM(nonRotatingBody)).toBeNull();
    const status = synchronousOrbitStatus(nonRotatingBody);
    expect(status.isValid).toBeFalse();
    expect(status.reason).toBe('no-rotation');
  });

  it('computes correct synchronous radius for HOME_PLANET', () => {
    const rSync = synchronousOrbitRadiusM(HOME_PLANET);
    expect(rSync).not.toBeNull();
    // Theoretical: cbrt(3.5316e12 * 86400^2 / (4*pi^2)) ≈ 8_740_704 m
    expect(rSync!).toBeCloseTo(8_740_704, 0);

    const status = synchronousOrbitStatus(HOME_PLANET, SUN);
    expect(status.isValid).toBeTrue();
    expect(status.radiusM).toBeCloseTo(8_740_704, 0);
    expect(status.altitudeM).toBeCloseTo(8_740_704 - HOME_PLANET.radiusM, 0);
  });

  it('flags synchronous orbit as inside-body for an ultra-fast rotator', () => {
    const fastRotator: ICelestialBody = {
      id: 'fast-planet',
      kind: 'planet',
      radiusM: 1_000_000,
      muM3PerS2: 1e10,
      rotationPeriodS: 10,
    };
    const status = synchronousOrbitStatus(fastRotator);
    expect(status.isValid).toBeFalse();
    expect(status.reason).toBe('inside-body');
  });

  it('flags synchronous orbit as inside-atmosphere if altitude is below topAltitudeM', () => {
    const atmoPlanet: ICelestialBody = {
      id: 'atmo-planet',
      kind: 'planet',
      radiusM: 600_000,
      muM3PerS2: 3.5316e12,
      rotationPeriodS: 1_600, // r_sync ≈ 611,885m -> altitude ≈ 11,885m < 70,000m
      atmosphere: {
        seaLevelDensityKgM3: 1.2,
        scaleHeightM: 5000,
        topAltitudeM: 70_000,
      },
    };
    const status = synchronousOrbitStatus(atmoPlanet);
    expect(status.isValid).toBeFalse();
    expect(status.reason).toBe('inside-atmosphere');
  });

  it('flags synchronous orbit as outside-soi for slow rotator close to parent', () => {
    const slowMoon: ICelestialBody = {
      ...HOME_MOON,
      rotationPeriodS: 500_000, // Very slow rotation -> huge r_sync outside SOI
    };
    const status = synchronousOrbitStatus(slowMoon, HOME_PLANET);
    expect(status.isValid).toBeFalse();
    expect(status.reason).toBe('outside-soi');
  });
});
