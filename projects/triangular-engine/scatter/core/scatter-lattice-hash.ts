/**
 * Integer hashes of 3-D lattice points, for placement and density noise that
 * must also run on the GPU. Only 32-bit integer multiply, xor and shift, so a
 * TSL or GLSL twin gives the same bits (see `triangular-engine/scatter/tsl`).
 * Changing a constant here is a breaking regeneration of every layer that
 * uses it.
 */

/**
 * Hash of a lattice point to [0, 1) with 24 bits of resolution. The noise
 * hash of {@link scatterValueNoise3}; `scatterLatticeHashNode` in
 * `triangular-engine/scatter/tsl` repeats it on the GPU.
 */
export function hashScatterLattice01(ix: number, iy: number, iz: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * Hash of a lattice cell plus a salt to [0, 1): one independent draw per
 * `salt` for every cell. Placement uses it for a cell's jitter, keep test,
 * yaw and size; give every draw of every layer its own salt.
 */
export function hashScatterLatticeCell01(ix: number, iy: number, iz: number, salt: number): number {
  let h =
    Math.imul(ix, 0x8da6b343) ^
    Math.imul(iy, 0xd8163841) ^
    Math.imul(iz, 0xcb1ab31f) ^
    Math.imul(salt + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}
