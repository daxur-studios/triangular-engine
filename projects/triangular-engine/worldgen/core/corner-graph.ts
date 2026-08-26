import { IPlanetGraphCore } from './planet-graph';
import { IVec3 } from './vec3';

/** Canonical id for a Voronoi corner: the sorted triple of cell ids whose sites meet there. */
function cornerKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(':');
}

export interface ICornerGraph {
  /** Number of distinct corners. */
  count: number;
  /** Corner position, indexed 0..count-1. */
  position: IVec3[];
  /** The 3 cell ids that meet at each corner, same indexing as `position`. */
  cellIds: [number, number, number][];
  /** Indices (into `position`/`cellIds`) of corners sharing a cell-polygon edge with this one. */
  neighbors: number[][];
}

/**
 * Dual graph of the cell graph's polygon corners: one node per Voronoi vertex
 * (where exactly 3 cell polygons meet), edges between corners that share a
 * cell-polygon edge. This is what lets rivers/coastlines follow cell
 * boundaries instead of jumping cell-center to cell-center — see runbook 022.
 *
 * `cell.corners[m]` is the circumcenter shared by `cell`, `neighbors[m]`, and
 * `neighbors[(m+1)%n]` (see `dual-cells.ts`), so consecutive corners `m` and
 * `m+1` in a cell's polygon are always adjacent here, and the same physical
 * corner canonicalizes to the same key regardless of which of its 3 cells it
 * was discovered from.
 */
export function buildCornerGraph(graph: IPlanetGraphCore): ICornerGraph {
  const indexByKey = new Map<string, number>();
  const position: IVec3[] = [];
  const cellIds: [number, number, number][] = [];
  const neighborSets: Set<number>[] = [];

  const cornerIndex = (a: number, b: number, c: number, pos: IVec3): number => {
    const key = cornerKey(a, b, c);
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = position.length;
      indexByKey.set(key, index);
      position.push(pos);
      cellIds.push([a, b, c].sort((x, y) => x - y) as [number, number, number]);
      neighborSets.push(new Set());
    }
    return index;
  };

  for (const cell of graph.cells) {
    const n = cell.neighbors.length;
    if (n < 3) continue;

    const cornerIndices = cell.neighbors.map((neighborId, m) =>
      cornerIndex(cell.id, neighborId, cell.neighbors[(m + 1) % n], cell.corners[m]),
    );
    for (let m = 0; m < n; m++) {
      const a = cornerIndices[m];
      const b = cornerIndices[(m + 1) % n];
      neighborSets[a].add(b);
      neighborSets[b].add(a);
    }
  }

  return {
    count: position.length,
    position,
    cellIds,
    neighbors: neighborSets.map((set) => [...set]),
  };
}
