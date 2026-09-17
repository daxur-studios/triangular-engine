import { IPlanetGraphCore } from './planet-graph';
import { dot, IVec3, normalize } from './vec3';

export interface ICellBorderEdge {
  /** First endpoint direction (unit sphere) */
  readonly a: IVec3;
  /** Second endpoint direction (unit sphere) */
  readonly b: IVec3;
  /** Cell id on one side of the edge (always cellA < cellB) */
  readonly cellA: number;
  /** Cell id on the other side of the edge */
  readonly cellB: number;
}

export interface ICellBorderPartition {
  /** Edges that lie inside a territory (factionByCell[cellA] === factionByCell[cellB]) */
  readonly internalEdges: ICellBorderEdge[];
  /** Edges that separate different territories or nations (factionByCell[cellA] !== factionByCell[cellB]) */
  readonly territoryEdges: ICellBorderEdge[];
}

export interface IFloatingEndpoints {
  readonly posA: IVec3;
  readonly posB: IVec3;
  /** Sagitta clearance applied to lift chord midpoint above the sphere */
  readonly sagitta: number;
}

/**
 * Extracts every unique Voronoi boundary edge from the planet graph.
 *
 * Each edge is returned exactly once with `cellA < cellB`.
 * For a spherical Voronoi diagram with degree-3 vertices, Euler's formula
 * guarantees E = 3N - 6 edges for N cells.
 */
export function extractCellBorders(graph: IPlanetGraphCore): ICellBorderEdge[] {
  const edges: ICellBorderEdge[] = [];

  for (const cell of graph.cells) {
    const n = cell.corners.length;
    if (n < 3) continue;

    for (let m = 0; m < n; m++) {
      const j = (m + 1) % n;
      const neighborCellId = cell.neighbors[j];

      // Each shared polygon edge is visited once, from its lower-id cell
      if (neighborCellId > cell.id) {
        edges.push({
          a: cell.corners[m],
          b: cell.corners[j],
          cellA: cell.id,
          cellB: neighborCellId,
        });
      }
    }
  }

  return edges;
}

/**
 * Partitions cell boundary edges into internal edges (within the same faction/territory)
 * and territory borders (straddling different factions/territories).
 */
export function classifyCellBorders(
  edges: readonly ICellBorderEdge[],
  factionByCell: ArrayLike<number>,
): ICellBorderPartition {
  const internalEdges: ICellBorderEdge[] = [];
  const territoryEdges: ICellBorderEdge[] = [];

  for (const edge of edges) {
    const fA = factionByCell[edge.cellA];
    const fB = factionByCell[edge.cellB];

    if (fA !== fB) {
      territoryEdges.push(edge);
    } else {
      internalEdges.push(edge);
    }
  }

  return { internalEdges, territoryEdges };
}

/**
 * Computes the geometric chord sagitta (the maximum dip of a straight chord beneath a sphere arc)
 * between two unit vectors `a` and `b` on a sphere of radius `radius`:
 *
 *   s = radius * (1 - cos(theta / 2))
 */
export function computeEdgeSagitta(a: IVec3, b: IVec3, radius: number): number {
  const dotProduct = Math.max(-1, Math.min(1, dot(a, b)));
  const cosHalfTheta = Math.sqrt(Math.max(0, 0.5 * (1 + dotProduct)));
  return radius * (1 - cosHalfTheta);
}

/**
 * Computes 3D floating straight-line endpoints for a Voronoi boundary edge.
 *
 * To guarantee the chord never penetrates the convex spherical terrain between `a` and `b`,
 * the chord clearance compensates for the sagitta dip so that even at the midpoint:
 *   clearance >= minClearance
 */
export function computeFloatingEdgeEndpoints(
  a: IVec3,
  b: IVec3,
  elevA: number,
  elevB: number,
  radius: number,
  heightScale: number,
  minClearance = 0.004,
): IFloatingEndpoints {
  const sagitta = computeEdgeSagitta(a, b, radius);
  const totalOffset = minClearance + sagitta;

  const rA = radius + elevA * heightScale + totalOffset;
  const rB = radius + elevB * heightScale + totalOffset;

  return {
    posA: { x: a.x * rA, y: a.y * rA, z: a.z * rA },
    posB: { x: b.x * rB, y: b.y * rB, z: b.z * rB },
    sagitta,
  };
}

/**
 * BFS flood-fill to find all cells reachable within `maxHops` from `startCellId`.
 *
 * An optional `isAllowed` predicate can filter eligible terrain (e.g. land-only, water-only,
 * or non-impassable mountains).
 */
export function findReachableCells(
  graph: IPlanetGraphCore,
  startCellId: number,
  maxHops: number,
  isAllowed?: (cellId: number) => boolean,
): number[] {
  if (startCellId < 0 || startCellId >= graph.cells.length) return [];
  if (isAllowed && !isAllowed(startCellId)) return [];

  const visited = new Set<number>([startCellId]);
  let currentLevel = [startCellId];

  for (let hop = 0; hop < maxHops; hop++) {
    const nextLevel: number[] = [];
    for (const cellId of currentLevel) {
      const cell = graph.cells[cellId];
      for (const neighborId of cell.neighbors) {
        if (!visited.has(neighborId)) {
          if (!isAllowed || isAllowed(neighborId)) {
            visited.add(neighborId);
            nextLevel.push(neighborId);
          }
        }
      }
    }
    currentLevel = nextLevel;
    if (currentLevel.length === 0) break;
  }

  return Array.from(visited);
}
