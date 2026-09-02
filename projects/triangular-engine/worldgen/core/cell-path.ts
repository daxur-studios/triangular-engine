import { IPlanetGraphCell, IPlanetGraphCore } from './planet-graph';
import { dot } from './vec3';

/** Angular distance (radians) between two cells' unit-sphere centers - a proper metric (satisfies
 * the triangle inequality), so it doubles as an admissible/consistent A* heuristic below. */
function angularDistance(a: IPlanetGraphCell, b: IPlanetGraphCell): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a.center, b.center))));
}

/**
 * Shortest path between two cells of a planet graph, walking `neighbors` adjacency only (see
 * runbook 23/24 - the 2D strategy-layer unit-movement prototype needs units to travel cell-to-cell
 * rather than in a straight line through the sphere interior). A* with edge cost and heuristic both
 * equal to `angularDistance` - optimal, not just fast, since that heuristic never overestimates the
 * true remaining cost.
 *
 * Returns cell ids from `fromCellId` to `toCellId` inclusive, or `null` if no path exists (a fully
 * connected planet graph should always have one, but this doesn't assume it).
 */
export function findCellPath(graph: IPlanetGraphCore, fromCellId: number, toCellId: number): number[] | null {
  if (fromCellId === toCellId) return [fromCellId];

  const goal = graph.cells[toCellId];
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[fromCellId, 0]]);
  const fScore = new Map<number, number>([[fromCellId, angularDistance(graph.cells[fromCellId], goal)]]);
  const closed = new Set<number>();

  // Binary min-heap of cell ids, ordered by `fScore`. No decrease-key: an improved node is just
  // pushed again and stale duplicates are skipped via `closed` on pop - standard, simple, and fine
  // at this graph size (a few thousand cells).
  const heap: number[] = [fromCellId];
  const heapPush = (id: number): void => {
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScore.get(heap[parent])! <= fScore.get(heap[i])!) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const heapPop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < heap.length && fScore.get(heap[left])! < fScore.get(heap[smallest])!) smallest = left;
        if (right < heap.length && fScore.get(heap[right])! < fScore.get(heap[smallest])!) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const current = heapPop();
    if (closed.has(current)) continue;
    if (current === toCellId) {
      const path = [current];
      let node = current;
      while (cameFrom.has(node)) {
        node = cameFrom.get(node)!;
        path.push(node);
      }
      return path.reverse();
    }
    closed.add(current);

    const currentCell = graph.cells[current];
    const currentG = gScore.get(current)!;
    for (const neighborId of currentCell.neighbors) {
      if (closed.has(neighborId)) continue;
      const tentativeG = currentG + angularDistance(currentCell, graph.cells[neighborId]);
      if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentativeG);
        fScore.set(neighborId, tentativeG + angularDistance(graph.cells[neighborId], goal));
        heapPush(neighborId);
      }
    }
  }
  return null;
}
