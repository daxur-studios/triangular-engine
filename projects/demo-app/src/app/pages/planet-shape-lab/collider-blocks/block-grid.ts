import type { TerrainEdit } from '../planet-shape-field';

/**
 * Plan 055, D2 spike: a collider block is a corner-sampled density grid of `BLOCK_CELLS`³ cells (`BLOCK_CORNERS`³
 * samples). Sample `(i, j, k)` sits at `origin + (i, j, k) * voxelM`, body-relative, and is stored at
 * `i + BLOCK_CORNERS * (j + BLOCK_CORNERS * k)`. Density is the terrain field's: negative inside rock, in metres.
 */
export const BLOCK_CELLS = 32;
export const BLOCK_CORNERS = BLOCK_CELLS + 1;
export const BLOCK_SAMPLES = BLOCK_CORNERS ** 3;
export const BLOCK_BYTES = BLOCK_SAMPLES * 4;

export type Vec3 = [number, number, number];

/** What both samplers need to fill one block. `origin` is the minimum corner, body-relative, in doubles. */
export interface DensityBlockSpec {
  readonly radiusM: number;
  readonly origin: Vec3;
  readonly voxelM: number;
  /** The edits in use; none if left out (the CPU twin's default pad is not applied here, so both sides agree). */
  readonly edits?: readonly TerrainEdit[];
  /** Rock mode override for the whole block (0 wild .. 1 grounded); the biomes' own if left out. */
  readonly groundedOverride?: number;
  /** Single biome for the whole block (0 canyons .. 1 hills); the mask if left out. */
  readonly biomeOverride?: number;
}

export const gridIndex = (i: number, j: number, k: number): number => i + BLOCK_CORNERS * (j + BLOCK_CORNERS * k);
