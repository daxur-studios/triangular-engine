import { IBiomeParams } from './biomes';
import { IClimateParams } from './climate';
import { IPlanetTectonicsParams } from './tectonics';
import { IFeatureParams } from './features';

export type WorldProfileKind = 'terran' | 'moon' | 'volcanic' | 'protoplanet';

/**
 * A named bundle of overrides across the existing tectonics/climate/biome param bags, plus the
 * new per-cell feature pass (`features.ts`) and a substance flag for whatever
 * `classifyWaterBodies()` calls "the ocean". Deliberately not a new pipeline — every field here
 * is `Partial<>` of an interface that already exists and is already accepted by
 * `buildPlanetTectonics()`/`buildPlanetEcology()`; a profile just picks defaults for them. See
 * runbook 022's "world profiles + per-cell terrain features" spike section.
 */
export interface IWorldProfile {
  kind: WorldProfileKind;
  tectonics: Partial<IPlanetTectonicsParams>;
  climate: Partial<IClimateParams>;
  biomes: Partial<IBiomeParams>;
  features: IFeatureParams;
  /** What `classifyWaterBodies()`'s single largest connected water component actually is. Every
   * other ('lake') component stays water regardless — this only ever recolors/reflags the ocean,
   * see `features.ts`'s doc comment on the distinction from a volcano-adjacent lava lake. */
  oceanSubstance: 'water' | 'lava';
}

/** `terran` is an intentional no-op — every override object is empty, so picking it reproduces
 * today's default generation exactly. */
export const WORLD_PROFILES: Record<WorldProfileKind, IWorldProfile> = {
  terran: {
    kind: 'terran',
    tectonics: {},
    climate: {},
    biomes: {},
    features: {},
    oceanSubstance: 'water',
  },
  moon: {
    kind: 'moon',
    tectonics: {
      oceanicFraction: 0,
      // 1, not e.g. 0.98 — computeElevation() always classifies the bottom
      // (1 - targetLandFraction) of cells as water regardless of how small that fraction is,
      // and computeBiomes() only recolors a non-land cell as 'ice_cap' when it's below the cold
      // threshold; near the equator it isn't, so a near-1-but-not-1 value here still renders as
      // literal blue ocean/lake cells on an airless, waterless moon. 1 is the edge case where
      // seaLevelElevation clamps to the planet's own minimum elevation, so every cell is >= it —
      // zero water cells, matching this profile's actual intent (see the interface doc above).
      targetLandFraction: 1,
    },
    climate: {
      baseTemperatureOffset: -0.9,
    },
    biomes: {},
    features: { craters: true },
    oceanSubstance: 'water',
  },
  volcanic: {
    kind: 'volcanic',
    tectonics: {
      ridgeBoost: 1.1,
      subductionUplift: 0.7,
      islandArcBoost: 0.45,
    },
    climate: {
      baseTemperatureOffset: 0.2,
    },
    biomes: {
      hotTemperatureThreshold: 0.15,
    },
    features: { volcanoes: true, mesas: true, lava: true },
    oceanSubstance: 'water',
  },
  protoplanet: {
    kind: 'protoplanet',
    tectonics: {
      ridgeBoost: 1.1,
      subductionUplift: 0.7,
      islandArcBoost: 0.45,
    },
    climate: {
      baseTemperatureOffset: 0.6,
    },
    biomes: {
      hotTemperatureThreshold: 0.15,
    },
    features: { volcanoes: true, mesas: true, lava: true },
    oceanSubstance: 'lava',
  },
};
