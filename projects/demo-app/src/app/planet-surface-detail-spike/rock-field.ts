import {
  DEFAULT_SCATTER_PIXEL_FADE_RULE,
  computeScatterPixelFadeBand,
  evaluateScatterDensityField,
  scatterPlanetLattice,
  type IScatterDensityFieldDefinition,
  type IScatterPlanetLatticeResult,
  type IScatterPlanetLayerDefinition,
} from 'triangular-engine/scatter';
import { FOREST_COAST_M, forestClearance, forestFieldDensity } from './forest-field';
import type { IRunwaySite, Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063) second object class: boulders of about 1 to 3 m. Same recipe as the trees, one size down:
 * a layer of the library's planet shell lattice with its own seed, cell size, size range and density field, a mesh up close, a small albedo and roughness
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
  const mesh = computeScatterPixelFadeBand(sizeM);
  const speckle = computeScatterPixelFadeBand(sizeM, { ...DEFAULT_SCATTER_PIXEL_FADE_RULE, startPixels: 2, endPixels: 1 });
  return { meshStartM: mesh.startM, meshEndM: mesh.endM, speckleStartM: speckle.startM, speckleEndM: speckle.endM };
}

/** The rock noise as a library density field: octaves past the forest's, the outcrop edge, and the coast. */
export const ROCK_FIELD: IScatterDensityFieldDefinition = {
  octaves: ROCK_OCTAVES,
  octaveOffset: ROCK_OCTAVE_OFFSET,
  edge: ROCK_EDGE,
  heightBandM: { rise: FOREST_COAST_M },
};

/** Rock density in [0, 1] at a body-fixed point (metres), at `heightM` above the datum. No runway clearance. */
export function rockFieldDensity(x: number, y: number, z: number, heightM: number): number {
  const forest = forestFieldDensity(x, y, z, heightM);
  return evaluateScatterDensityField(ROCK_FIELD, x, y, z, heightM) * (1 - (1 - ROCK_UNDER_FOREST) * forest);
}

/** The rock layer: the rock field, cleared off the runway. */
export function rockScatterLayer(site: IRunwaySite | null, radiusM: number, clearanceAt?: (direction: Vec3) => number): IScatterPlanetLayerDefinition {
  return {
    id: 'rocks',
    generatorVersion: 1,
    seed: ROCK_SEED,
    cellSizeM: ROCK_SPACING_M,
    sizeRange: ROCK_SIZE_RANGE_M,
    density: ([x, y, z], heightM, direction) =>
      rockFieldDensity(x, y, z, heightM) * forestClearance(site, direction as Vec3, radiusM) * (clearanceAt?.(direction as Vec3) ?? 1),
  };
}

export interface IRockScatterOptions {
  readonly centre: Vec3;
  readonly radiusM: number;
  readonly areaRadiusM: number;
  readonly site: IRunwaySite | null;
  readonly maxCount?: number;
  heightAt(direction: Vec3): number | null;
  /** Extra clearance in [0, 1] at a direction (the test buildings' footprints); default 1. */
  clearanceAt?(direction: Vec3): number;
}

/** Rocks: the library's planet lattice with {@link rockScatterLayer}. */
export function scatterRocks(options: IRockScatterOptions): IScatterPlanetLatticeResult {
  return scatterPlanetLattice(rockScatterLayer(options.site, options.radiusM, options.clearanceAt), {
    centre: options.centre,
    radiusM: options.radiusM,
    windowRadiusM: options.areaRadiusM,
    maxCount: options.maxCount,
    heightAt: (direction) => options.heightAt(direction as Vec3),
  });
}
