import { IPlanetGraphCore } from './planet-graph';

/**
 * M4e: a sparse per-cell elevation override — `cellId -> absolute elevation` — layered on top
 * of the graph's own generated `elevation[]`. Sparse by construction (a `Map`, not a parallel
 * array covering every cell), which is what makes it viable as save data: a planet with a
 * handful of player edits serializes as a handful of `[cellId, elevation]` pairs, not a copy of
 * the whole terrain.
 *
 * Values are absolute overrides, not deltas, so repeated edits to the same cell don't drift or
 * need to be replayed in order — the last write for a cell is its whole story. `flattenCells()`/
 * `digCells()` below are the two ways callers are expected to produce those values; nothing stops
 * a caller writing to the map directly for a different edit shape later.
 */
export type ITerrainEditLayer = Map<number, number>;

/**
 * The value `sampleElevation()`/mesh builders should see for `cellId`: the edit if one exists,
 * else the graph's own generated value. Every other function in this module is built from this
 * one rule.
 */
export function getEffectiveElevation(
  base: number[],
  edits: ReadonlyMap<number, number>,
  cellId: number,
): number {
  const override = edits.get(cellId);
  return override ?? base[cellId];
}

/**
 * Materializes a full `elevation[]` array with `edits` applied — the array every existing
 * consumer (`sampleElevation()`, `buildChunkMeshData()`, `buildChunkLod1MeshData()`,
 * `buildColliderPatch()`) already accepts unchanged, per `sampleElevation()`'s own doc comment
 * naming the terrain-edit layer as a future reader of that same bridge function. None of those
 * functions need to know edits exist; they just get handed a different array.
 *
 * Returns `base` itself (no copy) when there are no edits — the common case (most cells, most of
 * the time, have never been touched) costs nothing. Otherwise copies once and overwrites the
 * edited indices; cheap relative to a chunk rebuild (a `cellCount`-length float copy vs. actual
 * mesh/triangulation work), so it's fine to call this once per edit rather than trying to patch
 * an existing array in place.
 */
export function buildEffectiveElevation(base: number[], edits: ReadonlyMap<number, number>): number[] {
  if (edits.size === 0) return base;
  const result = base.slice();
  for (const [cellId, value] of edits) result[cellId] = value;
  return result;
}

/** Sets every cell in `cellIds` to the same absolute `targetElevation` — a flatten brush. */
export function flattenCells(
  edits: ITerrainEditLayer,
  cellIds: Iterable<number>,
  targetElevation: number,
): void {
  for (const cellId of cellIds) edits.set(cellId, targetElevation);
}

/**
 * Raises (positive `delta`) or lowers (negative `delta`) every cell in `cellIds` by `delta`,
 * relative to each cell's *current effective* elevation (its existing edit if any, else `base`)
 * — so repeated dig strokes over the same cell compound instead of each one only ever offsetting
 * the untouched original.
 */
export function digCells(
  edits: ITerrainEditLayer,
  base: number[],
  cellIds: Iterable<number>,
  delta: number,
): void {
  for (const cellId of cellIds) {
    edits.set(cellId, getEffectiveElevation(base, edits, cellId) + delta);
  }
}

/** Removes any override for `cellIds`, reverting them to the graph's own generated elevation. */
export function clearEdits(edits: ITerrainEditLayer, cellIds: Iterable<number>): void {
  for (const cellId of cellIds) edits.delete(cellId);
}

/**
 * The cells whose *rendered* elevation can change as a result of editing `editedCellIds` — not
 * just those cells themselves. `cellCornerElevation()` (`sample-elevation.ts`) blends a corner
 * from the 3 cells that meet there, so editing cell A also moves every corner A shares with its
 * neighbors, which changes those neighbors' own fan geometry even though their own `elevation[]`
 * entry never changed. Skipping this and only rebuilding the edited cells' own chunk leaves a
 * visible crack: the neighbor's stale corner no longer matches the edited cell's new one.
 */
export function affectedCellIds(graph: IPlanetGraphCore, editedCellIds: Iterable<number>): Set<number> {
  const result = new Set<number>();
  for (const cellId of editedCellIds) {
    result.add(cellId);
    for (const neighborId of graph.cells[cellId].neighbors) result.add(neighborId);
  }
  return result;
}

/**
 * Maps a set of cell ids to the chunk ids that own them (`IPlanetChunks.chunkIdByCell`, see
 * `chunking.ts`) — the whole point of M4e: an edit's actual rebuild cost is "however many chunks
 * `affectedCellIds()` touches," almost always 1-2 out of however many chunks the planet has, not
 * every chunk.
 */
export function affectedChunkIds(chunkIdByCell: number[], cellIds: Iterable<number>): Set<number> {
  const result = new Set<number>();
  for (const cellId of cellIds) result.add(chunkIdByCell[cellId]);
  return result;
}

/**
 * Cell ids reachable from `centerCellId` within `hops` graph steps (BFS over `cell.neighbors`),
 * inclusive of the center itself — the shape of a flatten/dig brush. `hops = 0` returns just the
 * center cell. Generic BFS, not specific to editing, but lives here rather than in a shared
 * "graph utilities" module since a brush radius is the one thing this module's callers actually
 * need it for.
 */
export function cellsWithinHops(graph: IPlanetGraphCore, centerCellId: number, hops: number): Set<number> {
  const visited = new Set<number>([centerCellId]);
  let frontier = [centerCellId];
  for (let step = 0; step < hops; step++) {
    const next: number[] = [];
    for (const cellId of frontier) {
      for (const neighborId of graph.cells[cellId].neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        next.push(neighborId);
      }
    }
    frontier = next;
  }
  return visited;
}
