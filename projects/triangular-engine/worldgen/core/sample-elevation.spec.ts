import { buildPlanetGraphCore } from './planet-graph';
import { findCellAt, findCellNear, sampleElevation, sampleElevationNear } from './sample-elevation';
import { buildPlanetTectonics } from './tectonics';

describe('sampleElevation', () => {
  it('returns the cell elevation exactly at the cell center', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 7 });

    for (const cell of graph.cells) {
      const sampled = sampleElevation(graph, tectonics.elevation, cell.center);
      expect(sampled).toBeCloseTo(tectonics.elevation[cell.id], 5);
    }
  });

  it('at a corner, matches the average elevation of the 3 cells meeting there (continuous across borders)', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 7 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 7 });

    for (const cell of graph.cells) {
      const n = cell.neighbors.length;
      for (let k = 0; k < n; k++) {
        const a = cell.id;
        const b = cell.neighbors[k];
        const c = cell.neighbors[(k + 1) % n];
        const expected = (tectonics.elevation[a] + tectonics.elevation[b] + tectonics.elevation[c]) / 3;

        const sampled = sampleElevation(graph, tectonics.elevation, cell.corners[k]);
        expect(sampled).toBeCloseTo(expected, 5);
      }
    }
  });

  it('findCellAt matches the cell whose center is nearest the query direction', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 3 });

    for (const cell of graph.cells) {
      const found = findCellAt(graph, cell.center);
      expect(found.id).toBe(cell.id);
    }
  });

  it('is deterministic for a given graph/elevation', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 11 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 11 });
    const direction = graph.cells[42].corners[0];

    const a = sampleElevation(graph, tectonics.elevation, direction);
    const b = sampleElevation(graph, tectonics.elevation, direction);
    expect(a).toBe(b);
  });

  it('never exceeds the min/max elevation of the sampled cell and its neighbors', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 21 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 9, seed: 21 });

    for (const cell of graph.cells) {
      const neighborElevations = cell.neighbors.map((id) => tectonics.elevation[id]);
      const localMin = Math.min(tectonics.elevation[cell.id], ...neighborElevations);
      const localMax = Math.max(tectonics.elevation[cell.id], ...neighborElevations);

      const midCorner = cell.corners[0];
      const sampled = sampleElevation(graph, tectonics.elevation, midCorner);
      expect(sampled).toBeGreaterThanOrEqual(localMin - 1e-6);
      expect(sampled).toBeLessThanOrEqual(localMax + 1e-6);
    }
  });
});

describe('findCellNear / sampleElevationNear', () => {
  it('resolves the same cell as findCellAt, seeded from any starting hint', () => {
    const graph = buildPlanetGraphCore({ cellCount: 250, seed: 5 });

    for (const cell of graph.cells) {
      const expected = findCellAt(graph, cell.center);
      // Seed the walk from a handful of arbitrary, likely-far starting cells — the walk must
      // converge on the true containing cell regardless of where it started, not just from a
      // nearby hint.
      for (const hintCellId of [0, Math.floor(graph.cells.length / 2), graph.cells.length - 1]) {
        const found = findCellNear(graph, cell.center, hintCellId);
        expect(found.id).toBe(expected.id);
      }
    }
  });

  it('matches sampleElevation exactly for the same direction, any hint', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 9 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 7, seed: 9 });

    for (const cell of graph.cells) {
      const direction = {
        x: cell.corners[0].x * 0.5 + cell.center.x * 0.5,
        y: cell.corners[0].y * 0.5 + cell.center.y * 0.5,
        z: cell.corners[0].z * 0.5 + cell.center.z * 0.5,
      };
      const expected = sampleElevation(graph, tectonics.elevation, direction);
      const { value, cellId } = sampleElevationNear(graph, tectonics.elevation, direction, 0);
      expect(value).toBeCloseTo(expected, 10);
      expect(cellId).toBe(findCellAt(graph, direction).id);
    }
  });

  it('a coherent row-by-row walk (each hint seeded from the previous sample) still resolves correctly', () => {
    const graph = buildPlanetGraphCore({ cellCount: 300, seed: 13 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 8, seed: 13 });

    let hintCellId = 0;
    for (const cell of graph.cells) {
      for (const corner of cell.corners) {
        const expected = sampleElevation(graph, tectonics.elevation, corner);
        const { value, cellId } = sampleElevationNear(graph, tectonics.elevation, corner, hintCellId);
        expect(value).toBeCloseTo(expected, 10);
        hintCellId = cellId;
      }
    }
  });
});
