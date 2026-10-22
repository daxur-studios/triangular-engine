import { LEAF_CELLS, latticeCoordinate, latticeDirection, latticeKey, type Vec3 } from './cube-sphere';
import { COLUMN_STRIDE, type ColumnScanInput } from './column-scan-gpu';
import { leafAngle, type Band, type SelectedLeaf } from './leaf-select';

/**
 * Plan 055 contender B, height shell: one grid of `(LEAF_CELLS + 1)^2` vertices per drawn leaf, each at the outermost
 * ground along its radial column (`column-scan-gpu.ts`). Built on the CPU from the scan for now (stage 1 of the spike;
 * the GPU writes it in a later stage).
 *
 * Shared vertices are identical on both sides: every vertex on a leaf edge takes its height from the first leaf, coarse
 * levels first, that wrote its lattice key, and its direction from the key (`latticeDirection`). On an edge whose
 * neighbour is a level coarser, odd vertices fold onto the even vertex before them, so the fine side's edge is the
 * coarse side's edge exactly (the triangles that touch a folded vertex become degenerate and are dropped).
 */

/** Vertices along a leaf edge. */
export const LEAF_VERTICES = LEAF_CELLS + 1;

/** Steps a column takes through the band at most, before its cell size says less. */
const COLUMN_STEPS = 512;

export interface ShellBuildParams {
  readonly radiusM: number;
  /** Heights already fixed for some lattice keys (the near zone's boundary): edge vertices there take them. */
  readonly fixedHeights?: ReadonlyMap<string, number>;
  /** The origin positions are relative to (body frame, metres): the camera when the shell was built. */
  readonly origin: Readonly<Vec3>;
  readonly band: { readonly bottomM: number; readonly topM: number };
}

/**
 * Columns of every drawn leaf, leaf after leaf, row after row (`j` then `i`). `rangeOf` narrows a leaf's columns to the
 * altitudes its ground can lie in (all of its crossings, not only the outermost); the band otherwise.
 */
export function shellColumns(leaves: readonly SelectedLeaf[], params: ShellBuildParams, rangeOf?: (leaf: SelectedLeaf) => Band | undefined): ColumnScanInput {
  const count = leaves.length * LEAF_VERTICES * LEAF_VERTICES;
  const base = new Float32Array(count * 4);
  const direction = new Float32Array(count * 4);
  const columnParams = new Float32Array(count * 4);
  const { radiusM: R, origin, band } = params;
  const d: Vec3 = [0, 0, 0];
  let c = 0;
  for (const leaf of leaves) {
    const { face, level, i, j } = leaf.key;
    const cellM = (R * leafAngle(level)) / LEAF_CELLS;
    const range = rangeOf?.(leaf);
    const top = Math.min(band.topM, range?.topM ?? band.topM);
    const bottom = Math.max(band.bottomM, range?.bottomM ?? band.bottomM);
    const step = Math.max(cellM, (top - bottom) / COLUMN_STEPS);
    for (let b = 0; b < LEAF_VERTICES; b++) {
      for (let a = 0; a < LEAF_VERTICES; a++, c++) {
        latticeDirection(face, latticeCoordinate(level, i, a), latticeCoordinate(level, j, b), d);
        base.set([d[0] * R - origin[0], d[1] * R - origin[1], d[2] * R - origin[2], 0], c * 4);
        direction.set([d[0], d[1], d[2], 0], c * 4);
        columnParams.set([top, bottom, step, cellM * 0.5], c * 4);
      }
    }
  }
  return { base, direction, params: columnParams, count };
}

export interface ShellMesh {
  /** xyz per vertex, relative to the build origin. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Drawn leaves where some column crosses the ground more than once (an overhang the shell flattens). */
  readonly overhangLeaves: number;
  /** Most crossings in any column. */
  readonly mostCrossings: number;
}

