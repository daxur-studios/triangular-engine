import { computeClimate } from './climate';
import { buildPlanetGraphCore } from './planet-graph';
import { traceRivers } from './rivers';
import { buildPlanetTectonics } from './tectonics';

describe('traceRivers', () => {
  it('every river terminates at the ocean or a lake', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      { seed: 41 },
    );

    expect(rivers.riverPaths.length).toBeGreaterThan(0);
    const lakeSet = new Set(rivers.lakeCellIds);
    for (const path of rivers.riverPaths) {
      const endCell = path[path.length - 1];
      const terminatesAtOceanOrLake = !tectonics.isLand[endCell] || lakeSet.has(endCell);
      expect(terminatesAtOceanOrLake).toBe(true);
    }
  });

  it('every step of every river strictly descends in elevation', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 41 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 41 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const rivers = traceRivers(
      graph,
      tectonics.elevation,
      tectonics.isLand,
      tectonics.seaLevelElevation,
      climate.moisture,
      { seed: 41 },
    );

    for (const path of rivers.riverPaths) {
      for (let i = 1; i < path.length; i++) {
        expect(tectonics.elevation[path[i]]).toBeLessThan(tectonics.elevation[path[i - 1]]);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 12 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 12 });
    const climate = computeClimate(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation);
    const a = traceRivers(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation, climate.moisture, {
      seed: 3,
    });
    const b = traceRivers(graph, tectonics.elevation, tectonics.isLand, tectonics.seaLevelElevation, climate.moisture, {
      seed: 3,
    });
    expect(a).toEqual(b);
  });
});
