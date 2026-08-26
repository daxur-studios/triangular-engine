import { IPlanetGraphCore } from './planet-graph';

export type Biome =
  | 'ocean'
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
  flatnessSlopeFraction: 0.08,
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
 */
export function computeBiomes(
  graph: IPlanetGraphCore,
  elevation: number[],
  isLand: boolean[],
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

  const biome: Biome[] = new Array(cellCount);
  for (let id = 0; id < cellCount; id++) {
    const isFrozen = temperature[id] <= p.coldTemperatureThreshold;

    if (!isLand[id]) {
      biome[id] = isFrozen ? 'ice_cap' : 'ocean';
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

    if (normalizedElevation >= p.alpineElevationFraction) {
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
