import { convertToParamMap } from '@angular/router';
import { readCellPlanetQuery, CELL_PLANET_QUERY_KEYS } from './cell-planet-view-query';

describe('cell-planet-view-query', () => {
  it('should include all reciprocal query keys', () => {
    expect(CELL_PLANET_QUERY_KEYS).toContain('globeHeightScale');
    expect(CELL_PLANET_QUERY_KEYS).toContain('seabedRelief');
    expect(CELL_PLANET_QUERY_KEYS).toContain('showOcean');
    expect(CELL_PLANET_QUERY_KEYS).toContain('cellCount');
    expect(CELL_PLANET_QUERY_KEYS).toContain('seed');
    expect(CELL_PLANET_QUERY_KEYS).toContain('relaxation');
    expect(CELL_PLANET_QUERY_KEYS).toContain('worldProfile');
    expect(CELL_PLANET_QUERY_KEYS).toContain('fillMode');
    expect(CELL_PLANET_QUERY_KEYS).toContain('waterLevel');
  });

  it('should read params accurately from param map', () => {
    const params = convertToParamMap({
      cellCount: '1500',
      seed: '1',
      relaxation: '2',
      worldProfile: 'terran',
      fillMode: 'biome',
      waterLevel: '0',
      globeHeightScale: '0.3',
      seabedRelief: 'true',
      showOcean: 'false',
    });

    const query = readCellPlanetQuery(params);
    expect(query.cellCount).toBe('1500');
    expect(query.seed).toBe('1');
    expect(query.relaxation).toBe('2');
    expect(query.worldProfile).toBe('terran');
    expect(query.fillMode).toBe('biome');
    expect(query.waterLevel).toBe('0');
    expect(query.globeHeightScale).toBe('0.3');
    expect(query.seabedRelief).toBe('true');
    expect(query.showOcean).toBe('false');
  });
});
