import { IPlanetGraphCell, IPlanetGraphCore } from './planet-graph';
import { cellCornerElevation } from './sample-elevation';
import { createSeededRandom } from './seeded-random';
import { cross, dot, IVec3, normalize, projectOnTangentPlane, vec3 } from './vec3';

interface IPoint2D {
  x: number;
  y: number;
}

export interface ISubCell {
  /** Unit-sphere direction of this sub-cell's own seed site — the sub-cell equivalent of
   * `IPlanetGraphCell.center`. */
  site: IVec3;
  /** Ordered, closed polygon boundary in 3D. Sub-cells reach the parent cell's real edge; where
   * a boundary vertex coincides with one of the parent's own corners it is the exact same
   * `IVec3`/elevation pair a neighboring cell's mesh relies on (see this module's doc comment). */
  corners: IVec3[];
}

export interface ISubCellParams {
  /** How many interior sub-cells to attempt seeding. Actual count can come out lower — a
   * seed whose clip degenerates to under 3 vertices is dropped. */
  subCellCount?: number;
  seed?: number;
  /** Lloyd-style relaxation passes on the interior seed sites (recompute each as its own
   * clipped sub-cell's centroid, then re-clip) — smooths out slivers a raw random scatter
   * produces, same motivation as `lloyd-relaxation.ts` for the top-level planet graph, just
   * re-implemented locally on the 2D tangent-plane projection since this only ever runs on one
   * small, already near-flat region. */
  relaxIterations?: number;
}

const DEFAULTS = {
  subCellCount: 9,
  relaxIterations: 2,
};

