import { celestialShadowAtReceiver } from './celestial-shadow';

describe('celestialShadowAtReceiver', () => {
  it('returns full direct light outside the projected shadow', () => {
    const visibility = celestialShadowAtReceiver(
      [0, 50, 0],
      { bodyId: 'sun', centerM: [100, 0, 0], radiusM: 10 },
      [{ bodyId: 'moon', centerM: [50, 0, 0], radiusM: 5 }],
    );
    expect(visibility).toBe(1);
  });

  it('returns a distinct partial/umbra factor at receiver points', () => {
    const source = {
      bodyId: 'sun',
      centerM: [100, 0, 0] as const,
      radiusM: 10,
    };
    const moon = { bodyId: 'moon', centerM: [50, 0, 0] as const, radiusM: 8 };
    const centre = celestialShadowAtReceiver([0, 0, 0], source, [moon]);
    const edge = celestialShadowAtReceiver([0, 7, 0], source, [moon]);
    expect(centre).toBeLessThan(edge);
    expect(centre).toBeGreaterThanOrEqual(0);
    expect(edge).toBeLessThanOrEqual(1);
  });

  it('supports multiple arbitrary occluders without body-specific branches', () => {
    const visibility = celestialShadowAtReceiver(
      [0, 0, 0],
      { bodyId: 'star-a', centerM: [100, 0, 0], radiusM: 10 },
      [
        { bodyId: 'io', centerM: [50, 0, 0], radiusM: 4 },
        { bodyId: 'ganymede', centerM: [50, 3, 0], radiusM: 4 },
      ],
    );
    expect(visibility).toBeGreaterThanOrEqual(0);
    expect(visibility).toBeLessThanOrEqual(1);
  });
});
