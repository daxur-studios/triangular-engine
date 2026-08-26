import { buildPlanetGraphCore } from './planet-graph';
import { classifyBoundaries } from './plate-boundaries';
import { buildPlates } from './plate-tectonics';

describe('classifyBoundaries', () => {
  it('only reports edges between cells on different plates', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 4 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 8, seed: 4 });
    const boundaries = classifyBoundaries(graph, plates, plateIdByCell);

    expect(boundaries.length).toBeGreaterThan(0);
    for (const edge of boundaries) {
      expect(plateIdByCell[edge.cellA]).toBe(edge.plateA);
      expect(plateIdByCell[edge.cellB]).toBe(edge.plateB);
      expect(edge.plateA).not.toBe(edge.plateB);
    }
  });

  it('classifies every boundary edge as one of the three known types', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 4 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 8, seed: 4 });
    const boundaries = classifyBoundaries(graph, plates, plateIdByCell);

    for (const edge of boundaries) {
      expect(['convergent', 'divergent', 'transform']).toContain(edge.type);
    }
  });

  it('is fully deterministic for a given seed', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 9 });
    const { plates, plateIdByCell } = buildPlates(graph, { plateCount: 6, seed: 9 });
    const a = classifyBoundaries(graph, plates, plateIdByCell);
    const b = classifyBoundaries(graph, plates, plateIdByCell);
    expect(a).toEqual(b);
  });
});
