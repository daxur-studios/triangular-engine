import { NavFlag } from './nav-flags';
import type { NavRect } from './nav-types';

/** Squared-distance stand-in for "no blocked cell in this column". Far beyond any clearance cap. */
const FAR_SQ = 1e9;

/**
 * Computes the clearance field inside `window`: for each cell, the exact Euclidean distance (in
 * cells, between cell centres) to the nearest blocked cell, floored and saturated at `cap`.
 * Blocked cells get 0. Cells outside the grid count as free.
 *
 * Only `out` cells inside `window` are written. The transform reads blocked cells up to `cap`
 * cells outside the window (clipped to the grid), so recomputing a window equals recomputing the
 * whole grid there. Uses a column sweep followed by the Felzenszwalb row pass: O(cells).
 *
 * @param flags Flag layer; a cell is blocked when `NavFlag.BLOCKED` is set.
 * @param width Grid width in cells.
 * @param height Grid height in cells.
 * @param window Cells to write (clipped to the grid).
 * @param cap Saturation value, 1 to 255.
 * @param out Clearance layer to write, `width * height` entries.
 */
export function computeClearanceWindow(
  flags: Uint8Array,
  width: number,
  height: number,
  window: NavRect,
  cap: number,
  out: Uint8Array,
): void {
  const wx0 = Math.max(0, window.x);
  const wy0 = Math.max(0, window.y);
  const wx1 = Math.min(width, window.x + window.width);
  const wy1 = Math.min(height, window.y + window.height);
  if (wx1 <= wx0 || wy1 <= wy0) return;

  // Source region: every blocked cell that can matter to a window cell.
  const sx0 = Math.max(0, wx0 - cap);
  const sy0 = Math.max(0, wy0 - cap);
  const sx1 = Math.min(width, wx1 + cap);
  const sy1 = Math.min(height, wy1 + cap);
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;

  // Pass 1: squared vertical distance to the nearest blocked cell in the same column.
  const g = new Float32Array(sw * sh);
  const run = new Int32Array(sw);
  run.fill(30000);
  for (let y = 0; y < sh; y++) {
    const fi = (sy0 + y) * width + sx0;
    const gi = y * sw;
    for (let x = 0; x < sw; x++) {
      const r = flags[fi + x] & NavFlag.BLOCKED ? 0 : Math.min(run[x] + 1, 30000);
      run[x] = r;
      g[gi + x] = r * r;
    }
  }
  run.fill(30000);
  for (let y = sh - 1; y >= 0; y--) {
    const fi = (sy0 + y) * width + sx0;
    const gi = y * sw;
    for (let x = 0; x < sw; x++) {
      const r = flags[fi + x] & NavFlag.BLOCKED ? 0 : Math.min(run[x] + 1, 30000);
      run[x] = r;
      const sq = r * r;
      if (sq < g[gi + x]) g[gi + x] = sq;
    }
  }

  // Pass 2: lower envelope of parabolas along each row.
  const v = new Int32Array(sw);
  const z = new Float64Array(sw + 1);
  const rowStart = wy0 - sy0;
  const rowEnd = wy1 - sy0;
  for (let y = rowStart; y < rowEnd; y++) {
    const gi = y * sw;
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < sw; q++) {
      const fq = g[gi + q] + q * q;
      let s: number;
      for (;;) {
        const p = v[k];
        s = (fq - (g[gi + p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k]) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    const oi = (sy0 + y) * width + sx0;
    for (let q = 0; q < sw; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      const dsq = (q - p) * (q - p) + g[gi + p];
      const gx = sx0 + q;
      if (gx >= wx0 && gx < wx1) {
        out[oi + q] = dsq >= FAR_SQ ? cap : Math.min(cap, Math.floor(Math.sqrt(dsq)));
      }
    }
  }
}
