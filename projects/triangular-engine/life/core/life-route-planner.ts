import type { LifeHabitatQuery } from './life-habitat';
import { canTraverseLifeSegment } from './life-habitat';
import type { LifeVector3 } from './life-vector';
import type { LifeRouteSegment } from './life-deterministic-route';

export interface LifeRoutePlannerOptions {
  readonly query: LifeHabitatQuery;
  readonly start: LifeVector3;
  readonly goal: LifeVector3;
  readonly allowedKinds: readonly string[];
  readonly cellSize?: number;
  readonly maxSearchNodes?: number;
  readonly travelSpeed?: number;
  readonly universalTimeSeconds?: number;
}

/**
 * Deterministic coarse navigation for a nearby group. The world supplies the
 * habitat query; the planner only searches a bounded local grid. Stable
 * neighbor order and tie-breaking make the result reproducible for a given
 * world snapshot, while the route evaluator makes its motion jump-safe.
 */
export function planLifeRoute(options: LifeRoutePlannerOptions): LifeRouteSegment[] | null {
  const cellSize = Math.max(0.01, options.cellSize ?? 10);
  const maxNodes = Math.max(1, Math.floor(options.maxSearchNodes ?? 4096));
  const speed = Math.max(0.01, options.travelSpeed ?? 1);
  const start = gridPoint(options.start, cellSize);
  const goal = gridPoint(options.goal, cellSize);
  const open: Node[] = [{ point: start, g: 0, f: heuristic(start, goal), parent: null }];
  const best = new Map<string, Node>([[key(start), open[0]]]);
  const closed = new Set<string>();
  let searched = 0;

  while (open.length > 0 && searched++ < maxNodes) {
    open.sort((a, b) => a.f - b.f || a.g - b.g || key(a.point).localeCompare(key(b.point)));
    const current = open.shift()!;
    const currentKey = key(current.point);
    if (closed.has(currentKey)) continue;
    if (samePoint(current.point, goal)) {
      const points = simplifyPath(reconstruct(current), options, cellSize);
      return toSegments(points, cellSize, speed, options.query, options.universalTimeSeconds ?? 0);
    }
    closed.add(currentKey);

    for (const offset of NEIGHBORS) {
      const point = { x: current.point.x + offset.x, y: 0, z: current.point.z + offset.z };
      const pointKey = key(point);
      if (closed.has(pointKey)) continue;
      const worldPoint = surfacePoint(options.query, point, cellSize, options.goal.y);
      if (!isAllowed(options, worldPoint)) continue;
      const fromWorld = surfacePoint(options.query, current.point, cellSize, options.start.y);
      if (!canTraverseLifeSegment(options.query, fromWorld, worldPoint, options.allowedKinds, 3, options.universalTimeSeconds ?? 0)) continue;
      const g = current.g + Math.hypot(offset.x, offset.z);
      const previous = best.get(pointKey);
      if (previous && previous.g <= g) continue;
      const node: Node = { point, g, f: g + heuristic(point, goal), parent: current };
      best.set(pointKey, node);
      open.push(node);
    }
  }
  return null;
}

interface GridPoint { readonly x: number; readonly y: number; readonly z: number; }
interface Node { readonly point: GridPoint; readonly g: number; readonly f: number; readonly parent: Node | null; }
const NEIGHBORS = [
  { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 },
  { x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }, { x: 1, z: -1 },
];

function isAllowed(options: LifeRoutePlannerOptions, position: LifeVector3): boolean {
  const sample = options.query.sampleHabitat(position, options.universalTimeSeconds ?? 0);
  return options.allowedKinds.includes(sample.kind) && sample.suitability01 > 0;
}

function reconstruct(node: Node): GridPoint[] {
  const result: GridPoint[] = [];
  for (let current: Node | null = node; current; current = current.parent) result.push(current.point);
  return result.reverse();
}

function toSegments(
  points: readonly GridPoint[],
  cellSize: number,
  speed: number,
  query: LifeRoutePlannerOptions['query'],
  universalTimeSeconds: number,
): LifeRouteSegment[] {
  const segments: LifeRouteSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = surfacePoint(query, points[index - 1], cellSize, 0, universalTimeSeconds);
    const to = surfacePoint(query, points[index], cellSize, 0, universalTimeSeconds);
    segments.push({ from, to, durationSeconds: Math.max(1e-6, distance(from, to) / speed) });
  }
  return segments;
}

function simplifyPath(
  points: readonly GridPoint[],
  options: LifeRoutePlannerOptions,
  cellSize: number,
): GridPoint[] {
  if (points.length < 3) return [...points];
  const result: GridPoint[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let furthest = anchor + 1;
    for (let candidate = anchor + 2; candidate < points.length; candidate++) {
      const from = surfacePoint(options.query, points[anchor], cellSize, options.start.y, options.universalTimeSeconds ?? 0);
      const to = surfacePoint(options.query, points[candidate], cellSize, options.goal.y, options.universalTimeSeconds ?? 0);
      if (!isAllowed(options, to)) break;
      if (!canTraverseLifeSegment(
        options.query,
        from,
        to,
        options.allowedKinds,
        Math.max(3, Math.ceil(Math.hypot(points[candidate].x - points[anchor].x, points[candidate].z - points[anchor].z))),
        options.universalTimeSeconds ?? 0,
      )) break;
      furthest = candidate;
    }
    result.push(points[furthest]);
    anchor = furthest;
  }
  return result;
}

function surfacePoint(
  query: LifeHabitatQuery,
  point: GridPoint,
  cellSize: number,
  fallbackY: number,
  universalTimeSeconds = 0,
): LifeVector3 {
  const horizontal = toWorld(point, cellSize, fallbackY);
  return { ...horizontal, y: query.sampleHabitat(horizontal, universalTimeSeconds).surfaceY };
}

function gridPoint(position: LifeVector3, cellSize: number): GridPoint {
  return { x: Math.round(position.x / cellSize), y: 0, z: Math.round(position.z / cellSize) };
}
function toWorld(point: GridPoint, cellSize: number, y: number): LifeVector3 {
  return { x: point.x * cellSize, y, z: point.z * cellSize };
}
function heuristic(a: GridPoint, b: GridPoint): number { return Math.hypot(a.x - b.x, a.z - b.z); }
function distance(a: LifeVector3, b: LifeVector3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function samePoint(a: GridPoint, b: GridPoint): boolean { return a.x === b.x && a.z === b.z; }
function key(point: GridPoint): string { return `${point.x}:${point.z}`; }
