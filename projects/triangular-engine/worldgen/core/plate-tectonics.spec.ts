import { buildPlanetGraphCore } from './planet-graph';
import { buildPlates } from './plate-tectonics';

describe('buildPlates', () => {
  it('assigns every cell to exactly one of the requested plates', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 5 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 8, seed: 5 });

    expect(plates.length).toBe(8);
    expect(plateIdByCell.length).toBe(graph.cells.length);
    for (const plateId of plateIdByCell) {
      expect(plateId).toBeGreaterThanOrEqual(0);
      expect(plateId).toBeLessThan(plates.length);
    }
  });

  it('gives every plate at least one cell (its own seed)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 3 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 10, seed: 3 });

    const counts = new Array(plates.length).fill(0);
    for (const plateId of plateIdByCell) counts[plateId]++;
    for (const count of counts) expect(count).toBeGreaterThan(0);
  });

  it('is fully deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 120, seed: 7 });
    const a = buildPlates(graph, { plateCount: 6, seed: 7 });
    const b = buildPlates(graph, { plateCount: 6, seed: 7 });
    expect(a).toEqual(b);
  });

  it('produces different plate layouts for different seeds', () => {
    const graph = buildPlanetGraphCore({ cellCount: 120, seed: 7 });
    const a = buildPlates(graph, { plateCount: 6, seed: 1 });
    const b = buildPlates(graph, { plateCount: 6, seed: 2 });
    expect(a.plateIdByCell).not.toEqual(b.plateIdByCell);
  });
});
