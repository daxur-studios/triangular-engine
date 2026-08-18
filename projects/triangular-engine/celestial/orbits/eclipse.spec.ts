import { celestialOcclusion } from './eclipse';

describe('celestialOcclusion', () => {
  const source = { bodyId: 'star', centerM: [100, 0, 0] as const, radiusM: 10 };

  it('returns full visibility without an occluder', () => {
    expect(celestialOcclusion([0, 0, 0], source, []).visibleFraction01).toBe(1);
  });

  it('returns zero for a larger centered foreground occluder', () => {
    const state = celestialOcclusion([0, 0, 0], source, [
      { bodyId: 'planet', centerM: [50, 0, 0], radiusM: 20 },
    ]);
    expect(state.visibleFraction01).toBe(0);
  });

  it('returns partial visibility for a centered smaller occluder', () => {
    const state = celestialOcclusion([0, 0, 0], source, [
      { bodyId: 'moon', centerM: [50, 0, 0], radiusM: 2.5 },
    ]);
    expect(state.visibleFraction01).toBeCloseTo(0.7506270935, 6);
  });

  it('ignores occluders behind the source', () => {
    const state = celestialOcclusion([0, 0, 0], source, [
      { bodyId: 'behind', centerM: [150, 0, 0], radiusM: 100 },
    ]);
    expect(state.visibleFraction01).toBe(1);
  });

  it('clamps combined coverage for multiple occluders', () => {
    const state = celestialOcclusion([0, 0, 0], source, [
      { bodyId: 'a', centerM: [50, 0, 0], radiusM: 20 },
      { bodyId: 'b', centerM: [50, 0, 0], radiusM: 20 },
    ]);
    expect(state.visibleFraction01).toBe(0);
  });
});
