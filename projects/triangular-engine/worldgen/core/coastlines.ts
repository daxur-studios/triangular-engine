import { IPlanetGraphCore } from './planet-graph';
import { IVec3 } from './vec3';

/** Canonical id for a Voronoi corner: the sorted triple of cell ids whose sites meet there. */
function cornerKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(':');
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function pushAdjacency(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * M2 coastline pass: walks every polygon edge that separates a land cell from
 * a water cell into closed polylines. `cell.corners[m]` is the circumcenter
 * shared by `cell`, `neighbors[m]`, and `neighbors[m+1]` (see `dual-cells.ts`),
 * so a corner touching exactly 3 cells has a land/water split of either 0-3 or
 * 1-2 — meaning every coastline vertex has exactly 0 or 2 incident coastline
 * edges. That makes the coastline edge set a disjoint union of simple cycles
 * by construction: no dangling chains, no branching.
 */
export function extractCoastlines(graph: IPlanetGraphCore, isLand: boolean[]): IVec3[][] {
  const adjacency = new Map<string, string[]>();
  const position = new Map<string, IVec3>();

  for (const cell of graph.cells) {
    const n = cell.neighbors.length;
    for (let m = 0; m < n; m++) {
      const j = (m + 1) % n;
      const neighborCellId = cell.neighbors[j];
      if (neighborCellId <= cell.id) continue; // each shared polygon edge is visited once, from its lower-id cell
      if (isLand[cell.id] === isLand[neighborCellId]) continue;

      const startKey = cornerKey(cell.id, cell.neighbors[m], cell.neighbors[j]);
      const endKey = cornerKey(cell.id, cell.neighbors[j], cell.neighbors[(j + 1) % n]);
      position.set(startKey, cell.corners[m]);
      position.set(endKey, cell.corners[j]);
      pushAdjacency(adjacency, startKey, endKey);
      pushAdjacency(adjacency, endKey, startKey);
    }
  }

  const loops: IVec3[][] = [];
  const visitedEdges = new Set<string>();

  for (const [startVertex, neighbors] of adjacency) {
    for (const firstNeighbor of neighbors) {
      const firstEdge = edgeKey(startVertex, firstNeighbor);
      if (visitedEdges.has(firstEdge)) continue;
      visitedEdges.add(firstEdge);

      const loop: IVec3[] = [position.get(startVertex)!];
      let prev = startVertex;
      let current = firstNeighbor;

      while (current !== startVertex) {
        loop.push(position.get(current)!);
        const options = adjacency.get(current)!;
        const next = options[0] === prev ? options[1] : options[0];
        visitedEdges.add(edgeKey(current, next));
        prev = current;
        current = next;
      }

      loops.push(loop);
    }
  }

  return loops;
}
