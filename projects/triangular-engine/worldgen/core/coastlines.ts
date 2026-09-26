import { IPlanetGraphCore } from './planet-graph';
import { findCellAt, findCellNear } from './sample-elevation';
import { dot, IVec3, normalize, scale, sub } from './vec3';

/** A Voronoi edge separating one final land cell from one final water cell. */
export interface ICoastlineSegment {
  /** Stable within this extraction, ordered by the lower cell id then polygon edge. */
  id: number;
  start: IVec3;
  end: IVec3;
  landCellId: number;
  waterCellId: number;
}

export interface ICoastlineSample {
  /** Cell owning this direction under the graph's nearest-site rule. */
  cellId: number;
  isLand: boolean;
  /** Nearest coastline distance in radians, positive on land, negative in water, zero on coast. */
  signedDistanceRadians: number;
  /** Closest point on the selected great-circle coastline segment. Null if the world has no coast. */
  closestPoint: IVec3 | null;
  /** Segment separating the closest land and water cells. Null if the world has no coast. */
  segment: ICoastlineSegment | null;
}

interface CoastlineNode {
  center: IVec3;
  radius: number;
  left?: CoastlineNode;
  right?: CoastlineNode;
  segmentIndices?: number[];
}

export interface ICoastlineQuery {
  /**
   * Resolve cell ownership and signed distance to the authoritative coast.
   * Pass the previous cell id while walking a coherent grid to use the local
   * Voronoi walk instead of scanning every site.
   */
  sample(direction: IVec3, hintCellId?: number): ICoastlineSample;
  readonly segments: readonly ICoastlineSegment[];
}

const LEAF_SIZE = 8;
const ON_COAST_EPSILON = 1e-10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function angularDistance(a: IVec3, b: IVec3): number {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

function cornerKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(':');
}

function pushAdjacency(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Extract the actual shared Voronoi edges whose cells differ in the supplied
 * final land mask. The mask is intentionally an input: callers must pass the
 * post-cleanup `tectonics.isLand`, not re-threshold raw elevation here.
 */
export function extractCoastlineSegments(graph: IPlanetGraphCore, isLand: boolean[]): ICoastlineSegment[] {
  if (isLand.length !== graph.cells.length) {
    throw new Error(`Coastline mask length (${isLand.length}) must match graph cell count (${graph.cells.length}).`);
  }

  const segments: ICoastlineSegment[] = [];
  for (const cell of graph.cells) {
    const n = cell.neighbors.length;
    for (let edgeIndex = 0; edgeIndex < n; edgeIndex++) {
      const neighborId = cell.neighbors[(edgeIndex + 1) % n];
      if (neighborId <= cell.id || isLand[cell.id] === isLand[neighborId]) continue;

      const landCellId = isLand[cell.id] ? cell.id : neighborId;
      const waterCellId = isLand[cell.id] ? neighborId : cell.id;
      segments.push({
        id: segments.length,
        start: cell.corners[edgeIndex],
        end: cell.corners[(edgeIndex + 1) % n],
        landCellId,
        waterCellId,
      });
    }
  }
  return segments;
}

/**
 * M2 coastline pass: walks every polygon edge that separates a land cell from
 * a water cell into closed polylines. `cell.corners[m]` is the circumcenter
 * shared by `cell`, `neighbors[m]`, and `neighbors[m+1]` (see `dual-cells.ts`),
 * so each coastline vertex has either zero or two incident coastline edges.
 */
export function extractCoastlines(graph: IPlanetGraphCore, isLand: boolean[]): IVec3[][] {
  const adjacency = new Map<string, string[]>();
  const position = new Map<string, IVec3>();

  for (const cell of graph.cells) {
    const n = cell.neighbors.length;
    for (let m = 0; m < n; m++) {
      const j = (m + 1) % n;
      const neighborCellId = cell.neighbors[j]!;
      if (neighborCellId <= cell.id) continue;
      if (isLand[cell.id] === isLand[neighborCellId]) continue;

      const startKey = cornerKey(cell.id, cell.neighbors[m]!, cell.neighbors[j]!);
      const endKey = cornerKey(cell.id, cell.neighbors[j]!, cell.neighbors[(j + 1) % n]!);
      position.set(startKey, cell.corners[m]!);
      position.set(endKey, cell.corners[j]!);
      pushAdjacency(adjacency, startKey, endKey);
      pushAdjacency(adjacency, endKey, startKey);
    }
  }

  const loops: IVec3[][] = [];
  const visitedEdges = new Set<string>();
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [startVertex, neighbors] of adjacency) {
    for (const firstNeighbor of neighbors) {
      if (visitedEdges.has(edgeKey(startVertex, firstNeighbor))) continue;
      visitedEdges.add(edgeKey(startVertex, firstNeighbor));
      const loop: IVec3[] = [position.get(startVertex)!];
      let previous = startVertex;
      let current = firstNeighbor;
      while (current !== startVertex) {
        loop.push(position.get(current)!);
        const options = adjacency.get(current)!;
        const next = options[0] === previous ? options[1] : options[0];
        visitedEdges.add(edgeKey(current, next));
        previous = current;
        current = next;
      }
      loops.push(loop);
    }
  }
  return loops;
}

