import { IPlanetGraphCell, IPlanetGraphCore } from './planet-graph';
import { cellCornerElevation } from './sample-elevation';
import { cross, dot, IVec3, normalize, projectOnTangentPlane, sub, vec3 } from './vec3';

export interface IPlanetChunk {
  id: number;
  /** Cell ids belonging to this chunk. Always a single connected region (built by BFS over
   * `cell.neighbors`), never a scattered set. */
  cellIds: number[];
  /** Unit-sphere direction of the chunk's centroid (mean of member cell centers, renormalized). */
  center: IVec3;
  /** Angular radius in radians from `center` to the farthest member cell corner — a bounding
   * cone/sphere for frustum and horizon culling of the whole chunk at once (see runbook 022's
   * M4b note: testing ~N chunk bounds per frame is affordable where testing every cell isn't). */
  boundingRadius: number;
}

export interface IPlanetChunks {
  chunks: IPlanetChunk[];
  /** Parallel to `graph.cells` — which chunk id owns each cell. */
  chunkIdByCell: number[];
}

export interface IChunkParams {
  /** Soft target cell count per chunk. Chunks stop growing once they reach this size, so
   * actual sizes vary (a chunk can end smaller when it's hemmed in by already-claimed
   * neighbors) — this is a batching knob for draw-call count, not an exact partition size. */
  targetChunkSize?: number;
}

const DEFAULTS = {
  targetChunkSize: 100,
};

/**
 * M4b: groups the cell graph into contiguous, roughly-`targetChunkSize`-cell chunks so
 * rendering can batch one `BufferGeometry`/draw call per chunk instead of per cell or (the
 * naive M3/M4a mesh) one draw call for the entire planet. Cell id order carries no spatial
 * locality (Fibonacci-spiral + golden-angle placement means consecutive ids are scattered
 * around a latitude band, not spatially adjacent — see runbook 022), so chunks are grown by
 * BFS flood-fill over `cell.neighbors` instead of id-range slicing: this both fixes that and
 * guarantees every chunk is a single connected region, which is what a later chunk-level
 * bounding-volume cull (frustum/horizon) needs to stay correct.
 *
 * Deterministic for a given graph: iterates cell ids in a fixed order, so the same graph
 * always produces the same chunks.
 */
export function buildPlanetChunks(graph: IPlanetGraphCore, params: IChunkParams = {}): IPlanetChunks {
  const p = { ...DEFAULTS, ...params };
  const allCellIds = Array.from({ length: graph.cells.length }, (_, i) => i);
  const { groups, groupIdByCell } = growConnectedGroups(graph, allCellIds, p.targetChunkSize);
  return {
    chunks: groups.map((cellIds, id) => buildChunkBounds(graph, id, cellIds)),
    chunkIdByCell: groupIdByCell,
  };
}

/**
 * BFS flood-fill of `cellIds` into contiguous groups of at most `targetSize` cells each,
 * never crossing outside that set. Shared by the top-level chunk partition
 * (`buildPlanetChunks()`, scoped to every cell) and LOD1's within-chunk merge partition
 * (`buildChunkLod1MeshData()`, scoped to one chunk's cells) — same guarantee both times:
 * every group is a single connected region, and the partition is deterministic for a given
 * graph and input order.
 *
 * `groupIdByCell` is sized to the whole graph and left at `-1` for anything outside
 * `cellIds`, which is exactly what `buildChunkBoundaryLoop()` wants: `-1` never equals a real
 * group id, so an edge leading out of the scope always counts as a group boundary.
 *
 * `pinned`, when given, forces every marked cell to be its own singleton group: it's never
 * absorbed as someone else's neighbor, and if it's a seed itself its frontier never expands.
 * See `computeCellPins()` in `salience.ts` for why (peaks/coastline capes/small islands that
 * shouldn't flatten, vanish, or shift as LOD1 merges around them) — this function only
 * enforces the mechanic, undefined `pinned` pins nothing and reproduces prior behavior exactly.
 */
