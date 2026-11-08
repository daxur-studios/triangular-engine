import type { NavHeightfield } from './nav-types';

/** Options for {@link generateIslandHeightfield}. */
export interface IslandHeightfieldOptions {
  /** Cells along X and Y when `width`/`height` are not given. Default 512. */
  readonly size?: number;
  /** Cells along X. Defaults to `size`. */
  readonly width?: number;
  /** Cells along Y. Defaults to `size`. */
  readonly height?: number;
  /** Cell edge length in metres. Default 1. */
  readonly cellSize?: number;
  /** Integer seed. The same options always give the same heights. Default 1. */
  readonly seed?: number;
  /** Height of the highest ground above the water level, in metres. Default 90. */
  readonly maxHeight?: number;
  /** Wavelength of the largest noise octave in metres. Default 320. */
  readonly featureSize?: number;
  /** Water level in metres; the island is generated around it. Default 0. */
  readonly waterLevel?: number;
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Generates a deterministic island: seeded fractal value noise multiplied by a radial falloff, so
 * land sits in the middle and the border is water. Intended for tests and demos. The result has
 * `waterLevel` set, so cells at or below it are water.
 *
 * Heights range from a little below the water level (sea floor near the border) up to about
 * `maxHeight` above it. The island fills roughly the middle 70 % of the grid.
 */
export function generateIslandHeightfield(options: IslandHeightfieldOptions = {}): NavHeightfield {
  const size = options.size ?? 512;
  const width = options.width ?? size;
  const height = options.height ?? size;
  const cellSize = options.cellSize ?? 1;
  const seed = (options.seed ?? 1) | 0;
  const maxHeight = options.maxHeight ?? 90;
  const featureSize = options.featureSize ?? 320;
  const waterLevel = options.waterLevel ?? 0;
  const heights = new Float32Array(width * height);
  const freq0 = cellSize / featureSize;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const shoreOffset = 0.04 * maxHeight;
  for (let y = 0; y < height; y++) {
    const dy = (y - cy) / cy;
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx;
      // Wobble the radius with low-frequency noise so the coast is not a circle.
      const wobble = (valueNoise(x * freq0 * 0.7, y * freq0 * 0.7, seed + 101) - 0.5) * 0.35;
      const d = Math.hypot(dx, dy) * (1 + wobble);
      const t = Math.min(1, Math.max(0, (0.95 - d) / 0.7));
      const falloff = t * t * (3 - 2 * t);
      let n = 0;
      let amp = 0.5;
      let freq = freq0;
      let norm = 0;
      for (let o = 0; o < 5; o++) {
        n += amp * valueNoise(x * freq, y * freq, seed + o * 17);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      n /= norm;
      heights[y * width + x] =
        waterLevel + Math.pow(falloff, 1.2) * maxHeight * (0.25 + 1.5 * n * n) - shoreOffset;
    }
  }
  return { width, height, cellSize, heights, waterLevel };
}
