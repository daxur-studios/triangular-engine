import { createSeededRandom } from './seeded-random';
import { add, cross, IVec3, length, normalize, scale, sub } from './vec3';

export interface IFractalDetailParams {
  /** Recursion depth. Each level roughly doubles point density; `0` returns the input unchanged. */
  levels?: number;
  /** Displacement amplitude at level 0, as a fraction of the edge being split. */
  amplitude?: number;
  /** Amplitude multiplier applied per additional level (0-1) — keeps deeper subdivisions subtler than the first pass. */
  falloff?: number;
  seed?: number;
}

const DEFAULTS: Required<IFractalDetailParams> = {
  levels: 4,
  amplitude: 0.1,
  falloff: 0.45,
  seed: 0,
};

/**
 * Recursive midpoint displacement — the standard fractal-coastline construction (the "how long
 * is the coast of Britain" technique), adapted to a spherical domain: every edge's midpoint is
 * nudged sideways within the sphere's tangent plane at that point (perpendicular to both the
 * edge and the sphere normal, via `cross(mid, edgeVector)`), then the whole polyline is
 * renormalized back onto the unit sphere. Unlike curve-smoothing through existing vertices, this
 * inserts real new points, so it adds detail rather than just interpolating what's already there.
 *
 * Deterministic per `params.seed`: each edge's displacement is seeded from `(seed, level, index)`
 * alone, so re-running with the same seed reproduces the same shape. That seeding is only stable
 * for a single polyline traced once in a fixed order (as `extractCoastlines()`'s stitched loops
 * and `traceRivers()`'s paths are) — it does NOT give two independently-iterated polygons that
 * happen to share an edge the same displaced points for that edge. Don't use this on cell-fill
 * boundaries shared by adjacent cells without first keying the seed off a canonical per-edge id
 * (e.g. the sorted corner-pair, as `coastlines.ts`'s `cornerKey`/`edgeKey` already do) — otherwise
 * neighboring fills will diverge at the shared edge and leave gaps or overlaps.
 */
export function addFractalDetail(points: IVec3[], closed: boolean, params: IFractalDetailParams = {}): IVec3[] {
  const p = { ...DEFAULTS, ...params };
  if (points.length < 2) return points;

  let current = points;
  for (let level = 0; level < p.levels; level++) {
    current = subdivideOnce(current, undefined, closed, p.amplitude * Math.pow(p.falloff, level), p.seed, level).points;
  }
  return current;
}

/**
 * Same recursive midpoint displacement as `addFractalDetail`, but also carries a parallel
 * per-point scalar (e.g. `IPlanetRivers.riverFlow`'s per-corner flow count) through the same
 * subdivision in lockstep, so the returned `points`/`flow` stay the same length and index
 * correspondence a caller already relies on (both the 2D map's per-edge width lookup and the 3D
 * ribbon mesh's `sqrt(flow)` width read `flow[k]` against `points[k]`). A new midpoint's flow is
 * the average of the two corners it sits between — consistent with flow only growing downstream,
 * so the inserted point's value falls between its neighbors rather than spiking or resetting.
 */
export function addFractalDetailWithFlow(
  points: IVec3[],
  flow: number[],
  closed: boolean,
  params: IFractalDetailParams = {},
): { points: IVec3[]; flow: number[] } {
  const p = { ...DEFAULTS, ...params };
  if (points.length < 2) return { points, flow };

  let currentPoints = points;
  let currentFlow = flow;
  for (let level = 0; level < p.levels; level++) {
    const result = subdivideOnce(currentPoints, currentFlow, closed, p.amplitude * Math.pow(p.falloff, level), p.seed, level);
    currentPoints = result.points;
    currentFlow = result.flow!;
  }
  return { points: currentPoints, flow: currentFlow };
}

function subdivideOnce(
  points: IVec3[],
  flow: number[] | undefined,
  closed: boolean,
  amplitude: number,
  seed: number,
  level: number,
): { points: IVec3[]; flow: number[] | undefined } {
  const n = points.length;
  const edgeCount = closed ? n : n - 1;
  const resultPoints: IVec3[] = [];
  const resultFlow: number[] | undefined = flow ? [] : undefined;

  for (let i = 0; i < edgeCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    resultPoints.push(a);
    resultPoints.push(displaceMidpoint(a, b, amplitude, seed, level, i));
    if (flow && resultFlow) {
      const fa = flow[i];
      const fb = flow[(i + 1) % n];
      resultFlow.push(fa);
      resultFlow.push((fa + fb) / 2);
    }
  }
  if (!closed) {
    resultPoints.push(points[n - 1]);
    if (flow && resultFlow) resultFlow.push(flow[n - 1]);
  }

  return { points: resultPoints, flow: resultFlow };
}

function displaceMidpoint(a: IVec3, b: IVec3, amplitude: number, seed: number, level: number, index: number): IVec3 {
  const mid = normalize(scale(add(a, b), 0.5));
  const edgeVector = sub(b, a);
  const edgeLength = length(edgeVector);
  if (edgeLength === 0) return mid;

  // `mid` is the sphere normal at the midpoint; crossing it with the edge direction gives the
  // in-tangent-plane direction perpendicular to the edge — i.e. the "sideways" displacement axis.
  const perp = normalize(cross(mid, edgeVector));
  const rng = createSeededRandom(
    ((seed >>> 0) ^ Math.imul(level + 1, 0x9e3779b9) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0,
  );
  const t = (rng() - 0.5) * 2; // [-1, 1]
  return normalize(add(mid, scale(perp, edgeLength * amplitude * t)));
}
