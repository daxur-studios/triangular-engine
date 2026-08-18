import { ICelestialBody } from '../bodies/celestial-body';
import { vec3Length } from '../math/vec3';
import { airDensity, dragForce } from './atmosphere';

const BODY: ICelestialBody = {
  id: 'test-planet',
  kind: 'planet',
  radiusM: 1000,
  muM3PerS2: 1,
  atmosphere: {
    seaLevelDensityKgM3: 1.2,
    scaleHeightM: 5000,
    topAltitudeM: 70_000,
  },
};

const VACUUM_BODY: ICelestialBody = {
  id: 'vacuum',
  kind: 'planet',
  radiusM: 1000,
  muM3PerS2: 1,
};

describe('airDensity', () => {
  it('equals sea-level density at altitude 0', () => {
    expect(airDensity(BODY, 0)).toBeCloseTo(1.2, 9);
  });

  it('falls by a factor of e at one scale height', () => {
    expect(airDensity(BODY, 5000)).toBeCloseTo(1.2 / Math.E, 9);
  });

  it('is 0 above the top altitude', () => {
    expect(airDensity(BODY, 70_000)).toBe(0);
    expect(airDensity(BODY, 100_000)).toBe(0);
  });

  it('is 0 for a body with no atmosphere', () => {
    expect(airDensity(VACUUM_BODY, 0)).toBe(0);
  });
});

describe('dragForce', () => {
  it('opposes velocity with magnitude 0.5·ρ·v²·Cd·A', () => {
    const velocity: [number, number, number] = [100, 0, 0];
    const force = dragForce(BODY, 0, velocity, 2, 0.5);

    const expectedMagnitude = 0.5 * 1.2 * 100 * 100 * 0.5 * 2;
    expect(vec3Length(force)).toBeCloseTo(expectedMagnitude, 6);
    expect(force[0]).toBeCloseTo(-expectedMagnitude, 6);
  });

  it('is zero in vacuum', () => {
    const force = dragForce(BODY, 100_000, [100, 0, 0], 2, 0.5);
    expect(vec3Length(force)).toBe(0);
  });

  it('is zero at zero velocity', () => {
    const force = dragForce(BODY, 0, [0, 0, 0], 2, 0.5);
    expect(vec3Length(force)).toBe(0);
  });
});