/** The shell from the scan of `shellColumns(leaves, params)`. */
export function buildShellMesh(leaves: readonly SelectedLeaf[], scan: Float32Array, params: ShellBuildParams): ShellMesh {
  const n = LEAF_VERTICES;
  const perLeaf = n * n;
  const { radiusM: R, origin } = params;
  const positions = new Float32Array(leaves.length * perLeaf * 3);
  const normals = new Float32Array(leaves.length * perLeaf * 3);
  const indices: number[] = [];
  const shared = new Map<string, number>(params.fixedHeights ?? []);
  const heights = new Float64Array(perLeaf);
  const world = new Float64Array(perLeaf * 3);
  const d: Vec3 = [0, 0, 0];
  let overhangLeaves = 0;
  let mostCrossings = 0;

  leaves.forEach((leaf, l) => {
    const { face, level, i, j } = leaf.key;
    let overhang = false;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const v = b * n + a;
        const column = (l * perLeaf + v) * COLUMN_STRIDE;
        const crossings = scan[column];
        mostCrossings = Math.max(mostCrossings, crossings);
        if (crossings > 1) overhang = true;
        let h = scan[column + 1];
        const qu = latticeCoordinate(level, i, a);
        const qv = latticeCoordinate(level, j, b);
        if (a === 0 || b === 0 || a === n - 1 || b === n - 1) {
          const key = latticeKey(face, qu, qv);
          const first = shared.get(key);
          if (first === undefined) shared.set(key, h);
          else h = first;
        }
        heights[v] = h;
        latticeDirection(face, qu, qv, d);
        const r = R + h;
        world[v * 3] = d[0] * r - origin[0];
        world[v * 3 + 1] = d[1] * r - origin[1];
        world[v * 3 + 2] = d[2] * r - origin[2];
      }
    }
    if (overhang) overhangLeaves++;

    // Fold odd edge vertices onto the even one before them where the neighbour is coarser.
    const fold = new Int32Array(perLeaf);
    for (let v = 0; v < perLeaf; v++) fold[v] = v;
    const coarser = leaf.coarserEdges;
    for (let k = 1; k < n - 1; k += 2) {
      if (coarser & 1) fold[k * n] = (k - 1) * n;
      if (coarser & 2) fold[k * n + n - 1] = (k - 1) * n + n - 1;
      if (coarser & 4) fold[k] = k - 1;
      if (coarser & 8) fold[(n - 1) * n + k] = (n - 1) * n + k - 1;
    }

    const offset = l * perLeaf;
    for (let v = 0; v < perLeaf; v++) {
      const source = fold[v];
      positions[(offset + v) * 3] = world[source * 3];
      positions[(offset + v) * 3 + 1] = world[source * 3 + 1];
      positions[(offset + v) * 3 + 2] = world[source * 3 + 2];
    }
    // Normals from the leaf's own grid (one-sided at its edges).
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const v = b * n + a;
        const e0 = b * n + Math.max(0, a - 1);
        const e1 = b * n + Math.min(n - 1, a + 1);
        const n0 = Math.max(0, b - 1) * n + a;
        const n1 = Math.min(n - 1, b + 1) * n + a;
        const ux = world[e1 * 3] - world[e0 * 3];
        const uy = world[e1 * 3 + 1] - world[e0 * 3 + 1];
        const uz = world[e1 * 3 + 2] - world[e0 * 3 + 2];
        const vx = world[n1 * 3] - world[n0 * 3];
        const vy = world[n1 * 3 + 1] - world[n0 * 3 + 1];
        const vz = world[n1 * 3 + 2] - world[n0 * 3 + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        // Point away from the planet centre.
        const cx = world[v * 3] + origin[0];
        const cy = world[v * 3 + 1] + origin[1];
        const cz = world[v * 3 + 2] + origin[2];
        if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const length = Math.hypot(nx, ny, nz) || 1;
        normals.set([nx / length, ny / length, nz / length], (offset + v) * 3);
      }
    }
    // Two triangles per cell, wound counter-clockwise seen from outside; degenerate ones (folded) dropped.
    const outward = windingOutward(face);
    for (let b = 0; b < n - 1; b++) {
      for (let a = 0; a < n - 1; a++) {
        const v00 = fold[b * n + a];
        const v10 = fold[b * n + a + 1];
        const v01 = fold[(b + 1) * n + a];
        const v11 = fold[(b + 1) * n + a + 1];
        const triangle = (p: number, q: number, r: number) => {
          if (p === q || q === r || p === r) return;
          if (outward) indices.push(offset + p, offset + q, offset + r);
          else indices.push(offset + p, offset + r, offset + q);
        };
        triangle(v00, v10, v11);
        triangle(v00, v11, v01);
      }
    }
  });
  return { positions, normals, indices: Uint32Array.from(indices), overhangLeaves, mostCrossings };
}

/** Whether (u, v, outward normal) is right-handed on `face`, so (a, a + u, a + u + v) winds counter-clockwise outside. */
export function windingOutward(face: number): boolean {
  // u x v points along the major axis for these axis triples ((1,2), (2,0), (0,1) after axis 0, 1, 2), so the winding is
  // counter-clockwise from outside on the positive faces and clockwise on the negative ones.
  return (face & 1) === 0;
}
