import { buildPlanetEcology } from './ecology';
import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';

describe('buildPlanetEcology', () => {
  it('combines climate, biomes, rivers, and coastlines from a tectonics result', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 50 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 50 });
    const ecology = buildPlanetEcology(graph, tectonics);

    expect(ecology.temperature.length).toBe(graph.cells.length);
    expect(ecology.moisture.length).toBe(graph.cells.length);
    expect(ecology.biome.length).toBe(graph.cells.length);
    expect(ecology.slope.length).toBe(graph.cells.length);
    expect(ecology.riverPaths.length).toBeGreaterThan(0);
    expect(ecology.coastlines.length).toBeGreaterThan(0);
  });

  it('is fully deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 51 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 51 });
    const a = buildPlanetEcology(graph, tectonics);
    const b = buildPlanetEcology(graph, tectonics);
    expect(a).toEqual(b);
  });
});
