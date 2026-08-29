import { buildPlanetChunks } from './chunking';
import { buildPlanetGraphCore } from './planet-graph';
import { sampleElevation } from './sample-elevation';
import {
  affectedCellIds,
  affectedChunkIds,
  buildEffectiveElevation,
  cellsWithinHops,
  clearEdits,
  digCells,
  flattenCells,
  getEffectiveElevation,
  ITerrainEditLayer,
} from './terrain-edits';
import { buildPlanetTectonics } from './tectonics';

describe('getEffectiveElevation / buildEffectiveElevation', () => {
  it('falls back to the base value when no edit exists', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map();
    expect(getEffectiveElevation(base, edits, 1)).toBe(2);
  });

  it('returns the override when one exists', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map([[1, 99]]);
    expect(getEffectiveElevation(base, edits, 1)).toBe(99);
  });

  it('buildEffectiveElevation returns the same array reference when there are no edits', () => {
    const base = [1, 2, 3];
    expect(buildEffectiveElevation(base, new Map())).toBe(base);
  });

  it('buildEffectiveElevation copies and overwrites only edited indices, leaving base untouched', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map([[1, 99]]);

    const effective = buildEffectiveElevation(base, edits);

    expect(effective).toEqual([1, 99, 3]);
    expect(base).toEqual([1, 2, 3]);
    expect(effective).not.toBe(base);
  });
});

describe('flattenCells / digCells / clearEdits', () => {
  it('flattenCells sets every given cell to the same absolute value', () => {
    const edits: ITerrainEditLayer = new Map();
    flattenCells(edits, [2, 5, 9], 0.5);
    expect(edits.get(2)).toBe(0.5);
    expect(edits.get(5)).toBe(0.5);
    expect(edits.get(9)).toBe(0.5);
  });

  it('digCells offsets from base when no prior edit exists', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map();
    digCells(edits, base, [1], -0.2);
    expect(edits.get(1)).toBeCloseTo(1.8, 10);
  });

  it('digCells compounds relative to the current effective value on repeated calls', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map();
    digCells(edits, base, [1], -0.2);
    digCells(edits, base, [1], -0.2);
    expect(edits.get(1)).toBeCloseTo(1.6, 10);
  });

  it('clearEdits reverts a cell to the base elevation', () => {
    const base = [1, 2, 3];
    const edits: ITerrainEditLayer = new Map([[1, 99]]);
    clearEdits(edits, [1]);
    expect(edits.has(1)).toBe(false);
    expect(getEffectiveElevation(base, edits, 1)).toBe(2);
  });
});

describe('affectedCellIds', () => {
  it('includes the edited cell and every one of its neighbors, and nothing else', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 4 });
    const target = graph.cells[10];

    const affected = affectedCellIds(graph, [target.id]);

    expect(affected.has(target.id)).toBe(true);
    for (const neighborId of target.neighbors) {
      expect(affected.has(neighborId)).toBe(true);
    }
    expect(affected.size).toBe(1 + target.neighbors.length);
  });

  it('unions correctly across multiple edited cells', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 4 });
    const a = graph.cells[10];
    const b = graph.cells[20];

    const affected = affectedCellIds(graph, [a.id, b.id]);

    expect(affected.has(a.id)).toBe(true);
    expect(affected.has(b.id)).toBe(true);
    for (const neighborId of [...a.neighbors, ...b.neighbors]) {
      expect(affected.has(neighborId)).toBe(true);
    }
  });
});

describe('affectedChunkIds', () => {
  it('maps affected cells to a small subset of chunks, not the whole planet', () => {
    const graph = buildPlanetGraphCore({ cellCount: 600, seed: 6 });
    const { chunkIdByCell, chunks } = buildPlanetChunks(graph, { targetChunkSize: 60 });
    const editedCell = graph.cells[123];

    const cellIds = affectedCellIds(graph, [editedCell.id]);
    const chunkIds = affectedChunkIds(chunkIdByCell, cellIds);

    expect(chunkIds.size).toBeGreaterThan(0);
    expect(chunkIds.size).toBeLessThan(chunks.length);
    expect(chunkIds.has(chunkIdByCell[editedCell.id])).toBe(true);
    for (const chunkId of chunkIds) {
      expect(chunkId).toBeGreaterThanOrEqual(0);
      expect(chunkId).toBeLessThan(chunks.length);
    }
  });
});

describe('cellsWithinHops', () => {
  it('returns just the center cell at hops=0', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 2 });
    const result = cellsWithinHops(graph, 15, 0);
    expect(result.size).toBe(1);
    expect(result.has(15)).toBe(true);
  });

  it('matches the center plus its direct neighbors at hops=1', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 2 });
    const cell = graph.cells[15];
    const result = cellsWithinHops(graph, cell.id, 1);
    expect(result).toEqual(new Set([cell.id, ...cell.neighbors]));
  });

  it('grows monotonically with hop count and never exceeds the graph size', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 2 });
    const r0 = cellsWithinHops(graph, 15, 0);
    const r1 = cellsWithinHops(graph, 15, 1);
    const r2 = cellsWithinHops(graph, 15, 2);

    expect(r1.size).toBeGreaterThanOrEqual(r0.size);
    expect(r2.size).toBeGreaterThanOrEqual(r1.size);
    for (const id of r2) expect(id).toBeGreaterThanOrEqual(0);
    expect(r2.size).toBeLessThanOrEqual(graph.cells.length);
  });

  it('is deterministic for a given graph/center/hops', () => {
    const graph = buildPlanetGraphCore({ cellCount: 100, seed: 2 });
    const a = cellsWithinHops(graph, 15, 2);
    const b = cellsWithinHops(graph, 15, 2);
    expect(a).toEqual(b);
  });
});

describe('integration with sampleElevation', () => {
  it('an edited cell samples as its override value exactly at its own center', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 8 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 8 });
    const cell = graph.cells[30];

    const edits: ITerrainEditLayer = new Map();
    flattenCells(edits, [cell.id], 0.75);
    const effective = buildEffectiveElevation(tectonics.elevation, edits);

    const sampled = sampleElevation(graph, effective, cell.center);
    expect(sampled).toBeCloseTo(0.75, 10);
  });

  it('editing a cell also changes sampled elevation at corners shared with its neighbors', () => {
    const graph = buildPlanetGraphCore({ cellCount: 150, seed: 8 });
    const tectonics = buildPlanetTectonics(graph, { plateCount: 6, seed: 8 });
    const cell = graph.cells[30];
    const corner = cell.corners[0];

    const before = sampleElevation(graph, tectonics.elevation, corner);

    const edits: ITerrainEditLayer = new Map();
    flattenCells(edits, [cell.id], before + 10);
    const effective = buildEffectiveElevation(tectonics.elevation, edits);

    const after = sampleElevation(graph, effective, corner);
    expect(after).not.toBeCloseTo(before, 5);
  });
});
