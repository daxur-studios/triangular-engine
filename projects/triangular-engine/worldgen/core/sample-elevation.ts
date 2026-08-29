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
 * Barycentric-blended elevation of `direction` against an already-resolved
 * containing `cell` — the shared math behind `sampleElevation()` (brute-force
 * lookup) and `sampleElevationNear()` (coherent walk): both just need a
 * different way of finding `cell` first, not a different blend.
 *
 * Interpolates the same way the M3 preview mesh is tessellated: each cell is
 * a fan of triangles (center, corners[k], corners[k+1]); this finds which
 * fan wedge of `cell` `direction` falls into and blends the center's own
 * elevation with the two corner elevations (each the average of the 3 cells
 * meeting there), so elevation is continuous across cell borders — the
 * corner value is identical from whichever of its 3 cells you approach it
 * from.
 */
function sampleElevationAtCell(cell: IPlanetGraphCell, direction: IVec3, elevation: number[]): number {
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

/**
 * Canonical elevation sample at an arbitrary direction on the planet —
 * runbook 022's M4a "bridge" function. Visual chunk meshes, ground-collider
 * patches, and (once built) the terrain-edit override layer all read
 * elevation through this single function so they can never silently
 * disagree with each other, even though they run at completely different
 * resolutions and update on completely different triggers (camera LOD vs.
 * vessel proximity vs. a player edit).
 */
export function sampleElevation(
  graph: IPlanetGraphCore,
  elevation: number[],
  direction: IVec3,
): number {
  return sampleElevationAtCell(findCellAt(graph, direction), direction, elevation);
}

/**
 * `findCellAt()`'s own doc comment flagged its brute-force scan as too slow
 * for a caller sampling many nearby points per query (a dense local grid —
 * M4d's collider patches, runbook 022) — this is that faster path. Voronoi
 * cell membership is dot-product-nearest-site, which is unimodal across the
 * neighbor graph for a convex site set, so greedily stepping to whichever
 * neighbor of the current guess improves the dot product further always
 * converges on the true containing cell (a standard Delaunay/Voronoi walk),
 * without ever visiting a cell far from the walk. Seeded from `hintCellId`
 * instead of scanning every cell — a caller sampling a grid of nearby
 * directions passes the previous sample's resolved cell as the next hint, so
 * each walk after the first one typically resolves in 0-2 hops instead of a
 * full `cellCount` scan.
 */
export function findCellNear(graph: IPlanetGraphCore, direction: IVec3, hintCellId: number): IPlanetGraphCell {
  let current = graph.cells[hintCellId];
  let currentDot = dot(current.center, direction);
  for (;;) {
    let best = current;
    let bestDot = currentDot;
    for (const neighborId of current.neighbors) {
      const neighbor = graph.cells[neighborId];
      const d = dot(neighbor.center, direction);
      if (d > bestDot) {
        bestDot = d;
        best = neighbor;
      }
    }
    if (best === current) return current;
    current = best;
    currentDot = bestDot;
  }
}

/** `sampleElevation()`'s value, plus the resolved cell id so a caller sampling a coherent
 * sequence of nearby directions (e.g. a grid, row by row) can feed it back in as the next
 * call's `hintCellId` — see `findCellNear()`. */
export function sampleElevationNear(
  graph: IPlanetGraphCore,
  elevation: number[],
  direction: IVec3,
  hintCellId: number,
): { value: number; cellId: number } {
  const cell = findCellNear(graph, direction, hintCellId);
  return { value: sampleElevationAtCell(cell, direction, elevation), cellId: cell.id };
}
