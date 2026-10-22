import { BLOCK_CELLS, BLOCK_CORNERS } from './block-grid';

/**
 * Naive surface nets on a corner-sampled density grid. Inside is `density < 0`. One vertex per cell that the surface
 * crosses (the mean of its edge crossings), one quad per grid edge that changes sign, wound so the normal points toward
 * positive density. Quads are only made for edges with all four cells inside the grid, so a surface that leaves the
 * block is open at the boundary: a collider needs one block of padding or its neighbours' skirts.
 */
export interface SurfaceNetsMesh {
  /** xyz per vertex, in the grid's own units (voxels) times `voxelM`, relative to the block origin. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

const EMPTY: SurfaceNetsMesh = { positions: new Float32Array(0), indices: new Uint32Array(0) };

/** The 12 cube edges as corner-index pairs; corner bit 0 is x, bit 1 is y, bit 2 is z. */
const CUBE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

export function meshDensityBlock(grid: Float32Array, voxelM = 1, cells = BLOCK_CELLS): SurfaceNetsMesh {
  const n = cells + 1;
  if (grid.length < n * n * n) throw new RangeError(`density grid has ${grid.length} samples, ${n * n * n} needed`);
  const cellId = new Int32Array(cells * cells * cells).fill(-1);
  const positions: number[] = [];
  const corner = new Float32Array(8);
  const cornerOffset = [0, 1, n, n + 1, n * n, n * n + 1, n * n + n, n * n + n + 1];

  let vertexCount = 0;
  for (let cz = 0; cz < cells; cz++) {
    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const base = cx + n * (cy + n * cz);
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const d = grid[base + cornerOffset[c]];
          corner[c] = d;
          if (d < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (const [a, b] of CUBE_EDGES) {
          const da = corner[a];
          const db = corner[b];
          if ((da < 0) === (db < 0)) continue;
          const t = da / (da - db);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          crossings++;
        }
        cellId[cx + cells * (cy + cells * cz)] = vertexCount++;
        positions.push((cx + sx / crossings) * voxelM, (cy + sy / crossings) * voxelM, (cz + sz / crossings) * voxelM);
      }
    }
  }
  if (vertexCount === 0) return EMPTY;

  const indices: number[] = [];
  const stride = [1, cells, cells * cells];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    // Split on the shorter diagonal, which keeps thin features from folding.
    const len = (p: number, q: number): number =>
      (positions[3 * p] - positions[3 * q]) ** 2 + (positions[3 * p + 1] - positions[3 * q + 1]) ** 2 + (positions[3 * p + 2] - positions[3 * q + 2]) ** 2;
    const [v0, v1, v2, v3] = flip ? [a, d, c, b] : [a, b, c, d];
    if (len(v0, v2) <= len(v1, v3)) indices.push(v0, v1, v2, v0, v2, v3);
    else indices.push(v0, v1, v3, v1, v2, v3);
  };

  const p = [0, 0, 0];
  for (p[2] = 0; p[2] < n; p[2]++) {
    for (p[1] = 0; p[1] < n; p[1]++) {
      for (p[0] = 0; p[0] < n; p[0]++) {
        const here = grid[p[0] + n * (p[1] + n * p[2])];
        for (let axis = 0; axis < 3; axis++) {
          if (p[axis] >= cells) continue;
          const b = (axis + 1) % 3;
          const c = (axis + 2) % 3;
          if (p[b] < 1 || p[b] > cells - 1 || p[c] < 1 || p[c] > cells - 1) continue;
          const there = grid[p[0] + n * (p[1] + n * p[2]) + (axis === 0 ? 1 : axis === 1 ? n : n * n)];
          const inside = here < 0;
          if (inside === there < 0) continue;
          // The cell on the +axis side of the lower corner is `p`'s own; its neighbours step back along b and c.
          const base = p[0] * stride[0] + p[1] * stride[1] + p[2] * stride[2];
          const v00 = cellId[base - stride[b] - stride[c]];
          const v10 = cellId[base - stride[c]];
          const v11 = cellId[base];
          const v01 = cellId[base - stride[b]];
          if (v00 < 0 || v10 < 0 || v11 < 0 || v01 < 0) continue;
          quad(v00, v10, v11, v01, !inside);
        }
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}