function growConnectedGroups(
  graph: IPlanetGraphCore,
  cellIds: number[],
  targetSize: number,
  maxAngleFromSeed = Infinity,
  pinned?: Uint8Array,
): { groups: number[][]; groupIdByCell: number[] } {
  const groupIdByCell = new Array<number>(graph.cells.length).fill(-1);
  const inScope = new Uint8Array(graph.cells.length);
  for (const id of cellIds) inScope[id] = 1;
  const groups: number[][] = [];
  const cosLimit = maxAngleFromSeed >= Math.PI ? -1 : Math.cos(maxAngleFromSeed);

  for (const seedId of cellIds) {
    if (groupIdByCell[seedId] !== -1) continue;

    const groupId = groups.length;
    const members: number[] = [seedId];
    groupIdByCell[seedId] = groupId;
    const seedCenter = graph.cells[seedId].center;

    // Every *corner*, not just the center, has to fit inside the cap — the cap is a bound on
    // the merged polygon's geometry, and the polygon is made of corners. The seed cell itself
    // is exempt (a group is at minimum one cell no matter what), so the bound holds for every
    // group of 2+ cells and degrades to a single cell's own extent below that.
    const fitsInCap = (cellId: number): boolean => {
      if (cosLimit <= -1) return true;
      for (const corner of graph.cells[cellId].corners) {
        if (corner.x * seedCenter.x + corner.y * seedCenter.y + corner.z * seedCenter.z < cosLimit) return false;
      }
      return true;
    };

    let frontier = pinned?.[seedId] === 1 ? [] : [seedId];
    while (members.length < targetSize && frontier.length > 0) {
      const next: number[] = [];
      outer: for (const cellId of frontier) {
        for (const neighborId of graph.cells[cellId].neighbors) {
          if (inScope[neighborId] === 0 || groupIdByCell[neighborId] !== -1) continue;
          if (pinned?.[neighborId] === 1) continue;
          if (!fitsInCap(neighborId)) continue;
          groupIdByCell[neighborId] = groupId;
          members.push(neighborId);
          next.push(neighborId);
          if (members.length >= targetSize) break outer;
        }
      }
      frontier = next;
    }

    groups.push(members);
  }

  return { groups, groupIdByCell };
}

function buildChunkBounds(graph: IPlanetGraphCore, id: number, cellIds: number[]): IPlanetChunk {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const cellId of cellIds) {
    const c = graph.cells[cellId].center;
    sx += c.x;
    sy += c.y;
    sz += c.z;
  }
  const len = Math.hypot(sx, sy, sz) || 1;
  const center: IVec3 = { x: sx / len, y: sy / len, z: sz / len };

  let boundingRadius = 0;
  for (const cellId of cellIds) {
    for (const corner of graph.cells[cellId].corners) {
      const dot = Math.min(1, Math.max(-1, center.x * corner.x + center.y * corner.y + center.z * corner.z));
      const angle = Math.acos(dot);
      if (angle > boundingRadius) boundingRadius = angle;
    }
  }

  return { id, cellIds, center, boundingRadius };
}

export interface IChunkMeshData {
  /** Unit-sphere direction per vertex, undisplaced (xyz interleaved, length = vertexCount*3).
   * Multiply by `1 + elevation * scale` per vertex to displace, same convention the M3/M4a
   * preview mesh already uses. */
  directions: Float32Array;
  /** Raw per-vertex elevation, parallel to `directions` (one entry per vertex). */
  elevations: Float32Array;
  /** Owning cell id per vertex, parallel to `elevations`. */
  cellIds: Int32Array;
}

/**
 * Builds one triangle fan per member cell (center -> corner k -> corner k+1), exactly the
 * M3/M4a preview mesh's tessellation, but scoped to a single chunk's cells and returned as
 * plain typed arrays rather than a Three.js `BufferGeometry` — this module stays framework-
 * free; the caller wraps the result into whatever GPU buffer type it uses.
 */
