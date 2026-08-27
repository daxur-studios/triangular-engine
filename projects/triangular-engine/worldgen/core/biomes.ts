import { IPlanetGraphCore } from './planet-graph';
import { WaterBodyKind } from './water-bodies';

export type Biome =
  | 'ocean'
  | 'lake'
  | 'ice_cap'
  | 'tundra'
  | 'taiga'
  | 'glacier'
  | 'steppe'
  | 'meadow'
  | 'hills'
  | 'jungle'
  | 'desert'
  | 'savanna'
  | 'rainforest'
  | 'alpine'
  | 'canyon';

export interface IBiomeParams {
  coldTemperatureThreshold?: number;
  hotTemperatureThreshold?: number;
  dryMoistureThreshold?: number;
  wetMoistureThreshold?: number;
  /** Fraction of land relief (seaLevel..maxLandElevation) above which land is 'alpine' regardless of climate. */
  alpineElevationFraction?: number;
  /** Fraction of land relief a cell must drop to a neighbor over for dry land to be 'canyon' instead of its climate biome. */
  canyonSlopeFraction?: number;
  canyonMoistureThreshold?: number;
  /** Fraction of land relief below which temperate/medium-moisture land is 'meadow' rather than 'hills'. */
  flatnessSlopeFraction?: number;
}

export interface IPlanetBiomes {
  biome: Biome[];
  /** Per-cell slope: largest elevation difference to any neighbor. */
  slope: number[];
}

const DEFAULTS = {
  coldTemperatureThreshold: -0.35,
  hotTemperatureThreshold: 0.35,
  dryMoistureThreshold: 0.35,
  wetMoistureThreshold: 0.7,
  alpineElevationFraction: 0.7,
  canyonSlopeFraction: 0.35,
  canyonMoistureThreshold: 0.25,
  // Recalibrated 2026-08-27 alongside computeElevation()'s ridgeFalloffRadius fix: landRelief
  // used to be inflated by unbounded compounding boundary spread, so 0.08 (8% of that inflated
  // relief) comfortably captured ordinary background noise as "flat". With landRelief now at
  // its realistic (un-inflated) scale, empirically the flattest ~20% of temperate/medium-
  // moisture land sits under ~0.2 — see runbook 022.
  flatnessSlopeFraction: 0.2,
};

/**
 * M2 biome pass: a Whittaker-style (temperature, moisture) lookup per Red
 * Blob Games, with relief overrides (alpine, canyon) and a flatness gate on
 * 'meadow' so it always means "buildable, zero macro relief".
 *
 * Elevation/slope are normalized against the actual land relief
 * (`seaLevelElevation` .. max land elevation) rather than fixed absolute
 * cutoffs, since tectonics elevation is an arbitrary unitless scale whose
 * range varies with plate/boundary params. See runbook 022.
 *
 * `waterBodyKind` (from `classifyWaterBodies()`) splits water cells into
 * 'ocean'/'lake' so a land-locked pocket doesn't read as open ocean; a frozen
 * water cell of either kind still reports 'ice_cap', same as before.
 *
 * `ridgeCellIds` (continent-continent convergent boundary cells, from
 * `computeElevation()`) are unconditionally 'alpine', regardless of the
 * elevation-percentile check below — that check alone used to make 'alpine'
 * a wide blob wherever the smoothed elevation field happened to be tall,
 * which is a different (and much wider) area than the actual tectonic
 * mountain line. `ridgeCellIds` is now the primary driver of "this cell is a
 * mountain"; the elevation-percentile check still catches other tall terrain
 * that isn't ridge-adjacent (e.g. compounded subduction uplift). See
 * `computeElevation()`'s `ridgeFalloffRadius` doc comment for the other half
 * of this fix, and runbook 022.
 */
export function computeBiomes(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
  waterBodyKind: (WaterBodyKind | null)[],
  ridgeCellIds: number[],
  seaLevelElevation: number,
  temperature: number[],
  moisture: number[],
  params: IBiomeParams = {},
): IPlanetBiomes {
  const p = { ...DEFAULTS, ...params };
  const cellCount = graph.cells.length;

  const slope = graph.cells.map((cell, id) =>
    cell.neighbors.reduce(
      (max, neighborId) => Math.max(max, Math.abs(elevation[id] - elevation[neighborId])),
      0,
    ),
  );

  const landElevations = elevation.filter((_, id) => isLand[id]);
  const maxLandElevation = landElevations.length > 0 ? Math.max(...landElevations) : seaLevelElevation;
  const landRelief = Math.max(1e-6, maxLandElevation - seaLevelElevation);
  const ridgeSet = new Set(ridgeCellIds);

  const biome: Biome[] = new Array(cellCount);
  for (let id = 0; id < cellCount; id++) {
    const isFrozen = temperature[id] <= p.coldTemperatureThreshold;

    if (!isLand[id]) {
      biome[id] = isFrozen ? 'ice_cap' : waterBodyKind[id] === 'lake' ? 'lake' : 'ocean';
      continue;
    }

    if (isFrozen) {
      biome[id] =
        moisture[id] >= p.wetMoistureThreshold
          ? 'glacier'
          : moisture[id] >= p.dryMoistureThreshold
            ? 'taiga'
            : 'tundra';
      continue;
    }

    const normalizedElevation = Math.max(0, elevation[id] - seaLevelElevation) / landRelief;
    const normalizedSlope = slope[id] / landRelief;

    if (ridgeSet.has(id) || normalizedElevation >= p.alpineElevationFraction) {
      biome[id] = 'alpine';
      continue;
    }
    if (normalizedSlope >= p.canyonSlopeFraction && moisture[id] < p.canyonMoistureThreshold) {
      biome[id] = 'canyon';
      continue;
    }

    const isHot = temperature[id] >= p.hotTemperatureThreshold;
    const isDry = moisture[id] < p.dryMoistureThreshold;
    const isWet = moisture[id] >= p.wetMoistureThreshold;

    if (isHot) {
      biome[id] = isDry ? 'desert' : isWet ? 'rainforest' : 'savanna';
    } else if (isDry) {
      biome[id] = 'steppe';
    } else if (isWet) {
      biome[id] = 'jungle';
    } else {
      biome[id] = normalizedSlope < p.flatnessSlopeFraction ? 'meadow' : 'hills';
    }
  }

  return { biome, slope };
}
