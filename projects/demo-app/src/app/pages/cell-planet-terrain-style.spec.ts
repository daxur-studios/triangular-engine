import {
  CELL_PLANET_TERRAIN_STYLE_VERSION,
  createCellPlanetTerrainStyleDescriptor,
  isCellPlanetTerrainStyle,
  selectCellPlanetSurfaceSampler,
} from './cell-planet-terrain-style';

describe('cell planet terrain styles', () => {
  it('accepts only the versioned shared style kinds', () => {
    expect(isCellPlanetTerrainStyle('blended')).toBeTrue();
    expect(isCellPlanetTerrainStyle('cell-features')).toBeTrue();
    expect(isCellPlanetTerrainStyle('unknown')).toBeFalse();
    expect(isCellPlanetTerrainStyle(undefined)).toBeFalse();
  });

  it('creates a serializable descriptor for worker and route identity', () => {
    expect(createCellPlanetTerrainStyleDescriptor('cell-features')).toEqual({
      version: CELL_PLANET_TERRAIN_STYLE_VERSION,
      kind: 'cell-features',
    });
  });

  it('routes the two styles to different shared samplers', () => {
    const baseSampler = { sample: jasmine.createSpy('base') } as never;
    const featureSampler = { sample: jasmine.createSpy('shaped') } as never;
    const cellFeatureSampler = { sample: jasmine.createSpy('cell') } as never;
    const world = { baseSampler, featureSampler, cellFeatureSampler } as never;

    expect(selectCellPlanetSurfaceSampler(world, 'blended', true)).toBe(featureSampler);
    expect(selectCellPlanetSurfaceSampler(world, 'cell-features', true)).toBe(cellFeatureSampler);
    expect(selectCellPlanetSurfaceSampler(world, 'cell-features', false)).toBe(baseSampler);
  });
});