export function buildChunkMeshData(graph: IPlanetGraphCore, elevation: number[], chunk: IPlanetChunk): IChunkMeshData {
  const directions: number[] = [];
  const elevations: number[] = [];
  const cellIds: number[] = [];

  const pushVertex = (p: IVec3, e: number, cellId: number): void => {
    directions.push(p.x, p.y, p.z);
    elevations.push(e);
    cellIds.push(cellId);
  };

  for (const cellId of chunk.cellIds) {
    const cell: IPlanetGraphCell = graph.cells[cellId];
    const n = cell.corners.length;
    if (n < 3) continue;
    const centerElevation = elevation[cell.id];
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      pushVertex(cell.center, centerElevation, cell.id);
      pushVertex(cell.corners[k], cellCornerElevation(cell, k, elevation), cell.id);
      pushVertex(cell.corners[k2], cellCornerElevation(cell, k2, elevation), cell.id);
    }
  }

  return {
    directions: new Float32Array(directions),
    elevations: new Float32Array(elevations),
    cellIds: new Int32Array(cellIds),
  };
}

export interface IChunkBoundaryLoop {
  /** Ordered, closed loop of unit-sphere corner positions tracing the chunk's outer edge —
   * the exact same `IVec3` objects the full-resolution mesh (`buildChunkMeshData()`) uses for
   * its own cells' corners (corner objects are shared by reference between every cell that
   * touches that Voronoi vertex, see `dual-cells.ts`), so any coarser mesh built from this
   * loop shares literal vertex positions with whatever LOD a neighboring chunk renders along
   * that shared border — no seam to stitch, by construction. */
  positions: IVec3[];
  /** Parallel to `positions` — each vertex's `cellCornerElevation()`. Mathematically the same
   * `(a+b+c)/3` regardless of which of the 3 surrounding cells computes it, so it agrees with
   * the full-resolution neighbor's elevation at that same vertex to within floating-point
   * summation-order rounding (~1e-16 for typical elevation magnitudes) — the 3 cells sum `a`,
   * `b`, `c` in different orders depending on which one is host, and float addition isn't
   * perfectly associative. Far below float32 precision (~1e-7), so this rounds away once the
   * value lands in a GPU buffer; not a source of visible cracking. */
  elevations: number[];
}

/**
 * Walks a chunk's outer boundary: an edge `corners[k] -> corners[(k+1)%n]` of a member cell is
 * a boundary edge iff the cell across it (`neighbors[(k+1)%n]`, see `IPlanetGraphCell`'s doc
 * comment for that indexing) belongs to a different chunk. Boundary edges chain head-to-tail
 * into a loop the same way `buildDualCells()` walks a cell's own corners — by object identity,
 * since corner positions are shared references, not recomputed per cell, so chaining needs no
 * positional tolerance.
 *
 * Returns `null` when the chunk has no boundary at all (it owns every cell in the graph, so
 * there's no neighboring chunk to seam against), when the loop degenerates to fewer than 3
 * vertices, or when the traced loop fails to consume every boundary edge — callers fall back
 * to full-resolution geometry in all three cases.
 *
 * That last guard is what makes "one simple polygon" a checked precondition rather than an
 * assumption. A single closed loop visits every boundary edge exactly once, so
 * `positions.length === nextByStart.size` holds iff the boundary really is one simple loop.
 * It isn't for a region shaped like a ring (two disjoint loops — outer and inner) or pinched
 * at a vertex (one vertex with two outgoing boundary edges, which the `Map` silently collapses
 * to one, short-circuiting the walk). Both are rare for a BFS-grown region but not impossible,
 * and silently emitting a truncated loop would punch a hole in the mesh; bailing to full
 * resolution for that one region costs a few triangles and can't be wrong.
 */
