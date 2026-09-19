import {
  CELL_PLANET_TERRAIN_STYLE_VERSION,
  createCellPlanetTerrainStyleDescriptor,
  isCellPlanetTerrainStyle,
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
});
