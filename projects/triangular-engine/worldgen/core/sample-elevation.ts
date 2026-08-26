import { IPlanetGraphCell, IPlanetGraphCore } from './planet-graph';
import { dot, IVec3, sub } from './vec3';

/**
 * Nearest-site lookup: for spherical Voronoi cells generated from `graph`'s
 * own sites, the cell whose center has the largest dot product with a
 * direction *is* the cell containing that direction (nearest-site is the
 * defining property of a Voronoi cell). Brute-force over all cells — fine at
 * graph-build/chunk-bake time; callers on a hot per-frame path should batch
 * or cache rather than call this per-vertex per-tick.
 */
export function findCellAt(graph: IPlanetGraphCore, direction: IVec3): IPlanetGraphCell {
  let best = graph.cells[0];
  let bestDot = -Infinity;
  for (const cell of graph.cells) {
    const d = dot(cell.center, direction);
    if (d > bestDot) {
      bestDot = d;
      best = cell;
    }
  }
  return best;
}

/**
 * Planar barycentric weights of `p` against triangle `a,b,c` (Ericson,
 * *Real-Time Collision Detection*). `p` need not lie exactly in the
 * triangle's plane — only its component along the (b-a, c-a) basis is used —
 * which is what makes this a workable approximation for a spherical-triangle
 * wedge instead of requiring an exact plane projection.
 */
function barycentric(p: IVec3, a: IVec3, b: IVec3, c: IVec3): [number, number, number] {
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(p, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

/**
 * Average elevation of the 3 cells meeting at `cell.corners[cornerIndex]` — see
 * `corner-graph.ts`. O(1), no cell lookup — exported for callers (mesh builders,
 * chunk bakers) who already know which cell/corner they're touching and don't need
 * `sampleElevation()`'s `findCellAt()` search for an arbitrary query point.
 */
export function cellCornerElevation(cell: IPlanetGraphCell, cornerIndex: number, elevation: number[]): number {
  const n = cell.neighbors.length;
  const a = cell.id;
  const b = cell.neighbors[cornerIndex];
  const c = cell.neighbors[(cornerIndex + 1) % n];
  return (elevation[a] + elevation[b] + elevation[c]) / 3;
}

/**
 * Canonical elevation sample at an arbitrary direction on the planet —
 * runbook 022's M4a "bridge" function. Visual chunk meshes, ground-collider
 * patches, and (once built) the terrain-edit override layer all read
 * elevation through this single function so they can never silently
 * disagree with each other, even though they run at completely different
 * resolutions and update on completely different triggers (camera LOD vs.
 * vessel proximity vs. a player edit).
 *
 * Interpolates the same way the M3 preview mesh is tessellated: each cell is
 * a fan of triangles (center, corners[k], corners[k+1]); this finds which
 * fan wedge of the containing cell `direction` falls into and blends the
 * center's own elevation with the two corner elevations (each the average
 * of the 3 cells meeting there), so elevation is continuous across cell
 * borders — the corner value is identical from whichever of its 3 cells you
 * approach it from.
 */
export function sampleElevation(
  graph: IPlanetGraphCore,
  elevation: number[],
  direction: IVec3,
): number {
  const cell = findCellAt(graph, direction);
  const n = cell.neighbors.length;
  if (n < 3) return elevation[cell.id];

  let bestWedge = 0;
  let bestMinWeight = -Infinity;
  let bestWeights: [number, number, number] = [1, 0, 0];

  for (let k = 0; k < n; k++) {
    const weights = barycentric(direction, cell.center, cell.corners[k], cell.corners[(k + 1) % n]);
    const minWeight = Math.min(...weights);
    if (minWeight > bestMinWeight) {
      bestMinWeight = minWeight;
      bestWedge = k;
      bestWeights = weights;
    }
    if (minWeight >= 0) break; // direction lies inside this wedge — no need to keep scanning
  }

  const [u, v, w] = bestWeights.map((x) => Math.max(0, x));
  const sum = u + v + w || 1;

  return (
    (u * elevation[cell.id] +
      v * cellCornerElevation(cell, bestWedge, elevation) +
      w * cellCornerElevation(cell, (bestWedge + 1) % n, elevation)) /
    sum
  );
}
