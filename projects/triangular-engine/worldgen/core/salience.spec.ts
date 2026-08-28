import { buildPlanetChunks } from './chunking';
import { computeCellPins } from './salience';
import { buildPlanetGraphCore, IPlanetGraphCore } from './planet-graph';

/** BFS-grows a `size`-cell patch from `seed`, never stepping into `excluded` — used to build
 * synthetic land patches that are guaranteed non-adjacent to each other (see `ringBuffer()`). */
function growPatch(graph: IPlanetGraphCore, seed: number, size: number, excluded: Set<number>): number[] {
  const members = new Set<number>([seed]);
  let frontier = [seed];
  while (members.size < size && frontier.length > 0) {
    const next: number[] = [];
    outer: for (const id of frontier) {
      for (const neighborId of graph.cells[id].neighbors) {
        if (members.has(neighborId) || excluded.has(neighborId)) continue;
        members.add(neighborId);
        next.push(neighborId);
        if (members.size >= size) break outer;
      }
    }
    frontier = next;
  }
  return Array.from(members);
}

/** `cells` plus every cell directly adjacent to one of them — excluding this from a later
 * `growPatch()` call guarantees the new patch can't end up touching `cells`, since adjacency
 * is symmetric in this graph (every neighbor relationship is listed both ways). */
function ringBuffer(graph: IPlanetGraphCore, cells: number[]): Set<number> {
  const buffer = new Set<number>(cells);
  for (const id of cells) {
    for (const neighborId of graph.cells[id].neighbors) buffer.add(neighborId);
  }
  return buffer;
}

function firstCellOutside(graph: IPlanetGraphCore, excluded: Set<number>): number {
  for (let id = 0; id < graph.cells.length; id++) {
    if (!excluded.has(id)) return id;
  }
  throw new Error('no cell available outside excluded set');
}

describe('computeCellPins', () => {
  it('pins the single most prominent peak cell in a chunk', () => {
    const graph = buildPlanetGraphCore({ cellCount: 200, seed: 9 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 200 });
    const peakCellId = chunks[0].cellIds[Math.floor(chunks[0].cellIds.length / 2)];

    const elevation = graph.cells.map(() => 0);
    elevation[peakCellId] = 10;
    const isLand = graph.cells.map(() => true);

    const { pinned } = computeCellPins(graph, elevation, isLand, chunks, {
      maxCoastalFeaturesPerChunk: 0,
      maxIslandCellsPerChunk: 0,
    });

    expect(pinned[peakCellId]).toBe(1);
    expect(pinned.reduce((sum, v) => sum + v, 0)).toBe(1);
  });

  it('never pins more cells per chunk than the peak+coastal+island budgets allow', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: 80 });
    const elevation = graph.cells.map((_, id) => Math.sin(id * 0.53) + Math.cos(id * 0.19));
    const isLand = graph.cells.map((_, id) => Math.sin(id * 0.71) > -0.2);

    const params = {
      maxPeaksPerChunk: 2,
      maxCoastalFeaturesPerChunk: 2,
      maxIslandCellsPerChunk: 12,
      islandMaxCellCount: 20,
    };
    const { pinned } = computeCellPins(graph, elevation, isLand, chunks, params);

    for (const chunk of chunks) {
      const pinnedInChunk = chunk.cellIds.filter((id) => pinned[id] === 1).length;
      expect(pinnedInChunk).toBeLessThanOrEqual(
        params.maxPeaksPerChunk + params.maxCoastalFeaturesPerChunk + params.maxIslandCellsPerChunk,
      );
    }
  });

  it('pins small islands whole, largest first, and never pins one it only partly has budget for', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: graph.cells.length });
    expect(chunks.length).toBe(1);

    const mainland = growPatch(graph, 0, 60, new Set());
    let excluded = ringBuffer(graph, mainland);

    const islandA = growPatch(graph, firstCellOutside(graph, excluded), 8, excluded);
    excluded = new Set([...excluded, ...ringBuffer(graph, islandA)]);

    const islandC = growPatch(graph, firstCellOutside(graph, excluded), 7, excluded);

    expect(mainland.length).toBe(60);
    expect(islandA.length).toBe(8);
    expect(islandC.length).toBe(7);

    const isLand = graph.cells.map(() => false);
    for (const id of [...mainland, ...islandA, ...islandC]) isLand[id] = true;
    const elevation = graph.cells.map(() => 0);

    // Budget of 12: island A (8 cells) fits and is pinned first (bigger islands are ranked
    // first); only 4 cells of budget remain, so island C (7 cells) doesn't fit and is skipped
    // *entirely* rather than partially pinned — see computeCellPins()'s doc comment for why.
    const { pinned } = computeCellPins(graph, elevation, isLand, chunks, {
      maxPeaksPerChunk: 0,
      maxCoastalFeaturesPerChunk: 0,
      maxIslandCellsPerChunk: 12,
      islandMaxCellCount: 20,
    });

    for (const id of islandA) expect(pinned[id]).toBe(1);
    for (const id of islandC) expect(pinned[id]).toBe(0);
  });

  it('never pins cells belonging to the single largest land component (the "mainland")', () => {
    const graph = buildPlanetGraphCore({ cellCount: 400, seed: 13 });
    const { chunks } = buildPlanetChunks(graph, { targetChunkSize: graph.cells.length });

    const mainland = growPatch(graph, 0, 60, new Set());
    const excluded = ringBuffer(graph, mainland);
    const island = growPatch(graph, firstCellOutside(graph, excluded), 8, excluded);
    expect(mainland.length).toBe(60);
    expect(island.length).toBe(8);

    const isLand = graph.cells.map(() => false);
    for (const id of [...mainland, ...island]) isLand[id] = true;
    const elevation = graph.cells.map(() => 0);

    const { pinned } = computeCellPins(graph, elevation, isLand, chunks, {
      maxPeaksPerChunk: 0,
      maxCoastalFeaturesPerChunk: 0,
      maxIslandCellsPerChunk: 100,
      islandMaxCellCount: 100,
    });

    for (const id of mainland) expect(pinned[id]).toBe(0);
  });
});
