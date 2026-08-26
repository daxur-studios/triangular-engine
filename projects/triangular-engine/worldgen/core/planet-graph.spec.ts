import { buildPlanetGraphCore, IPlanetGraphCell } from './planet-graph';
import { cross, length, sub } from './vec3';

/** Sum of the fan-triangle areas from the cell center to each edge of its corner polygon — a fine proxy for cell area at these scales. */
function approximateCellArea(cell: IPlanetGraphCell): number {
  let area = 0;
  const n = cell.corners.length;
  for (let k = 0; k < n; k++) {
    const a = cell.corners[k];
    const b = cell.corners[(k + 1) % n];
    const triangleNormal = cross(sub(a, cell.center), sub(b, cell.center));
    area += length(triangleNormal) / 2;
  }
  return area;
}

describe('buildPlanetGraphCore', () => {
  it('produces exactly the requested number of cells', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 5 });
    expect(graph.cells.length).toBe(200);
  });

  it('gives every cell at least 3 neighbors, matching its corner count', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 2 });
    for (const cell of graph.cells) {
      expect(cell.neighbors.length).toBeGreaterThanOrEqual(3);
      expect(cell.corners.length).toBe(cell.neighbors.length);
    }
  });

  it('has a symmetric neighbor relation (a neighbor of b implies b neighbor of a)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 120, seed: 13 });
    for (const cell of graph.cells) {
      for (const neighborId of cell.neighbors) {
        expect(graph.cells[neighborId].neighbors).toContain(cell.id);
      }
    }
  });

  it('satisfies dual-graph Euler consistency (sum of degrees == 2 * triangulation edges)', () => {
    const cellCount = 180;
    const graph = buildPlanetGraphCore({ cellCount, seed: 21 });

    const totalDegree = graph.cells.reduce((sum, cell) => sum + cell.neighbors.length, 0);
    const expectedEdges = 3 * cellCount - 6; // Euler's formula for a triangulated sphere of `cellCount` vertices.
    expect(totalDegree).toBe(2 * expectedEdges);
  });

  it('keeps cell areas within a loose bound of the mean (no degenerate slivers)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 8 });
    const areas = graph.cells.map(approximateCellArea);
    const mean = areas.reduce((a, b) => a + b, 0) / areas.length;

    for (const area of areas) {
      expect(area).toBeGreaterThan(mean * 0.15);
      expect(area).toBeLessThan(mean * 6);
    }
  });

  it('is fully deterministic for a given seed', () => {
    const a = buildPlanetGraphCore({ cellCount: 90, seed: 42 });
    const b = buildPlanetGraphCore({ cellCount: 90, seed: 42 });
    expect(a).toEqual(b);
  });

  it('produces different layouts for different seeds', () => {
    const a = buildPlanetGraphCore({ cellCount: 90, seed: 1 });
    const b = buildPlanetGraphCore({ cellCount: 90, seed: 2 });
    expect(a.cells.map((c) => c.center)).not.toEqual(b.cells.map((c) => c.center));
  });
});