export function buildChunkBoundaryLoop(
  graph: IPlanetGraphCore,
  elevation: number[],
  chunkIdByCell: number[],
  chunk: IPlanetChunk,
): IChunkBoundaryLoop | null {
  const chunkId = chunk.id;
  const nextByStart = new Map<IVec3, IVec3>();
  const elevationByVertex = new Map<IVec3, number>();

  for (const cellId of chunk.cellIds) {
    const cell = graph.cells[cellId];
    const n = cell.corners.length;
    if (n < 3) continue;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (chunkIdByCell[cell.neighbors[k2]] === chunkId) continue;
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

  const elevations = positions.map((p) => elevationByVertex.get(p) ?? 0);
  return { positions, elevations };
}

/**
 * Ear-clipping triangulation of a simple 2D polygon (may be concave, must not self-intersect)
 * — returns triangles as index triples into `points`. O(n²), fine for chunk boundary loops
 * (tens of vertices, built once per chunk at LOD-bake time, not per frame). Normalizes to CCW
 * before clipping (an ear is a convex vertex whose triangle contains no other polygon vertex),
 * so the *sign* of the output winding relative to the input is not guaranteed — callers that
 * care about winding direction (e.g. for outward-facing normals) must check and correct it
 * themselves, same as `buildChunkLod1MeshData()` does.
 *
 * A single-point fan (the naive alternative) only tessellates a polygon correctly when the
 * polygon is star-shaped around that point — every point on the boundary visible from it in a
 * straight line without crossing an edge. BFS-grown chunk regions are frequently non-convex
 * "amoeba" shapes (the flood-fill has no compactness heuristic), so a fan from even a
 * well-centered point routinely isn't star-shaped, producing overlapping/inverted triangles —
 * this is what a per-chunk radiating-line artifact in the rendered LOD1 mesh looks like. Ear
 * clipping has no such restriction: it works for any simple polygon.
 */
export function triangulatePolygon2D(points: { x: number; y: number }[]): [number, number, number][] {
  const n = points.length;
  if (n < 3) return [];

  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  const order = Array.from({ length: n }, (_, i) => i);
  if (signedArea < 0) order.reverse();

  const cross2 = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const pointInTriangle = (
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
    c: { x: number; y: number },
  ): boolean => {
    const d1 = cross2(a, b, p);
    const d2 = cross2(b, c, p);
    const d3 = cross2(c, a, p);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const triangles: [number, number, number][] = [];
  const remaining = order.slice();
  let guard = 0;
  while (remaining.length > 3 && guard < n * n) {
    guard++;
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const prevIdx = remaining[(i - 1 + remaining.length) % remaining.length];
      const curIdx = remaining[i];
      const nextIdx = remaining[(i + 1) % remaining.length];
      if (cross2(points[prevIdx], points[curIdx], points[nextIdx]) <= 0) continue; // reflex vertex, not an ear

      const isEar = remaining.every((otherIdx) => {
        if (otherIdx === prevIdx || otherIdx === curIdx || otherIdx === nextIdx) return true;
        return !pointInTriangle(points[otherIdx], points[prevIdx], points[curIdx], points[nextIdx]);
      });
      if (!isEar) continue;

      triangles.push([prevIdx, curIdx, nextIdx]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    // Degenerate/self-intersecting input (shouldn't happen for a real chunk boundary loop) —
    // stop rather than spin; whatever's left just doesn't get triangulated.
    if (!clipped) break;
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);

  return triangles;
}

export interface IChunkLod1Params {
  /** Hard cap on cells per merge group. Rarely the binding constraint — `maxSag` normally
   * stops growth first — it's a safety valve for very high cell counts, where a sag-bounded
   * cap can otherwise swallow hundreds of tiny cells into one polygon and make LOD1 geometry
   * expensive to build. */
  maxGroupSize?: number;
  /** Geometric error budget: how far (as a fraction of planet radius) a merged group's flat
   * polygon is allowed to sag below the sphere it approximates. Groups grow until adding
   * another cell would exceed it. See `buildChunkLod1MeshData()` for why this, not a cell
   * count, is the knob that matters. */
  maxSag?: number;
  /** Cell ids that must always render as their own single-cell polygon, never absorbed into a
   * merge group regardless of `maxSag`/`maxGroupSize` — see `computeCellPins()` in
   * `salience.ts`. Indexed by cell id, length = `graph.cells.length`, 1 = pinned. Omitted or
   * undefined pins nothing, identical to pre-pinning behavior. */
  pinned?: Uint8Array;
}

const LOD1_DEFAULTS = {
  maxGroupSize: 64,
  /** ~10% of the total terrain relief at the debug lab's default elevation scale — small
   * enough that merged land can't sink beneath a sea-level shell, which is the failure this
   * budget exists to prevent. Corresponds to a cap radius of ~3.6°. */
  maxSag: 0.002,
};

/**
 * M4c LOD1: merges each chunk's cells into contiguous groups of ~`groupSize`
 * (`growConnectedGroups()`, the same BFS `buildPlanetChunks()` uses, scoped to this chunk) and
 * renders each group as a single flat polygon over its own merged outer boundary loop
 * (`buildChunkBoundaryLoop()`), triangulated by `triangulatePolygon2D()` on a local
 * tangent-plane projection at the group's centroid. The projection only decides *which*
 * triples of loop vertices form triangles; output positions/elevations are the real 3D loop
 * data, never the projection. Groups that fail to produce a usable loop fall back to
 * full-resolution fans for just those cells.
 *
 * ## Why groups, and why they're bounded by sag rather than by cell count
 *
 * The obvious version of this — collapse the entire chunk to one polygon over its own outer
 * boundary — is wrong for a reason that has nothing to do with topology, and it's worth
 * spelling out because it renders as garbage rather than as an obviously-too-coarse mesh.
 * A flat polygon spanning a spherical cap of angular radius `r` sags below the sphere by
 * `1 - cos(r)` at its center. At the chunking sizes this module actually produces (a few tens
 * of chunks over a planet, so `r` around 20-35°), that sag is 0.06-0.18 of the planet radius —
 * one to two orders of magnitude larger than the entire terrain relief being rendered. The
 * chunk stops being a coarse planet surface and becomes a chord plate buried inside the
 * planet, so land sinks beneath anything drawn at a fixed sea-level radius and the ocean is
 * left rendering in front of the continents. Curvature, not detail, is what has to survive a
 * planet LOD.
 *
 * A cell-count cap doesn't bound that, because BFS groups aren't discs: later groups fill the
 * stringy gaps left between earlier ones, and an 8-cell string can span twice the angle of an
 * 8-cell blob. So groups grow under an explicit angular cap derived from `maxSag`
 * (`r = acos(1 - maxSag)`, applied to candidate cells' corners), which bounds the error
 * directly. The payoff scales with resolution, which is the correct behavior: at a few hundred
 * cells a single cell already spans most of the budget, so groups stay tiny and LOD1 saves
 * only the per-cell fan centers (`n-2` triangles per cell instead of `n`); at a few thousand
 * cells the same budget swallows many cells per group and the saving grows with it.
 *
 * ## Why the borders still can't crack
 *
 * Unchanged from the whole-chunk version, and it holds at both scales at once. Every vertex a
 * group's loop emits is a shared corner object (`===`-identical, no recomputation) whose
 * elevation is `cellCornerElevation()` — the same value any other cell touching that corner
 * computes, to within float summation-order rounding (~1e-16, see
 * `IChunkBoundaryLoop.elevations`). A group's loop also contains *every* corner along each of
 * its boundary edges, not a subsampling of them, so the polygon edge chain matches the
 * neighbor's cell-edge chain vertex for vertex. That makes the seams exact in all three
 * directions: group-to-group inside a chunk, LOD1 chunk to LOD0 chunk across a chunk border,
 * and LOD1 chunk to LOD1 chunk. No skirts, no stitching pass.
 *
 * Every vertex is tagged with its own group's first member cell id rather than a true owning
 * cell — color resolution coarsens along with geometry, which is the point: a distant chunk
 * doesn't need cell-accurate biome color any more than it needs cell-accurate geometry.
 *
 * ## Pinning
 *
 * `params.pinned`, when given, forces the marked cells into their own singleton groups (see
 * `growConnectedGroups()`), so they still go through this same boundary-loop + ear-clipping
 * path but end up tessellating just their own polygon — a mountain peak, coastline cape, or
 * small island pinned by `computeCellPins()` renders identically at both LODs, so it can't
 * flatten, shift, or disappear as the camera crosses the LOD distance threshold.
 */
export function buildChunkLod1MeshData(
  graph: IPlanetGraphCore,
  elevation: number[],
  chunkIdByCell: number[],
  chunk: IPlanetChunk,
  params: IChunkLod1Params = {},
): IChunkMeshData {
  const p = { ...LOD1_DEFAULTS, ...params };
  const maxAngle = p.maxSag >= 2 ? Math.PI : Math.acos(Math.max(-1, 1 - p.maxSag));
  const { groups, groupIdByCell } = growConnectedGroups(
    graph,
    chunk.cellIds,
    Math.max(1, p.maxGroupSize),
    maxAngle,
    p.pinned,
  );

  const directions: number[] = [];
  const elevations: number[] = [];
  const cellIds: number[] = [];

  const pushVertex = (p: IVec3, e: number, cellId: number): void => {
    directions.push(p.x, p.y, p.z);
    elevations.push(e);
    cellIds.push(cellId);
  };

  for (let groupId = 0; groupId < groups.length; groupId++) {
    const members = groups[groupId];
    const groupRegion = buildChunkBounds(graph, groupId, members);
    const loop = buildChunkBoundaryLoop(graph, elevation, groupIdByCell, groupRegion);

    if (!loop) {
      const fallback = buildChunkMeshData(graph, elevation, groupRegion);
      for (let i = 0; i < fallback.elevations.length; i++) {
        const o = i * 3;
        directions.push(fallback.directions[o], fallback.directions[o + 1], fallback.directions[o + 2]);
        elevations.push(fallback.elevations[i]);
        cellIds.push(fallback.cellIds[i]);
      }
      continue;
    }

    const planeNormal = normalize(groupRegion.center);
    const arbitrary = Math.abs(planeNormal.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    const tangentU = normalize(cross(arbitrary, planeNormal));
    const tangentV = cross(planeNormal, tangentU);
    const points2D = loop.positions.map((p) => {
      const t = projectOnTangentPlane(p, planeNormal);
      return { x: dot(t, tangentU), y: dot(t, tangentV) };
    });
    const triangles = triangulatePolygon2D(points2D);

    // `triangulatePolygon2D()` doesn't guarantee which winding direction it returns relative to
    // the input — normalize the whole batch to outward-facing (matching the winding convention
    // every other tessellation in this module uses) by checking just the first triangle's real
    // 3D face normal against the group's own outward direction, then flipping all of them
    // together if it came out backwards (ear clipping preserves one consistent orientation
    // across all output triangles, so one check covers the whole set).
    if (triangles.length > 0) {
      const [a0, b0, c0] = triangles[0];
      const faceNormal = cross(sub(loop.positions[b0], loop.positions[a0]), sub(loop.positions[c0], loop.positions[a0]));
      if (dot(faceNormal, planeNormal) < 0) {
        for (const tri of triangles) {
          const tmp = tri[1];
          tri[1] = tri[2];
          tri[2] = tmp;
        }
      }
    }

    const representativeCellId = members[0];
    for (const [a, b, c] of triangles) {
      for (const idx of [a, b, c]) {
        pushVertex(loop.positions[idx], loop.elevations[idx], representativeCellId);
      }
    }
  }

  return {
    directions: new Float32Array(directions),
    elevations: new Float32Array(elevations),
    cellIds: new Int32Array(cellIds),
  };
}
