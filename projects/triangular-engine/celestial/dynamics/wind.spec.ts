import { ICelestialBody } from '../bodies/celestial-body';
import { Vec3d, vec3Length } from '../math/vec3';
import { windAt } from './wind';

describe('windAt', () => {
  const calmBody: ICelestialBody = {
    id: 'calm-test',
    kind: 'planet',
    radiusM: 600_000,
    muM3PerS2: 1e14,
  };
  const windyBody: ICelestialBody = { ...calmBody, windScaleMPerS: 40 };
  const windyBodyWithAtmosphere: ICelestialBody = {
    ...windyBody,
    atmosphere: {
      seaLevelDensityKgM3: 1.225,
      scaleHeightM: 5_000,
      topAltitudeM: 70_000,
    },
  };

  const midLatitudeDir: Vec3d = [
    Math.cos(Math.PI / 6),
    Math.sin(Math.PI / 6),
    0,
  ]; // 30 deg N
  const equatorDir: Vec3d = [1, 0, 0];
  const northPoleDir: Vec3d = [0, 1, 0];

  it('is exactly zero when windScaleMPerS is absent (default), matching pre-W1 behavior', () => {
    expect(windAt(calmBody, midLatitudeDir, 10_000, 0)).toEqual([0, 0, 0]);
  });

  it('is zero inside the surface boundary layer even when wind is enabled', () => {
    expect(windAt(windyBody, midLatitudeDir, 200, 0)).toEqual([0, 0, 0]);
  });

  it('ramps up between the boundary layer and full-strength altitude', () => {
    const low = vec3Length(windAt(windyBody, midLatitudeDir, 2_000, 0));
    const high = vec3Length(windAt(windyBody, midLatitudeDir, 9_000, 0));
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('caps altitude scaling at 1 above the full-strength altitude (no unbounded growth)', () => {
    const atFullStrength = vec3Length(
      windAt(windyBody, midLatitudeDir, 9_000, 0),
    );
    const wayAboveIt = vec3Length(windAt(windyBody, midLatitudeDir, 50_000, 0));
    expect(wayAboveIt).toBeCloseTo(atFullStrength, 6);
  });

  it('always returns a full 3D vector with a vertical component (0 for W1)', () => {
    const wind = windAt(windyBody, equatorDir, 9_000, 0);
    expect(wind.length).toBe(3);
    expect(wind[1]).toBe(0);
  });

  it('degenerates to zero at the poles, where "eastward" is undefined', () => {
    expect(windAt(windyBody, northPoleDir, 9_000, 0)).toEqual([0, 0, 0]);
  });

  it('blows perpendicular to the local pole/radial plane (purely zonal, no radial component)', () => {
    const wind = windAt(windyBody, equatorDir, 9_000, 0);
    // Radial (outward) component should be ~0: wind is tangent to the sphere.
    const radialComponent =
      wind[0] * equatorDir[0] +
      wind[1] * equatorDir[1] +
      wind[2] * equatorDir[2];
    expect(radialComponent).toBeCloseTo(0, 9);
  });

  it('never exceeds windScaleMPerS in magnitude', () => {
    for (const t of [0, 10_000, 200_000, 999_999]) {
      const speed = vec3Length(windAt(windyBody, midLatitudeDir, 20_000, t));
      expect(speed).toBeLessThanOrEqual(windyBody.windScaleMPerS! + 1e-9);
    }
  });

  it('fades back to zero above the atmosphere top altitude, e.g. in orbit', () => {
    const atFullStrength = vec3Length(
      windAt(windyBodyWithAtmosphere, midLatitudeDir, 9_000, 0),
    );
    const atTopAltitude = vec3Length(
      windAt(windyBodyWithAtmosphere, midLatitudeDir, 70_000, 0),
    );
    const inLeo = vec3Length(
      windAt(windyBodyWithAtmosphere, midLatitudeDir, 200_000, 0),
    );
    expect(atFullStrength).toBeGreaterThan(0);
    expect(atTopAltitude).toBe(0);
    expect(inLeo).toBe(0);
  });
});
