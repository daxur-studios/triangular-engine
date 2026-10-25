import { FADE_END_PIXELS, FADE_START_PIXELS, FOREST_COAST_M, PIXEL_PER_DISTANCE, forestClearance, forestFieldDensity, forestNoise, scatterCells, type IScatterResult } from './forest-field';
import type { IRunwaySite, Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063) second object class: boulders of about 1 to 3 m. Same recipe as the trees, one size down:
 * a body-fixed cell hash with its own seed and its own density field, a mesh up close, a small albedo and roughness
 * speckle in the surface material at mid distance, and nothing beyond. Pure and framework-free; `rock-layer.ts` is the
 * TSL twin of {@link rockFieldDensity}.
 */

/** Rock size range (metres, the mesh's longest axis before it is flattened) and the size the bands are derived from. */
export const ROCK_SIZE_RANGE_M: readonly [number, number] = [1, 3];
export const ROCK_SIZE_M = 2;
/** Lattice cell of the rock scatter: at most one rock per cell. */
export const ROCK_SPACING_M = 6;
export const ROCK_SEED = 2;
/** Lattice cell (metres) and weight of each noise octave of the rock field: outcrop regions and scatter within them. */
export const ROCK_OCTAVES: readonly { readonly cellM: number; readonly weight: number }[] = [
  { cellM: 320, weight: 0.6 },
  { cellM: 45, weight: 0.4 },
];
/** Octave offsets of the rock noise: past the forest octaves' (0 to 2) so the two fields do not line up. */
export const ROCK_OCTAVE_OFFSET = 5;
/** The noise value where rocks start and where the outcrop is full. */
export const ROCK_EDGE: readonly [number, number] = [0.5, 0.72];
/** Rocks are thinned to this share of their density under solid forest: boulders stand in clearings far more than under crowns. */
export const ROCK_UNDER_FOREST = 0.15;
/**
 * Share of the ground a full outcrop's rocks cover: one rock footprint (a disc of the mean size) over its cell. The
 * speckle's coverage is this times the field, so the far form shows the same aggregate as the meshes.
 */
export const ROCK_COVER = (Math.PI * (ROCK_SIZE_M / 2) ** 2) / ROCK_SPACING_M ** 2;

export interface IRockBands {
  /** The rock mesh dissolves out over `meshStartM`..`meshEndM` while the speckle dissolves in. */
  readonly meshStartM: number;
  readonly meshEndM: number;
  /** The speckle is gone by `speckleEndM`: under about a pixel there is nothing left to draw. */
  readonly speckleStartM: number;
  readonly speckleEndM: number;
}

/** The distance bands from the rock size, with the same pixel rule as the trees (1 px = 0.001 x distance). */
export function rockBands(sizeM: number = ROCK_SIZE_M): IRockBands {
  return {
    meshStartM: sizeM / (FADE_START_PIXELS * PIXEL_PER_DISTANCE),
    meshEndM: sizeM / (FADE_END_PIXELS * PIXEL_PER_DISTANCE),
    speckleStartM: sizeM / (2 * PIXEL_PER_DISTANCE),
    speckleEndM: sizeM / (1 * PIXEL_PER_DISTANCE),
  };
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Rock density in [0, 1] at a body-fixed point (metres), at `heightM` above the datum. No runway clearance. */
export function rockFieldDensity(x: number, y: number, z: number, heightM: number): number {
  let n = 0;
  ROCK_OCTAVES.forEach((octave, i) => {
    n += octave.weight * forestNoise(x, y, z, octave.cellM, ROCK_OCTAVE_OFFSET + i);
  });
  const land = smooth(FOREST_COAST_M[0], FOREST_COAST_M[1], heightM);
  const forest = forestFieldDensity(x, y, z, heightM);
  return smooth(ROCK_EDGE[0], ROCK_EDGE[1], n) * land * (1 - (1 - ROCK_UNDER_FOREST) * forest);
}

export interface IRockScatterOptions {
  readonly centre: Vec3;
  readonly radiusM: number;
  readonly areaRadiusM: number;
  readonly site: IRunwaySite | null;
  readonly maxCount?: number;
  heightAt(direction: Vec3): number | null;
}

/** Rocks: {@link scatterCells} with the rock field and the runway clearance. */
export function scatterRocks(options: IRockScatterOptions): IScatterResult {
  const { radiusM, site } = options;
  return scatterCells({
    ...options,
    spacingM: ROCK_SPACING_M,
    seed: ROCK_SEED,
    densityAt: (direction, radius, heightM) =>
      rockFieldDensity(direction[0] * radius, direction[1] * radius, direction[2] * radius, heightM) * forestClearance(site, direction, radiusM),
  });
}