function buildNode(segments: readonly ICoastlineSegment[], indices: number[]): CoastlineNode {
  let sum = { x: 0, y: 0, z: 0 };
  for (const index of indices) {
    sum = {
      x: sum.x + segments[index]!.start.x + segments[index]!.end.x,
      y: sum.y + segments[index]!.start.y + segments[index]!.end.y,
      z: sum.z + segments[index]!.start.z + segments[index]!.end.z,
    };
  }
  const center = normalize(sum);
  let radius = 0;
  for (const index of indices) {
    const segment = segments[index]!;
    const arcLength = angularDistance(segment.start, segment.end);
    radius = Math.max(
      radius,
      angularDistance(center, segment.start) + arcLength / 2,
      angularDistance(center, segment.end) + arcLength / 2,
    );
  }
  if (indices.length <= LEAF_SIZE) return { center, radius, segmentIndices: indices };

  const spreads = (['x', 'y', 'z'] as const).map((axis) => {
    const values = indices.map((i) => (segments[i]!.start[axis] + segments[i]!.end[axis]) / 2);
    return Math.max(...values) - Math.min(...values);
  });
  const axis = (['x', 'y', 'z'] as const)[spreads.indexOf(Math.max(...spreads))]!;
  const sorted = [...indices].sort((a, b) => {
    const av = (segments[a]!.start[axis] + segments[a]!.end[axis]) / 2;
    const bv = (segments[b]!.start[axis] + segments[b]!.end[axis]) / 2;
    return av - bv || a - b;
  });
  const middle = Math.floor(sorted.length / 2);
  return {
    center,
    radius,
    left: buildNode(segments, sorted.slice(0, middle)),
    right: buildNode(segments, sorted.slice(middle)),
  };
}

function pointOnSegment(direction: IVec3, start: IVec3, end: IVec3): { point: IVec3; distance: number } {
  const arcLength = angularDistance(start, end);
  const normal = normalize({
    x: start.y * end.z - start.z * end.y,
    y: start.z * end.x - start.x * end.z,
    z: start.x * end.y - start.y * end.x,
  });
  const projected = sub(direction, scale(normal, dot(direction, normal)));
  const candidates = [normalize(projected), scale(normalize(projected), -1)];
  for (const candidate of candidates) {
    const through = angularDistance(start, candidate) + angularDistance(candidate, end);
    if (through <= arcLength + 1e-8) return { point: candidate, distance: angularDistance(direction, candidate) };
  }
  const startDistance = angularDistance(direction, start);
  const endDistance = angularDistance(direction, end);
  return startDistance <= endDistance
    ? { point: start, distance: startDistance }
    : { point: end, distance: endDistance };
}

/**
 * Build a shared spherical coast query from the final discrete cell mask.
 * A bounding-cap tree prunes distant segments while keeping exact great-circle
 * distance tests for the remaining candidates.
 */
export function createCoastlineQuery(graph: IPlanetGraphCore, isLand: boolean[]): ICoastlineQuery {
  if (graph.cells.length === 0) throw new Error('Cannot build a coastline query for an empty graph.');
  const segments = extractCoastlineSegments(graph, isLand);
  const root = segments.length > 0 ? buildNode(segments, segments.map((segment) => segment.id)) : null;

  return {
    segments,
    sample(direction: IVec3, hintCellId?: number): ICoastlineSample {
      const unitDirection = normalize(direction);
      const cell = hintCellId === undefined
        ? findCellAt(graph, unitDirection)
        : findCellNear(graph, unitDirection, hintCellId);
      if (!root) {
        return {
          cellId: cell.id,
          isLand: isLand[cell.id]!,
          signedDistanceRadians: isLand[cell.id] ? Infinity : -Infinity,
          closestPoint: null,
          segment: null,
        };
      }

      let bestDistance = Infinity;
      let bestPoint: IVec3 | null = null;
      let bestSegment: ICoastlineSegment | null = null;
      const visit = (node: CoastlineNode): void => {
        if (Math.max(0, angularDistance(unitDirection, node.center) - node.radius) > bestDistance) return;
        if (node.segmentIndices) {
          for (const index of node.segmentIndices) {
            const segment = segments[index]!;
            const candidate = pointOnSegment(unitDirection, segment.start, segment.end);
            if (candidate.distance < bestDistance - 1e-12 ||
              (Math.abs(candidate.distance - bestDistance) <= 1e-12 && segment.id < (bestSegment?.id ?? Infinity))) {
              bestDistance = candidate.distance;
              bestPoint = candidate.point;
              bestSegment = segment;
            }
          }
          return;
        }
        const left = node.left!;
        const right = node.right!;
        const leftBound = Math.max(0, angularDistance(unitDirection, left.center) - left.radius);
        const rightBound = Math.max(0, angularDistance(unitDirection, right.center) - right.radius);
        if (leftBound <= rightBound) {
          visit(left);
          visit(right);
        } else {
          visit(right);
          visit(left);
        }
      };
      visit(root);

      const onCoast = bestDistance <= ON_COAST_EPSILON;
      return {
        cellId: cell.id,
        isLand: isLand[cell.id]!,
        signedDistanceRadians: onCoast ? 0 : (isLand[cell.id] ? bestDistance : -bestDistance),
        closestPoint: bestPoint,
        segment: bestSegment,
      };
    },
  };
}
