import { buildPlanetEcology, IPlanetEcology } from './ecology';
import { computeFeatures, IPlanetFeatures } from './features';
import { generateImpactCraters, IImpactCraterResult } from './impact-craters';
import { buildPlanetGraphCore, IPlanetGraphCore } from './planet-graph';
import { createPlanetSurfaceSampler, IPlanetSurfaceSampler } from './planet-surface';
import { deriveIsLand } from './elevation';
import { buildPlanetTectonics, IPlanetTectonics } from './tectonics';
import { IVec3 } from './vec3';
import { IWorldProfile, WORLD_PROFILES, WorldProfileKind } from './world-profile';

export interface ICellPlanetWorldParams {
  readonly cellCount: number;
  readonly seed: number;
  readonly relaxationIterations?: number;
  readonly jitter?: number;
  readonly plateCount?: number;
  readonly worldProfileKind?: WorldProfileKind;
}

/**
 * One canonical cell-planet world: graph building, tectonics, multi-scale impact cratering,
 * ecology & biomes, and the detailed surface sampler that rendering and physics read from.
 */
export interface ICellPlanetWorld {
  readonly graph: IPlanetGraphCore;
  readonly tectonics: IPlanetTectonics;
  readonly ecology: IPlanetEcology;
  readonly features: IPlanetFeatures;
  readonly sampler: IPlanetSurfaceSampler;
  readonly impactCraters?: IImpactCraterResult;
  readonly profile: IWorldProfile;
  readonly eMin: number;
  readonly eMax: number;
  readonly maxSlope: number;
  /** Canonical elevation relative to sea level (unitless, pre height-scale). */
  readonly relativeElevation: (direction: IVec3) => number;
  readonly isLand: (direction: IVec3) => boolean;
}

export function buildCellPlanetWorld(
  params: ICellPlanetWorldParams,
): ICellPlanetWorld {
  const profileKind = params.worldProfileKind ?? 'terran';
  const profile = WORLD_PROFILES[profileKind] ?? WORLD_PROFILES.terran;
  const seed = params.seed;

  const graph = buildPlanetGraphCore({
    cellCount: params.cellCount,
    seed,
    relaxationIterations: params.relaxationIterations ?? 2,
    jitter: params.jitter ?? 0.15,
  });

  const tectonics = buildPlanetTectonics(graph, {
    plateCount: params.plateCount ?? profile.tectonics?.plateCount ?? 10,
    seed,
    ...profile.tectonics,
  });

  let impactCraters: IImpactCraterResult | undefined;
  if (profile.impactCraters) {
    impactCraters = generateImpactCraters(graph, tectonics.elevation, {
      seed,
      ...profile.impactCraters,
    });
    tectonics.elevation = impactCraters.elevation;
  }

  tectonics.isLand = deriveIsLand(
    graph,
    tectonics.elevation,
    tectonics.seaLevelElevation,
    profile.tectonics?.minRegionCellFraction,
  );

  const ecology = buildPlanetEcology(graph, tectonics, {
    climate: profile.climate,
    biomes: {
      archetype: profile.archetype,
      ...profile.biomes,
      craterLandform: impactCraters?.craterLandform,
    },
  });

  const features = computeFeatures(
    graph,
    tectonics,
    ecology.waterBodyKind,
    profile.features,
  );

  const sampler = createPlanetSurfaceSampler(graph, tectonics, ecology, {
    features,
    featureComposition: 'cell',
  });

  let eMin = Infinity;
  let eMax = -Infinity;
  for (let i = 0; i < tectonics.elevation.length; i += 1) {
    const e = tectonics.elevation[i]!;
    if (e < eMin) eMin = e;
    if (e > eMax) eMax = e;
  }

  let maxSlope = 0;
  for (let i = 0; i < ecology.slope.length; i += 1) {
    const s = ecology.slope[i] ?? 0;
    if (s > maxSlope) maxSlope = s;
  }

  return {
    graph,
    tectonics,
    ecology,
    features,
    sampler,
    impactCraters,
    profile,
    eMin,
    eMax,
    maxSlope,
    relativeElevation: (direction: IVec3) => {
      const sample = sampler.sample(direction);
      return sample.elevation - sample.seaLevel;
    },
    isLand: (direction: IVec3) => sampler.sample(direction).isLand,
  };
}
