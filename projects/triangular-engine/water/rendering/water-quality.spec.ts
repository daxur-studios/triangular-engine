import { WATER_TIER_GRID_DEFAULTS, waterTierDefines } from './water-quality';

describe('water quality tiers', () => {
  it('only enables expensive capabilities on tiers that support them', () => {
    expect(waterTierDefines('low')['WATER_GERSTNER']).toBeUndefined();
    expect(waterTierDefines('medium')['WATER_GERSTNER']).toBe(1);
    expect(waterTierDefines('medium')['WATER_DETAIL_CASCADES']).toBe(1);
    expect(waterTierDefines('medium')['WATER_GLINT']).toBeUndefined();
    expect(waterTierDefines('high')['WATER_GLINT']).toBe(1);
  });

  it('increases the vertex budget monotonically', () => {
    const vertexBudget = (tier: 'low' | 'medium' | 'high') => {
      const grid = WATER_TIER_GRID_DEFAULTS[tier];
      return (
        grid.patchResolution *
        grid.patchResolution *
        grid.coreSizePatches *
        grid.coreSizePatches
      );
    };

    expect(vertexBudget('medium')).toBeGreaterThan(vertexBudget('low'));
    expect(vertexBudget('high')).toBeGreaterThan(vertexBudget('medium'));
  });
});
