import { buildPlanetGraphCore } from './planet-graph';
import { buildPlanetTectonics } from './tectonics';

describe('buildPlanetTectonics', () => {
  it('is fully deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 20 });
    const a = buildPlanetTectonics(graph, { plateCount: 8, seed: 20 });
    const b = buildPlanetTectonics(graph, { plateCount: 8, seed: 20 });
    expect(a).toEqual(b);
  });

  it('hits the target land fraction within a loose tolerance', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 23 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 23, targetLandFraction: 0.35 });

    const landFraction = tectonics.isLand.filter(Boolean).length / tectonics.isLand.length;
    expect(landFraction).toBeGreaterThan(0.3);
    expect(landFraction).toBeLessThan(0.4);
  });

  it('forms ridge cells into chains, not isolated singletons, along convergent continent-continent boundaries', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 27 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 10, seed: 27 });

    expect(tectonics.ridgeCellIds.length).toBeGreaterThan(0);

    const ridgeSet = new Set(tectonics.ridgeCellIds);
    for (const cellId of tectonics.ridgeCellIds) {
      const hasRidgeNeighbor = graph.cells[cellId].neighbors.some((neighborId) => ridgeSet.has(neighborId));
      expect(hasRidgeNeighbor).toBe(true);
    }
  });

  it('produces different tectonics for different seeds', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 30 });
    const a = buildPlanetTectonics(graph, { plateCount: 6, seed: 1 });
    const b = buildPlanetTectonics(graph, { plateCount: 6, seed: 2 });
    expect(a.elevation).not.toEqual(b.elevation);
  });
});
