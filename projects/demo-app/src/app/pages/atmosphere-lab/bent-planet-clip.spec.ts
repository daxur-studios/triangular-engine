import { MAX_FAR_OVER_NEAR, bentPlanetClipPlanes } from './bent-planet-clip';

const UNIT_M = 6_371_000 / 1000;
const ALTITUDES_M = [0.5, 2, 85, 381, 1_700, 5_000, 25_000, 400_000, 1_000_000, 19_113_000, 6_371_000_000];

/** `w` of `projectionMatrixInverse * (x, y, 1, 1)` as float32 holds it: the two terms are rounded before they are added. */
function rebuiltW(near: number, far: number): { exact: number; float32: number } {
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  return { exact: 1 / d + c / d, float32: Math.fround(Math.fround(1 / d) + Math.fround(c / d)) };
}

describe('bent planet clip planes', () => {
  it('keeps far / near inside what float32 holds at every altitude', () => {
    for (const altitudeM of ALTITUDES_M) {
      const { near, far } = bentPlanetClipPlanes(altitudeM / UNIT_M);
      expect(far / near).withContext(`${altitudeM} m`).toBeLessThanOrEqual(MAX_FAR_OVER_NEAR * 1.0000001);
      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(near);
    }
  });

  it('rebuilds a ray with a positive, close depth term down to 2 m (it was exactly 0 below a few hundred metres)', () => {
    for (const altitudeM of ALTITUDES_M) {
      const { near, far } = bentPlanetClipPlanes(altitudeM / UNIT_M);
      const { exact, float32 } = rebuiltW(near, far);
      expect(float32).withContext(`${altitudeM} m`).toBeGreaterThan(0);
      expect(Math.abs(float32 - exact) / exact).withContext(`${altitudeM} m`).toBeLessThan(0.1);
    }
  });

  it('reproduces the failure the cap removes: the old fixed far leaves w at 0 at 2 m', () => {
    const near = Math.min(1, Math.max(1e-4, (2 / UNIT_M) * 0.05));
    expect(rebuiltW(near, 1e5).float32).toBe(0);
  });

  it('still reaches well past the horizon, which is all the ground mesh needs', () => {
    for (const altitudeM of ALTITUDES_M.filter((value) => value <= 1_000_000)) {
      const altitude = altitudeM / UNIT_M;
      const horizon = Math.sqrt(2 * 1000 * altitude + altitude * altitude);
      expect(bentPlanetClipPlanes(altitude).far).withContext(`${altitudeM} m`).toBeGreaterThan(horizon * 10);
    }
  });
});