function polygonCentroid2D(polygon: IPoint2D[]): IPoint2D {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const cr = a.x * b.y - b.x * a.y;
    area += cr;
    cx += (a.x + b.x) * cr;
    cy += (a.y + b.y) * cr;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) {
    let sx = 0;
    let sy = 0;
    for (const p of polygon) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / n, y: sy / n };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function pointInPolygon2D(p: IPoint2D, polygon: IPoint2D[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Sutherland-Hodgman clip of `polygon` (simple, assumed roughly convex) to the half-plane of
 * the perpendicular bisector between `keep` and `other` that contains `keep` — the standard
 * way to build one Voronoi cell as the intersection of half-planes against every other site. */
function clipToBisector(polygon: IPoint2D[], keep: IPoint2D, other: IPoint2D): IPoint2D[] {
  const mx = (keep.x + other.x) / 2;
  const my = (keep.y + other.y) / 2;
  const nx = keep.x - other.x;
  const ny = keep.y - other.y;
  const side = (p: IPoint2D): number => (p.x - mx) * nx + (p.y - my) * ny;

  const n = polygon.length;
  if (n === 0) return [];
  const output: IPoint2D[] = [];
  for (let i = 0; i < n; i++) {
    const cur = polygon[i];
    const next = polygon[(i + 1) % n];
    const curSide = side(cur);
    const nextSide = side(next);
    if (curSide >= 0) output.push(cur);
    if (curSide >= 0 !== nextSide >= 0) {
      const t = curSide / (curSide - nextSide);
      output.push({ x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t });
    }
  }
  return output;
}

function seedPointsInPolygon(polygon: IPoint2D[], count: number, rng: () => number): IPoint2D[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const points: IPoint2D[] = [];
  let guard = 0;
  while (points.length < count && guard < count * 300) {
    guard++;
    const candidate = { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) };
    if (pointInPolygon2D(candidate, polygon)) points.push(candidate);
  }
  return points;
}

/** Builds each seed's own cell as `boundary` clipped by its bisector against every other seed
 * — O(seedCount²) polygon clips, fine at the seed counts this is ever called with (single
 * digits to low tens) and only ever run at mesh-build time, not per frame. */
function voronoiWithinPolygon2D(boundary: IPoint2D[], seeds: IPoint2D[]): IPoint2D[][] {
  return seeds.map((seed, i) => {
    let poly = boundary;
    for (let j = 0; j < seeds.length; j++) {
      if (j === i) continue;
      poly = clipToBisector(poly, seed, seeds[j]);
      if (poly.length === 0) break;
    }
    return poly;
  });
}

function barycentric2D(p: IPoint2D, a: IPoint2D, b: IPoint2D, c: IPoint2D): [number, number, number] {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = p.x - a.x;
  const v2y = p.y - a.y;
  const d00 = v0x * v0x + v0y * v0y;
  const d01 = v0x * v1x + v0y * v1y;
  const d11 = v1x * v1x + v1y * v1y;
  const d20 = v2x * v0x + v2y * v0y;
  const d21 = v2x * v1x + v2y * v1y;
  const denom = d00 * d11 - d01 * d01;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

/** Same fan-wedge blend `sample-elevation.ts`'s `sampleElevationAtCell()` uses for a real
 * cell, reimplemented on the synthetic "virtual cell" this module builds for interior points:
 * site at the tangent-plane origin (the parent's own center, `centerElevation`), boundary =
 * the parent's real corners (`boundary2D`/`cornerElevations`). At the boundary itself this
 * reduces to exactly the corner's own elevation, matching what the parent cell's own
 * unsubdivided mesh renders there. */
function fanElevationAt2D(
  p: IPoint2D,
  boundary2D: IPoint2D[],
  cornerElevations: number[],
  centerElevation: number,
): number {
  const center: IPoint2D = { x: 0, y: 0 };
  const n = boundary2D.length;
  let bestWedge = 0;
  let bestMinWeight = -Infinity;
  let bestWeights: [number, number, number] = [1, 0, 0];
  for (let k = 0; k < n; k++) {
    const weights = barycentric2D(p, center, boundary2D[k], boundary2D[(k + 1) % n]);
    const minWeight = Math.min(...weights);
    if (minWeight > bestMinWeight) {
      bestMinWeight = minWeight;
      bestWedge = k;
      bestWeights = weights;
    }
    if (minWeight >= 0) break;
  }
  const [u, v, w] = bestWeights.map((x) => Math.max(0, x));
  const sum = u + v + w || 1;
  return (
    (u * centerElevation + v * cornerElevations[bestWedge] + w * cornerElevations[(bestWedge + 1) % n]) / sum
  );
}

/**
 * Subdivides one cell into real, irregular interior sub-cells, edge-to-edge — the actual
 * "cells inside cells" version of per-cell detail, replacing two earlier attempts: a
 * concentric-ring relief pass that only bent a cell's silhouette radially (a spider web, no
 * real cell edges), and a collar-buffered version that stopped subdivision short of the real
 * boundary and left most of the cell's area untouched. Only meant for a small, bounded,
 * explicitly-chosen set of cells (see `chunking.ts`'s `buildChunkMeshData()` /
 * `buildChunkLod1MeshData()` `subdividedCellIds` param) — this function itself has no opinion
 * on which cells qualify or how close the camera needs to be.
 *
 * ## Edge-to-edge, not collar-buffered
 *
 * The parent cell's own corners (`cell.corners`) are used directly as the clip boundary for
 * the interior Voronoi diagram, so sub-cells reach all the way out to the real edge — no
 * reserved, unsubdivided margin. The parent's corners themselves are always reused verbatim
 * (same object values, same `cellCornerElevation()`), so they stay exactly consistent with
 * whatever neighboring cell or LOD relies on them, per the no-crack guarantee documented on
 * `chunking.ts`'s `IChunkBoundaryLoop`.
 *
 * A genuinely new point *between* two corners — where a bisector between two interior seeds
 * happens to reach the parent boundary — has no way to stay bit-exact against an unsubdivided
 * neighbor at every possible elevation-display scale (the neighbor draws one straight chord
 * between the two corners; matching it at all scales would require the split point itself to
 * carry no elevation, which isn't generally true). This function accepts that as a small,
 * bounded seam rather than reserving a visible fraction of every cell as flat buffer: the
 * split point is reconstructed through the same tangent-plane projection used for the corners
 * themselves (`to2D`/`to3D`, exact inverses of one another), so it lands as close to the true
 * chord as a smooth reconstruction can get, and the deviation shrinks to zero as the split
 * point approaches either corner.
 */
export function buildSubdividedCellMeshData(
  cell: IPlanetGraphCell,
  elevation: number[],
  pushVertex: (p: IVec3, e: number, cellId: number) => void,
  params: ISubCellParams = {},
): void {
  const p = { ...DEFAULTS, ...params };
  const n = cell.corners.length;
  if (n < 3) return;

  const centerElevation = elevation[cell.id];
  const cornerElevations = cell.corners.map((_, k) => cellCornerElevation(cell, k, elevation));

  const planeNormal = normalize(cell.center);
  const arbitrary = Math.abs(planeNormal.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const tangentU = normalize(cross(arbitrary, planeNormal));
  const tangentV = cross(planeNormal, tangentU);
  const to2D = (v: IVec3): IPoint2D => {
    const proj = projectOnTangentPlane(v, planeNormal);
    return { x: dot(proj, tangentU), y: dot(proj, tangentV) };
  };
  // Correct inverse of to2D(): a unit vector v decomposes as
  // v = dot(v,planeNormal)*planeNormal + x*tangentU + y*tangentV (orthonormal basis), so
  // reconstructing it needs the *true* normal-axis component sqrt(1 - x² - y²), not a fixed 1 —
  // using 1 (i.e. `normalize(planeNormal + x*tangentU + y*tangentV)`) silently returns a
  // different direction for any nonzero (x,y).
  const to3D = (v: IPoint2D): IVec3 => {
    const r2 = v.x * v.x + v.y * v.y;
    const z = Math.sqrt(Math.max(0, 1 - r2));
    return normalize({
      x: planeNormal.x * z + v.x * tangentU.x + v.y * tangentV.x,
      y: planeNormal.y * z + v.x * tangentU.y + v.y * tangentV.y,
      z: planeNormal.z * z + v.x * tangentU.z + v.y * tangentV.z,
    });
  };

  // The real cell boundary, used directly as the Voronoi clip region — no collar, no reserved
  // margin. `clipToBisector` never perturbs a retained vertex, so any output polygon vertex
  // that IS still one of these boundary corners survives every clip bit-identical to
  // `boundary2D[k]`; `resolvePoint` below detects that case and snaps back to the exact
  // `cell.corners[k]` / `cornerElevations[k]` pair so real corners always stay pixel-identical
  // to whatever a neighboring cell or LOD renders there.
  const boundary2D = cell.corners.map(to2D);
  const CORNER_EPS2 = 1e-12;
  const resolvePoint = (pt: IPoint2D): { pos: IVec3; elev: number } => {
    for (let k = 0; k < n; k++) {
      const dx = pt.x - boundary2D[k].x;
      const dy = pt.y - boundary2D[k].y;
      if (dx * dx + dy * dy < CORNER_EPS2) return { pos: cell.corners[k], elev: cornerElevations[k] };
    }
    return { pos: to3D(pt), elev: fanElevationAt2D(pt, boundary2D, cornerElevations, centerElevation) };
  };

  const rng = createSeededRandom(((p.seed ?? 0) + cell.id * 104729 + 17) >>> 0);
  let seeds = seedPointsInPolygon(boundary2D, Math.max(1, p.subCellCount), rng);
  if (seeds.length === 0) return;

  let subCellPolygons: IPoint2D[][] = [];
  const relaxIterations = Math.max(0, p.relaxIterations);
  for (let iter = 0; iter <= relaxIterations; iter++) {
    subCellPolygons = voronoiWithinPolygon2D(boundary2D, seeds);
    if (iter < relaxIterations) {
      seeds = subCellPolygons.map((poly, i) => (poly.length >= 3 ? polygonCentroid2D(poly) : seeds[i]));
    }
  }

  for (let i = 0; i < seeds.length; i++) {
    const poly2D = subCellPolygons[i];
    if (poly2D.length < 3) continue;
    const siteElevation = fanElevationAt2D(seeds[i], boundary2D, cornerElevations, centerElevation);
    const site3D = to3D(seeds[i]);
    const resolved = poly2D.map(resolvePoint);
    const m = resolved.length;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      pushVertex(site3D, siteElevation, cell.id);
      pushVertex(resolved[k].pos, resolved[k].elev, cell.id);
      pushVertex(resolved[k2].pos, resolved[k2].elev, cell.id);
    }
  }
}

/** Local copy of `chunking.ts`'s `buildChunkBoundaryLoop()` walk, scoped to a plain `cellIds`
 * list instead of a full `IPlanetChunk`/`chunkIdByCell` pair — kept as a separate small
 * function here rather than imported, because `chunking.ts` already imports
 * `buildSubdividedCellMeshData` from this module and importing the other way would create a
 * circular module dependency. Same technique, same guarantee as the original: the returned
 * positions are the graph's own shared corner objects (`===`-identical to whatever a
 * neighboring, non-subdivided cell renders for that corner), never recomputed points — see
 * `chunking.ts`'s `IChunkBoundaryLoop` doc comment for why that's what makes a boundary
 * crack-free by construction. Returns `null` under the same conditions the original does (no
 * boundary, degenerate loop, non-simple region) — callers fall back to skipping the region. */
function walkRegionBoundary(
  graph: IPlanetGraphCore,
  elevation: number[],
  cellIds: readonly number[],
): { positions: IVec3[]; elevations: number[] } | null {
  const inRegion = new Set(cellIds);
  const nextByStart = new Map<IVec3, IVec3>();
  const elevationByVertex = new Map<IVec3, number>();

  for (const cellId of cellIds) {
    const cell = graph.cells[cellId];
    const n = cell.corners.length;
    if (n < 3) continue;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (inRegion.has(cell.neighbors[k2])) continue;
      nextByStart.set(cell.corners[k], cell.corners[k2]);
      elevationByVertex.set(cell.corners[k], cellCornerElevation(cell, k, elevation));
      elevationByVertex.set(cell.corners[k2], cellCornerElevation(cell, k2, elevation));
    }
  }

  if (nextByStart.size < 3) return null;

  const start = nextByStart.keys().next().value as IVec3;
  const positions: IVec3[] = [start];
  let cur = start;
  for (let steps = 0; steps < nextByStart.size; steps++) {
    const nxt = nextByStart.get(cur);
    if (!nxt || nxt === start) break;
    positions.push(nxt);
    cur = nxt;
  }
  if (positions.length < 3 || positions.length !== nextByStart.size) return null;

  const elevations = positions.map((pos) => elevationByVertex.get(pos) ?? 0);
  return { positions, elevations };
}

/**
 * Region-scoped generalization of `buildSubdividedCellMeshData()`: joins several mutually
 * in-range coarse cells into one shared interior Voronoi diagram, so the boundary between two
 * subdivided neighbors becomes a real interior bisector instead of the hard straight parent
 * edge each cell's own independent clip (the single-cell function above) otherwise produces —
 * this is the fix for the "straight-line seam between two subdivided cells" artifact.
 *
 * A cell's edge against a neighbor that is *not* part of `cellIds` is untouched by this: the
 * region's own outer boundary (`walkRegionBoundary()`) reuses the graph's real shared corner
 * objects there too, so it stays exactly the same straight edge an out-of-range/unsubdivided
 * neighbor renders. There is no separate "snap to straight" branch for that case — the single
 * outer clip boundary produces straight behavior at the region's edge and organic jagged
 * behavior in its interior, automatically, the same way `buildChunkLod1MeshData()`'s merged
 * group boundaries never crack against a neighboring chunk without any stitching pass (see that
 * function's doc comment).
 *
 * A 1-cell region reproduces `buildSubdividedCellMeshData()`'s own output for that cell bit for
 * bit (same per-cell seeding formula, same corner-snap discipline, same elevation blend) — this
 * function subsumes it. `buildSubdividedCellMeshData()` stays around as the cheaper path for a
 * lone subdivided cell with no in-range neighbor (no boundary-loop walk, no multi-cell pooling).
 */
export function buildSubdividedRegionMeshData(
  graph: IPlanetGraphCore,
  elevation: number[],
  cellIds: readonly number[],
  pushVertex: (p: IVec3, e: number, cellId: number) => void,
  params: ISubCellParams = {},
): void {
  const p = { ...DEFAULTS, ...params };
  if (cellIds.length === 0) return;

  // One shared tangent plane, centered on the region's own centroid direction — not any single
  // member cell's own center — so every member's seeds and the outer boundary project into the
  // same frame. Same "one shared frame, not N independently-recomputed ones" discipline
  // `buildChunkLod1MeshData()` already uses for its own boundary-loop triangulation.
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const id of cellIds) {
    const c = graph.cells[id].center;
    sx += c.x;
    sy += c.y;
    sz += c.z;
  }
  const centerLen = Math.hypot(sx, sy, sz) || 1;
  const planeNormal: IVec3 = { x: sx / centerLen, y: sy / centerLen, z: sz / centerLen };
  const arbitrary = Math.abs(planeNormal.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const tangentU = normalize(cross(arbitrary, planeNormal));
  const tangentV = cross(planeNormal, tangentU);
  const to2D = (v: IVec3): IPoint2D => {
    const proj = projectOnTangentPlane(v, planeNormal);
    return { x: dot(proj, tangentU), y: dot(proj, tangentV) };
  };
  const to3D = (v: IPoint2D): IVec3 => {
    const r2 = v.x * v.x + v.y * v.y;
    const z = Math.sqrt(Math.max(0, 1 - r2));
    return normalize({
      x: planeNormal.x * z + v.x * tangentU.x + v.y * tangentV.x,
      y: planeNormal.y * z + v.x * tangentU.y + v.y * tangentV.y,
      z: planeNormal.z * z + v.x * tangentU.z + v.y * tangentV.z,
    });
  };

  const loop = walkRegionBoundary(graph, elevation, cellIds);
  if (!loop) return;
  const regionBoundary2D = loop.positions.map(to2D);
  const CORNER_EPS2 = 1e-12;
  const resolvePos = (pt: IPoint2D): { pos: IVec3; cornerIndex: number } => {
    for (let k = 0; k < regionBoundary2D.length; k++) {
      const dx = pt.x - regionBoundary2D[k].x;
      const dy = pt.y - regionBoundary2D[k].y;
      if (dx * dx + dy * dy < CORNER_EPS2) return { pos: loop.positions[k], cornerIndex: k };
    }
    return { pos: to3D(pt), cornerIndex: -1 };
  };

  // Per-member-cell data: own footprint (for seeding + elevation blend), same corner-elevation
  // formula `buildSubdividedCellMeshData()` uses, just projected into the shared region frame
  // above instead of each cell's own. Seeds are still scattered per `cell.id`-keyed RNG within
  // that cell's *own* footprint (unchanged determinism from the single-cell function) — what's
  // new is the joint clip below, not the seeding.
  interface IMember {
    cell: IPlanetGraphCell;
    corners2D: IPoint2D[];
    site2D: IPoint2D;
    cornerElevations: number[];
    centerElevation: number;
  }
  const members: IMember[] = cellIds.map((id) => {
    const cell = graph.cells[id];
    return {
      cell,
      corners2D: cell.corners.map(to2D),
      site2D: to2D(cell.center),
      cornerElevations: cell.corners.map((_, k) => cellCornerElevation(cell, k, elevation)),
      centerElevation: elevation[cell.id],
    };
  });

  // `fanElevationAt2D()` assumes its fan site sits at the local origin (true by construction in
  // the single-cell function, where the whole 2D frame is centered on that one cell) — here the
  // shared frame is centered on the *region's* centroid instead, so a member's own site is
  // offset from the origin. Barycentric weights are translation-invariant, so translating both
  // the query point and the member's own boundary by `-site2D` before calling it reproduces
  // exactly the same per-member fan blend the single-cell function would compute, just relative
  // to whichever member cell owns this particular point rather than always "the" one cell.
  const elevationForOwner = (pt2D: IPoint2D, owner: IMember): number => {
    const rel: IPoint2D = { x: pt2D.x - owner.site2D.x, y: pt2D.y - owner.site2D.y };
    const boundaryRel = owner.corners2D.map((c) => ({ x: c.x - owner.site2D.x, y: c.y - owner.site2D.y }));
    return fanElevationAt2D(rel, boundaryRel, owner.cornerElevations, owner.centerElevation);
  };

  // Seeds pooled from every member's own footprint, then clipped jointly against the *region's*
  // outer boundary — this pooling + joint clip (instead of each member clipping only against
  // its own corners, as the single-cell function does) is what turns the shared interior edge
  // between two members into a real Voronoi bisector instead of the region's internal
  // cell-graph edges.
  let seeds: IPoint2D[] = [];
  let seedOwner: IMember[] = [];
  for (const member of members) {
    const rng = createSeededRandom(((p.seed ?? 0) + member.cell.id * 104729 + 17) >>> 0);
    const memberSeeds = seedPointsInPolygon(member.corners2D, Math.max(1, p.subCellCount), rng);
    for (const s of memberSeeds) {
      seeds.push(s);
      seedOwner.push(member);
    }
  }
  if (seeds.length === 0) return;

  let subCellPolygons: IPoint2D[][] = [];
  const relaxIterations = Math.max(0, p.relaxIterations);
  for (let iter = 0; iter <= relaxIterations; iter++) {
    subCellPolygons = voronoiWithinPolygon2D(regionBoundary2D, seeds);
    if (iter < relaxIterations) {
      seeds = subCellPolygons.map((poly, i) => (poly.length >= 3 ? polygonCentroid2D(poly) : seeds[i]));
    }
  }

  for (let i = 0; i < seeds.length; i++) {
    const poly2D = subCellPolygons[i];
    if (poly2D.length < 3) continue;

    // Ownership is by final geometric position (nearest member center, compared as a true
    // angular/dot-product distance on the sphere rather than in the distortion-prone 2D
    // projection), not by which member's RNG originally produced this seed — a seed born for
    // one cell can end up geometrically closer to a neighbor after the joint clip, and that
    // cross-over is exactly what makes the shared boundary read as organic instead of snapped
    // to the coarse cell shape.
    const site3D = to3D(seeds[i]);
    let owner = seedOwner[i];
    let bestDot = dot(site3D, owner.cell.center);
    for (const member of members) {
      const d = dot(site3D, member.cell.center);
      if (d > bestDot) {
        bestDot = d;
        owner = member;
      }
    }

    const siteElevation = elevationForOwner(seeds[i], owner);
    const resolved = poly2D.map((pt) => {
      const { pos, cornerIndex } = resolvePos(pt);
      const elev = cornerIndex >= 0 ? loop.elevations[cornerIndex] : elevationForOwner(pt, owner);
      return { pos, elev };
    });
    const m = resolved.length;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      pushVertex(site3D, siteElevation, owner.cell.id);
      pushVertex(resolved[k].pos, resolved[k].elev, owner.cell.id);
      pushVertex(resolved[k2].pos, resolved[k2].elev, owner.cell.id);
    }
  }
}
