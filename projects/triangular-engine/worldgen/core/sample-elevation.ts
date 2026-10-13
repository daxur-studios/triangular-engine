import { IPlanetGraphCell, IPlanetGraphCore } from './planet-graph';
import { dot, IVec3 } from './vec3';

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
  return sampleElevationSurfaceAtCell(cell, direction, elevation).elevation;
}

export interface ICellElevationSurfaceSample {
  /** Height on the shared fan-triangulated cell surface. */
  elevation: number;
  /** Barycentric weight of the cell site; exactly zero on a cell edge. */
  centerWeight: number;
  /** Interpolated weight of vertices that touch both land and water cells. */
  coastlineWeight: number;
}

/**
 * Sample the cell fan while returning geometric weights needed by local terrain
 * shaping. When a final land mask and datum are supplied, every mixed land/water
 * fan vertex is pinned to the datum, so the shared coast edge has one height.
 */
export function sampleElevationSurfaceAtCell(
  cell: IPlanetGraphCell,
  direction: IVec3,
  elevation: number[],
  isLand?: readonly boolean[],
  seaLevel?: number,
): ICellElevationSurfaceSample {
  const n = cell.neighbors.length;
  if (n < 3) return { elevation: elevation[cell.id]!, centerWeight: 1, coastlineWeight: 0 };

  // Hot path (every terrain sample), written on scalars so no per-wedge vectors or arrays are
  // allocated. For each fan wedge (centre `a`, corners `b`, `c`) the unit ray `p` is expressed as a
  // cone barycentric combination of its three vertices. That makes the centre weight exactly zero on
  // the great-circle arc between the two corner vertices, so adjacent Voronoi cells use the same two
  // endpoint weights along their shared edge.
  const a = cell.center;
  const px = direction.x;
  const py = direction.y;
  const pz = direction.z;
  let bestWedge = 0;
  let bestMinWeight = -Infinity;
  let bestW0 = 1;
  let bestW1 = 0;
  let bestW2 = 0;

  for (let k = 0; k < n; k++) {
    const b = cell.corners[k];
    const c = cell.corners[(k + 1) % n];
    // bc = cross(b, c)
    const bcx = b.y * c.z - b.z * c.y;
    const bcy = b.z * c.x - b.x * c.z;
    const bcz = b.x * c.y - b.y * c.x;
    const determinant = a.x * bcx + a.y * bcy + a.z * bcz;
    let w0: number;
    let w1: number;
    let w2: number;
    if (Math.abs(determinant) < 1e-12) {
      w0 = 1;
      w1 = 0;
      w2 = 0;
    } else {
      // pc = cross(p, c), bp = cross(b, p)
      const pcx = py * c.z - pz * c.y;
      const pcy = pz * c.x - px * c.z;
      const pcz = px * c.y - py * c.x;
      const bpx = b.y * pz - b.z * py;
      const bpy = b.z * px - b.x * pz;
      const bpz = b.x * py - b.y * px;
      w0 = (px * bcx + py * bcy + pz * bcz) / determinant;
      w1 = (a.x * pcx + a.y * pcy + a.z * pcz) / determinant;
      w2 = (a.x * bpx + a.y * bpy + a.z * bpz) / determinant;
    }
    const minWeight = Math.min(w0, w1, w2);
    if (minWeight > bestMinWeight) {
      bestMinWeight = minWeight;
      bestWedge = k;
      bestW0 = w0;
      bestW1 = w1;
      bestW2 = w2;
    }
    if (minWeight >= 0) break; // direction lies inside this wedge — no need to keep scanning
  }

  const u = Math.max(0, bestW0);
  const v = Math.max(0, bestW1);
  const w = Math.max(0, bestW2);
  const sum = u + v + w || 1;

  const firstCornerIndex = bestWedge;
  const secondCornerIndex = (bestWedge + 1) % n;
  const firstIsCoast = isCoastCorner(cell, firstCornerIndex, n, isLand);
  const secondIsCoast = isCoastCorner(cell, secondCornerIndex, n, isLand);
  const firstElevation = firstIsCoast && seaLevel !== undefined
    ? seaLevel
    : cellCornerElevation(cell, firstCornerIndex, elevation);
  const secondElevation = secondIsCoast && seaLevel !== undefined
    ? seaLevel
    : cellCornerElevation(cell, secondCornerIndex, elevation);
  return {
    elevation: (u * elevation[cell.id]! + v * firstElevation + w * secondElevation) / sum,
    centerWeight: u / sum,
    coastlineWeight: (v * Number(firstIsCoast) + w * Number(secondIsCoast)) / sum,
  };
}

/** True when the 3 cells meeting at `cell.corners[cornerIndex]` are not all land or all water. */
function isCoastCorner(
  cell: IPlanetGraphCell,
  cornerIndex: number,
  neighbourCount: number,
  isLand: readonly boolean[] | undefined,
): boolean {
  if (!isLand) return false;
  const a = cell.id;
  const b = cell.neighbors[cornerIndex]!;
  const c = cell.neighbors[(cornerIndex + 1) % neighbourCount]!;
  return isLand[a] !== isLand[b] || isLand[b] !== isLand[c];
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
