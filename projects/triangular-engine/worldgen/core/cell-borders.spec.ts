import {
  classifyCellBorders,
  computeEdgeSagitta,
  computeFloatingEdgeEndpoints,
  extractCellBorders,
  findReachableCells,
} from './cell-borders';
import { buildPlanetGraphCore } from './planet-graph';

describe('cell-borders', () => {
  const graph = buildPlanetGraphCore({ cellCount: 60, seed: 42, relaxationIterations: 1 });

  it('extracts unique edges adhering to Euler formula E = 3N - 6', () => {
    const edges = extractCellBorders(graph);
    const n = graph.cells.length;
    // For spherical Voronoi with degree 3 vertices: E = 3N - 6
    expect(edges.length).toBe(3 * n - 6);

    // Verify cellA < cellB for every edge
    for (const edge of edges) {
      expect(edge.cellA).toBeLessThan(edge.cellB);
    }

    // Verify uniqueness of edge pairs
    const pairs = new Set<string>();
    for (const edge of edges) {
      const key = `${edge.cellA}:${edge.cellB}`;
      expect(pairs.has(key)).toBeFalse();
      pairs.add(key);
    }
  });

  it('correctly partitions internal and territory edges based on faction mapping', () => {
    const edges = extractCellBorders(graph);
    // Assign 2 factions: even cellId = faction 0, odd cellId = faction 1
    const factions = new Int32Array(graph.cells.length);
    for (let i = 0; i < factions.length; i++) {
      factions[i] = i % 2;
    }

    const { internalEdges, territoryEdges } = classifyCellBorders(edges, factions);
    expect(internalEdges.length + territoryEdges.length).toBe(edges.length);

    for (const edge of internalEdges) {
      expect(factions[edge.cellA]).toBe(factions[edge.cellB]);
    }
    for (const edge of territoryEdges) {
      expect(factions[edge.cellA]).not.toBe(factions[edge.cellB]);
    }
  });

  it('computes positive sagitta for valid non-identical endpoints on a sphere', () => {
    const a = { x: 0, y: 0, z: 1 };
    const b = { x: 0.1, y: 0, z: Math.sqrt(1 - 0.01) };
    const radius = 2.0;

    const s = computeEdgeSagitta(a, b, radius);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(radius * 0.1);
  });

  it('computes floating endpoints with guaranteed clearance above terrain', () => {
    const a = { x: 0, y: 0, z: 1 };
    const b = { x: 0.1, y: 0, z: Math.sqrt(1 - 0.01) };
    const radius = 2.0;
    const heightScale = 0.16;
    const minClearance = 0.005;

    const endpoints = computeFloatingEdgeEndpoints(a, b, 0.2, 0.3, radius, heightScale, minClearance);
    expect(endpoints.sagitta).toBeGreaterThan(0);

    const lenA = Math.hypot(endpoints.posA.x, endpoints.posA.y, endpoints.posA.z);
    const expectedLenA = radius + 0.2 * heightScale + minClearance + endpoints.sagitta;
    expect(lenA).toBeCloseTo(expectedLenA, 5);
  });

  it('clamps underwater endpoints to sea level when clampToSeaLevel is true', () => {
    const a = { x: 0, y: 0, z: 1 };
    const b = { x: 0.1, y: 0, z: Math.sqrt(1 - 0.01) };
    const radius = 2.0;
    const heightScale = 0.16;
    const minClearance = 0.005;

    // Unclamped (default): follows seabed negative elevation (-0.5)
    const unclamped = computeFloatingEdgeEndpoints(
      a,
      b,
      -0.5,
      0.3,
      radius,
      heightScale,
      minClearance,
      false,
      0,
    );
    const lenAUnclamped = Math.hypot(
      unclamped.posA.x,
      unclamped.posA.y,
      unclamped.posA.z,
    );
    expect(lenAUnclamped).toBeCloseTo(
      radius + -0.5 * heightScale + minClearance + unclamped.sagitta,
      5,
    );

    // Clamped: negative elevation clamped to seaLevelElevation (0)
    const clamped = computeFloatingEdgeEndpoints(
      a,
      b,
      -0.5,
      0.3,
      radius,
      heightScale,
      minClearance,
      true,
      0,
    );
    const lenAClamped = Math.hypot(
      clamped.posA.x,
      clamped.posA.y,
      clamped.posA.z,
    );
    expect(lenAClamped).toBeCloseTo(
      radius + 0 * heightScale + minClearance + clamped.sagitta,
      5,
    );
  });

  it('performs BFS reachable cells search within max hops', () => {
    const reachable0 = findReachableCells(graph, 0, 0);
    expect(reachable0).toEqual([0]);

    const reachable1 = findReachableCells(graph, 0, 1);
    // 1-hop reachable should be the start cell plus its direct neighbors
    const cell0 = graph.cells[0];
    expect(reachable1.length).toBe(1 + cell0.neighbors.length);
    for (const neighborId of cell0.neighbors) {
      expect(reachable1).toContain(neighborId);
    }

    const reachable2 = findReachableCells(graph, 0, 2);
    expect(reachable2.length).toBeGreaterThan(reachable1.length);
  });

  it('respects isAllowed filter in BFS reachable search', () => {
    // Only allow cells with id < 10
    const reachable = findReachableCells(graph, 0, 3, (id) => id < 10);
    for (const id of reachable) {
      expect(id).toBeLessThan(10);
    }
  });
});
