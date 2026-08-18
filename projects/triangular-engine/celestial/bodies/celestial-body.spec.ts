import { muForSurfaceGravity } from './celestial-body';

describe('muForSurfaceGravity', () => {
  it('derives mu such that mu / radius^2 reproduces the target surface gravity', () => {
    const radiusM = 600_000;
    const surfaceGravityMPerS2 = 9.81;
    const mu = muForSurfaceGravity(radiusM, surfaceGravityMPerS2);
    expect(mu / (radiusM * radiusM)).toBeCloseTo(surfaceGravityMPerS2, 9);
  });

  it('matches HOME_PLANET’s historical hand-picked constant exactly', () => {
    expect(muForSurfaceGravity(600_000, 9.81)).toBeCloseTo(3.5316e12, 6);
  });

  it('scales linearly with surface gravity for a fixed radius', () => {
    const radiusM = 200_000;
    const mu1 = muForSurfaceGravity(radiusM, 1.63);
    const mu2 = muForSurfaceGravity(radiusM, 3.26);
    expect(mu2 / mu1).toBeCloseTo(2, 9);
  });
});
