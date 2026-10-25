import type { LodSelector } from './lod-selector';

/** Floats per instance attribute (four vec4). */
export const LEAF_STRIDE = 4;

/**
 * Writes the drawn leaves of a selection straight into the two instance arrays: `leafData` as U0, V0, lattice step per
 * cell, face; `infoData` as level, edge mask, 0, 0. The lattice origin is i * patchCells * 2^(maxLevel - level), an integer
 * up to 2^24, exact in float32. Returns the number of leaves written, at most `capacity`.
 */
export function packLeaves(selector: LodSelector, patchCells: number, maxLevel: number, capacity: number, leafData: Float32Array, infoData: Float32Array): number {
  const count = Math.min(selector.stats.drawn, capacity);
  const { leaves, masks, level, i, j, root } = selector;
  for (let k = 0; k < count; k++) {
    const node = leaves[k];
    const nodeLevel = level[node];
    const step = 1 << (maxLevel - nodeLevel);
    const o = k * LEAF_STRIDE;
    leafData[o] = i[node] * patchCells * step;
    leafData[o + 1] = j[node] * patchCells * step;
    leafData[o + 2] = step;
    leafData[o + 3] = root[node];
    infoData[o] = nodeLevel;
    infoData[o + 1] = masks[k];
    infoData[o + 2] = 0;
    infoData[o + 3] = 0;
  }
  return count;
}
