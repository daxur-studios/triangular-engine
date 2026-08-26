import { cross, dot, IVec3, normalize, sub } from './vec3';

export interface IHullFace {
  /** Vertex indices into the input points array, CCW when viewed from outside the hull. */
  a: number;
  b: number;
  c: number;
  /** Outward-facing unit normal. */
  normal: IVec3;
}

export interface IConvexHull3 {
  faces: IHullFace[];
}

const VISIBILITY_EPSILON = 1e-9;

/**
 * Incremental 3D convex hull (points assumed to be in general position, e.g.
 * scattered on a sphere around the origin — no coplanar quadruples). For
 * points on a sphere, this convex hull *is* their Delaunay triangulation, and
 * its dual is the spherical Voronoi diagram (see `planet-graph.ts`).
 *
 * O(n^2) — fine for planet-scale cell counts (hundreds to low thousands),
 * not intended for huge point clouds.
 */
export function computeConvexHull3(points: IVec3[]): IConvexHull3 {
  if (points.length < 4) {
    throw new Error(`computeConvexHull3: need at least 4 points, got ${points.length}`);
  }

  const seedIndices = findNonCoplanarQuad(points);
  let faces = buildInitialTetrahedron(points, seedIndices);
  const seedSet = new Set(seedIndices);

  for (let i = 0; i < points.length; i++) {
    if (seedSet.has(i)) continue;
    faces = insertPoint(points, faces, i);
  }

  return { faces };
}

function faceNormal(points: IVec3[], a: number, b: number, c: number): IVec3 {
  return normalize(cross(sub(points[b], points[a]), sub(points[c], points[a])));
}

/**
 * Picks a well-separated, non-degenerate seed tetrahedron. Points ordered by
 * a spatial scheme (e.g. Fibonacci-sphere index order) can have their first
 * few indices tightly clustered, which produces a numerically thin starting
 * tetrahedron — so instead we search axis-extremal points (candidates most
 * likely to be far apart) and pick the combination with the largest volume.
 */
function findNonCoplanarQuad(points: IVec3[]): [number, number, number, number] {
  const candidates = new Set<number>();
  for (const axis of ['x', 'y', 'z'] as const) {
    let minIndex = 0;
    let maxIndex = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][axis] < points[minIndex][axis]) minIndex = i;
      if (points[i][axis] > points[maxIndex][axis]) maxIndex = i;
    }
    candidates.add(minIndex);
    candidates.add(maxIndex);
  }

  const pool = Array.from(candidates);
  let best: [number, number, number, number] | null = null;
  let bestVolume = 0;

  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      for (let c = b + 1; c < pool.length; c++) {
        for (let d = c + 1; d < pool.length; d++) {
          const [i0, i1, i2, i3] = [pool[a], pool[b], pool[c], pool[d]];
          const normal = faceNormal(points, i0, i1, i2);
          const volume = Math.abs(dot(normal, sub(points[i3], points[i0])));
          if (volume > bestVolume) {
            bestVolume = volume;
            best = [i0, i1, i2, i3];
          }
        }
      }
    }
  }

  if (!best || bestVolume <= VISIBILITY_EPSILON) {
    throw new Error('computeConvexHull3: could not find 4 non-coplanar points');
  }
  return best;
}

function buildInitialTetrahedron(
  points: IVec3[],
  [i0, i1, i2, i3]: [number, number, number, number],
): IHullFace[] {
  const centroid = {
    x: (points[i0].x + points[i1].x + points[i2].x + points[i3].x) / 4,
    y: (points[i0].y + points[i1].y + points[i2].y + points[i3].y) / 4,
    z: (points[i0].z + points[i1].z + points[i2].z + points[i3].z) / 4,
  };

  const candidateTriples: [number, number, number][] = [
    [i0, i1, i2],
    [i0, i1, i3],
    [i0, i2, i3],
    [i1, i2, i3],
  ];

  return candidateTriples.map(([a, b, c]) => orientOutward(points, a, b, c, centroid));
}

function orientOutward(
  points: IVec3[],
  a: number,
  b: number,
  c: number,
  awayFrom: IVec3,
): IHullFace {
  const normal = faceNormal(points, a, b, c);
  const outward = dot(normal, sub(points[a], awayFrom)) >= 0;
  return outward
    ? { a, b, c, normal }
    : { a: b, b: a, c, normal: faceNormal(points, b, a, c) };
}

function insertPoint(points: IVec3[], faces: IHullFace[], pointIndex: number): IHullFace[] {
  const point = points[pointIndex];

  const visible: IHullFace[] = [];
  const kept: IHullFace[] = [];
  for (const face of faces) {
    const visibility = dot(face.normal, sub(point, points[face.a]));
    (visibility > VISIBILITY_EPSILON ? visible : kept).push(face);
  }

  if (visible.length === 0) {
    // Point lies within the current hull (degenerate/near-duplicate input) — skip it.
    return faces;
  }

  const directedEdges = new Set<string>();
  for (const face of visible) {
    directedEdges.add(`${face.a}_${face.b}`);
    directedEdges.add(`${face.b}_${face.c}`);
    directedEdges.add(`${face.c}_${face.a}`);
  }

  const horizon: [number, number][] = [];
  for (const face of visible) {
    for (const [u, v] of [
      [face.a, face.b],
      [face.b, face.c],
      [face.c, face.a],
    ] as [number, number][]) {
      if (!directedEdges.has(`${v}_${u}`)) {
        horizon.push([u, v]);
      }
    }
  }

  // Horizon edges already carry the correct winding direction: a new face
  // (u, v, pointIndex) is outward-oriented by construction, no extra check
  // needed (and no origin-interior assumption, which doesn't hold for the
  // small intermediate hulls built early in the incremental process).
  const newFaces: IHullFace[] = horizon.map(([u, v]) => ({
    a: u,
    b: v,
    c: pointIndex,
    normal: faceNormal(points, u, v, pointIndex),
  }));

  return [...kept, ...newFaces];
}
