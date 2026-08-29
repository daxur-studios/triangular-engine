import { IPlanetGraphCore } from './planet-graph';
import { findCellAt, sampleElevationNear } from './sample-elevation';
import { cross, dot, IVec3, normalize, sub, vec3 } from './vec3';

export interface IColliderPatchParams {
  /** Angular half-width (radians) of the square patch around `center` — small enough that the
   * gnomonic (tangent-plane) projection below stays well-conditioned; a few degrees for a local
   * vessel-proximity patch, not a whole hemisphere. */
  angularHalfWidth: number;
  /** Vertices per side. Patch is `sampleCount x sampleCount`, `(sampleCount - 1)^2 * 2`
   * triangles. Free to pick independently of `cellCount`/chunk LOD — that independence is the
   * point (runbook 022 Layer 2/3). */
  sampleCount?: number;
}

export interface IColliderPatch {
  /** Unit-sphere direction this patch is centered on (`center` normalized, not re-derived from
   * the graph — a collider patch is built around an arbitrary query point, e.g. a vessel's
   * ground track, not a cell site). */
  center: IVec3;
  /** Orthonormal tangent-plane basis at `center`: `tangentU x tangentV == center`. The local
   * axes a consuming mesh/heightfield builder needs to place this patch in its own frame — same
   * role `IPlanetPatchHeightField.rotation` plays for BSP's existing CDLOD colliders, just not
   * packaged as a quaternion (that's a Jolt-adapter concern, not this sublibrary's — see runbook
   * 024). */
  tangentU: IVec3;
  tangentV: IVec3;
  sampleCount: number;
  /** Unit-sphere direction per vertex, row-major (row along `tangentV`, column along
   * `tangentU`), xyz interleaved, length = `sampleCount * sampleCount * 3`. */
  directions: Float32Array;
  /** Raw per-vertex elevation (unitless, same scale as the graph's own `elevation[]`), row-major,
   * parallel to `directions` one entry per vertex. A consuming boundary function scales this into
   * meters when building an actual collider — see runbook 022 M4d / runbook 024. */
  elevations: Float32Array;
}

const DEFAULTS = {
  sampleCount: 17,
};

/**
 * M4d: a small, high-resolution square patch of `sampleElevation()` samples around an arbitrary
 * direction — a vessel's ground-track point, not a cell or a chunk — independent of visual
 * chunk/LOD resolution and of chunk boundaries, per runbook 022 Layer 2/3's camera/physics
 * decoupling. Vertices sit on a regular tangent-plane grid (gnomonic projection: offset on the
 * tangent plane at `center`, then renormalized onto the sphere) rather than being tessellated
 * from the cell graph's own polygons, so resolution is a free parameter independent of
 * `cellCount` — exactly what a collider needs (dense enough for the vessel's own footprint, no
 * denser, rebuildable on demand as the vessel moves).
 *
 * Cell lookups use `sampleElevationNear()`'s coherent walk, seeded row-by-row from the previous
 * vertex's resolved cell (only the very first vertex pays `findCellAt()`'s full scan) — see that
 * function's doc comment for why a dense local grid needs this instead of a brute-force lookup
 * per vertex.
 */
export function buildColliderPatch(
  graph: IPlanetGraphCore,
  elevation: number[],
  center: IVec3,
  params: IColliderPatchParams,
): IColliderPatch {
  const p = { ...DEFAULTS, ...params };
  if (!Number.isInteger(p.sampleCount) || p.sampleCount < 2) {
    throw new RangeError('Collider patch sampleCount must be an integer >= 2.');
  }
  if (!(p.angularHalfWidth > 0) || p.angularHalfWidth >= Math.PI / 2) {
    throw new RangeError('Collider patch angularHalfWidth must be in (0, PI/2).');
  }

  const normal = normalize(center);
  const arbitrary = Math.abs(normal.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const tangentU = normalize(cross(arbitrary, normal));
  const tangentV = cross(normal, tangentU);

  const tanHalf = Math.tan(p.angularHalfWidth);
  const n = p.sampleCount;
  const directions = new Float32Array(n * n * 3);
  const elevations = new Float32Array(n * n);

  let hintCellId = findCellAt(graph, normal).id;
  for (let row = 0; row < n; row++) {
    const sv = ((row / (n - 1)) * 2 - 1) * tanHalf;
    for (let col = 0; col < n; col++) {
      const su = ((col / (n - 1)) * 2 - 1) * tanHalf;
      const px = normal.x + tangentU.x * su + tangentV.x * sv;
      const py = normal.y + tangentU.y * su + tangentV.y * sv;
      const pz = normal.z + tangentU.z * su + tangentV.z * sv;
      const len = Math.hypot(px, py, pz) || 1;
      const dir: IVec3 = { x: px / len, y: py / len, z: pz / len };

      const { value, cellId } = sampleElevationNear(graph, elevation, dir, hintCellId);
      hintCellId = cellId;

      const idx = row * n + col;
      directions[idx * 3] = dir.x;
      directions[idx * 3 + 1] = dir.y;
      directions[idx * 3 + 2] = dir.z;
      elevations[idx] = value;
    }
  }

  return { center: normal, tangentU, tangentV, sampleCount: n, directions, elevations };
}

/**
 * Triangle indices (index triples, flattened) for an `IColliderPatch`'s regular
 * `sampleCount x sampleCount` grid — two triangles per quad. Winding is checked against the
 * patch's own `center` (outward-facing) using the first quad's actual 3D positions and flipped
 * for the whole buffer if backwards, the same one-check-covers-everything trick
 * `chunking.ts`'s `buildChunkLod1MeshData()` uses for its own triangulation, valid here for the
 * same reason: a regular grid has one consistent orientation throughout, so one quad's winding
 * tells you every other quad's.
 *
 * No border stitching against anything else — a collider patch never shares an edge with a
 * chunk's visual mesh or another collider patch by construction (it's rebuilt whole as the
 * vessel moves, not tiled), so unlike `chunking.ts`'s boundary loops there's no shared-vertex
 * requirement to preserve here.
 */
export function colliderPatchIndices(patch: IColliderPatch): Uint32Array {
  const n = patch.sampleCount;
  const quadsPerSide = n - 1;
  const indices = new Uint32Array(quadsPerSide * quadsPerSide * 6);

  const posAt = (idx: number): IVec3 => ({
    x: patch.directions[idx * 3],
    y: patch.directions[idx * 3 + 1],
    z: patch.directions[idx * 3 + 2],
  });

  let flip = false;
  if (quadsPerSide > 0) {
    // Check whether the [a, b, c] / [b, d, c] winding option (the `flip` branch below) is the
    // outward-facing one for this grid orientation; use the [a, c, b] / [b, c, d] option
    // otherwise. Both options wind consistently across every quad in a regular grid, so this one
    // check settles the whole buffer's winding.
    const a = posAt(0);
    const b = posAt(1);
    const c = posAt(n);
    const faceNormal = cross(sub(b, a), sub(c, a));
    flip = dot(faceNormal, patch.center) > 0;
  }

  let o = 0;
  for (let row = 0; row < quadsPerSide; row++) {
    for (let col = 0; col < quadsPerSide; col++) {
      const a = row * n + col;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      const first: [number, number, number] = flip ? [a, b, c] : [a, c, b];
      const second: [number, number, number] = flip ? [b, d, c] : [b, c, d];
      indices[o++] = first[0];
      indices[o++] = first[1];
      indices[o++] = first[2];
      indices[o++] = second[0];
      indices[o++] = second[1];
      indices[o++] = second[2];
    }
  }
  return indices;
}
