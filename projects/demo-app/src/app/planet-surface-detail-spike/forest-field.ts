import {
  DEFAULT_SCATTER_PIXEL_FADE_RULE,
  computeScatterPixelFadeBand,
  evaluateScatterDensityField,
  hashScatterLattice01,
  hashScatterLatticeCell01,
  scatterPlanetLattice,
  scatterSmoothstep,
  scatterValueNoise3,
  type IScatterDensityFieldDefinition,
  type IScatterPlanetLatticeResult,
  type IScatterPlanetLayerDefinition,
} from 'triangular-engine/scatter';
import { RUNWAY_APRON_M, runwayDistanceM, type IRunwaySite, type Vec3 } from './runway-site';

/**
 * Spike S1 (Plan 063) Q1/Q3: a forest as a continuous density field. Pure and framework-free. The CPU (instance
 * scatter, worker) and the GPU (`forest-layer.ts`, TSL) evaluate the same function: the library's density field
 * (`evaluateScatterDensityField`, integer-hash value noise on body-fixed metres) over {@link FOREST_FIELD}, so a tree is
 * placed exactly where the material layer says there is canopy. Placement is the library's planet shell lattice
 * (`scatterPlanetLattice`). Nothing is stored.
 *
 * Every number the GPU twin must repeat lives in this file: change a constant here and the layer follows.
 */

export const FOREST_TREE_HEIGHT_M = 22;
/** Crown width of one placeholder tree, metres. */
export const FOREST_CROWN_WIDTH_M = 12;
/** Grid cell of the instance scatter: at most one tree per cell, so a solid stand is a tree every 12 m. */
export const FOREST_SPACING_M = 12;
/**
 * Share of the ground a solid stand's crowns cover seen from above: the area of the union of the crowns' discs, measured
 * on the scatter itself (`forest-field.spec.ts` re-measures it and fails if it drifts). It is not the sum of the
 * discs over the cell area: jittered crowns overlap, so 12 m crowns on a 12 m grid cover about 0.65, not 0.79. The far
 * form's canopy cover is this, so both forms show the same aggregate albedo.
 */
export const FOREST_CANOPY_COVER = 0.65;
/** Lattice cell size (metres) and weight of each noise octave: regions, stands, patchy edges. */
export const FOREST_OCTAVES: readonly { readonly cellM: number; readonly weight: number }[] = [
  { cellM: 6000, weight: 0.55 },
  { cellM: 1500, weight: 0.3 },
  { cellM: 120, weight: 0.15 },
];
/** The noise value where forest starts and where it is solid. */
export const FOREST_EDGE: readonly [number, number] = [0.45, 0.62];
/** Forest lives between these heights above the datum: coast to tree line (smoothstep both ends). */
export const FOREST_COAST_M: readonly [number, number] = [5, 40];
export const FOREST_TREELINE_M: readonly [number, number] = [1800, 2600];
/** Trees are cleared from the runway rectangle out to this distance (metres), fully clear inside the first. */
export const FOREST_CLEARANCE_M: readonly [number, number] = [RUNWAY_APRON_M, RUNWAY_APRON_M + 50];

/** The forest's density field: the octaves, the edge, and the coast-to-tree-line height band. */
export const FOREST_FIELD: IScatterDensityFieldDefinition = {
  octaves: FOREST_OCTAVES,
  edge: FOREST_EDGE,
  heightBandM: { rise: FOREST_COAST_M, fall: FOREST_TREELINE_M },
};

/** Instances fade out and the layer fades in over this camera distance band, from the tree's crown width. */
export function forestFadeBand(crownWidthM: number = FOREST_CROWN_WIDTH_M): { startM: number; endM: number } {
  return computeScatterPixelFadeBand(crownWidthM);
}

/** The library's lattice hash, kept under the spike's name for the TSL twin in `forest-layer.ts`. */
export const forestHash = hashScatterLattice01;
/** One pixel spans about this fraction of the viewing distance (the library's default fade rule). */
export const PIXEL_PER_DISTANCE = DEFAULT_SCATTER_PIXEL_FADE_RULE.pixelPerDistance;
/** The library's value noise, kept under the spike's name. */
export const forestNoise = scatterValueNoise3;

/** Forest density in [0, 1] at a body-fixed point (metres), at `heightM` above the datum. No runway clearance. */
export function forestFieldDensity(x: number, y: number, z: number, heightM: number): number {
  return evaluateScatterDensityField(FOREST_FIELD, x, y, z, heightM);
}

/** 0 on the runway and its apron, 1 beyond the clearance. */
export function forestClearance(site: IRunwaySite | null, direction: Vec3, radiusM: number): number {
  if (!site) return 1;
  return scatterSmoothstep(FOREST_CLEARANCE_M[0], FOREST_CLEARANCE_M[1], runwayDistanceM(site, direction, radiusM));
}

/** Seed of the tree layer on the planet lattice. */
export const TREE_SEED = 1;
/** Uniform scale of a tree around the placeholder's 22 m by 12 m. */
export const TREE_SIZE_RANGE: readonly [number, number] = [0.75, 1.25];
/**
 * Salt of a tree's tone draw (`seed * 8` plus this). The library lattice uses 0 to 2 for the jitter, 3 for the keep test,
 * 4 for the yaw and 5 for the size, so the tone takes the next free one. The near form and the far form's shading read it.
 */
export const TREE_TONE_SALT = 6;
/** The library's cell hash under the spike's name, for the TSL twin in `forest-layer.ts` and the building list. */
export const cellHash = hashScatterLatticeCell01;

/** The tree layer: forest field times `densityScale`, cleared off the runway and by `clearanceAt` (the buildings). */
export function treeScatterLayer(
  spacingM: number,
  densityScale: number,
  site: IRunwaySite | null,
  radiusM: number,
  clearanceAt?: (direction: Vec3) => number,
): IScatterPlanetLayerDefinition {
  return {
    id: 'trees',
    generatorVersion: 1,
    seed: TREE_SEED,
    cellSizeM: spacingM,
    sizeRange: TREE_SIZE_RANGE,
    density: ([x, y, z], heightM, direction) =>
      Math.min(forestFieldDensity(x, y, z, heightM) * densityScale, 1) *
      forestClearance(site, direction as Vec3, radiusM) *
      (clearanceAt?.(direction as Vec3) ?? 1),
  };
}

export interface IForestScatterOptions {
  readonly centre: Vec3;
  readonly radiusM: number;
  readonly areaRadiusM: number;
  readonly spacingM: number;
  readonly densityScale: number;
  readonly site: IRunwaySite | null;
  readonly maxCount?: number;
  heightAt(direction: Vec3): number | null;
  /** Extra clearance in [0, 1] at a direction (the test buildings' footprints); default 1. */
  clearanceAt?(direction: Vec3): number;
}

/** Trees: the library's planet lattice with {@link treeScatterLayer}. */
export function scatterForest(options: IForestScatterOptions): IScatterPlanetLatticeResult {
  const { radiusM, densityScale, site, spacingM } = options;
  return scatterPlanetLattice(treeScatterLayer(spacingM, densityScale, site, radiusM, options.clearanceAt), {
    centre: options.centre,
    radiusM,
    windowRadiusM: options.areaRadiusM,
    maxCount: options.maxCount,
    heightAt: (direction) => options.heightAt(direction as Vec3),
  });
}
