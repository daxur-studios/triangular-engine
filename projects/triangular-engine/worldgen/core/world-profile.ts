import { IBiomeParams, PlanetaryBiomeArchetype } from './biomes';
import { IClimateParams } from './climate';
import { IPlanetTectonicsParams } from './tectonics';
import { IFeatureParams } from './features';
import { IImpactCraterParams } from './impact-craters';

export type WorldProfileKind = 'terran' | 'moon' | 'volcanic' | 'protoplanet' | 'mars' | 'venus';

/**
 * A named bundle of overrides across the tectonics/climate/biome/crater pipelines.
 * Allows configuring different planetary archetypes (Earth, Moon, Mars, Venus, Protoplanet).
 */
export interface IWorldProfile {
  kind: WorldProfileKind;
  archetype?: PlanetaryBiomeArchetype;
  tectonics: Partial<IPlanetTectonicsParams>;
  climate: Partial<IClimateParams>;
  biomes: Partial<IBiomeParams>;
  features: IFeatureParams;
  impactCraters?: IImpactCraterParams;
  oceanSubstance: 'water' | 'lava';
}

export const WORLD_PROFILES: Record<WorldProfileKind, IWorldProfile> = {
  terran: {
    kind: 'terran',
    archetype: 'terran',
    tectonics: {},
    climate: {},
    biomes: {},
    features: {},
    oceanSubstance: 'water',
  },
  moon: {
    kind: 'moon',
    archetype: 'cratered_moon',
    tectonics: {
      oceanicFraction: 0,
      targetLandFraction: 1,
      plateCount: 3,
      ridgeBoost: 0.15,
      subductionUplift: 0.15,
    },
    climate: {
      baseTemperatureOffset: -0.9,
    },
    biomes: {
      archetype: 'cratered_moon',
    },
    features: {},
    impactCraters: {
      basinCount: 3,
      complexCraterCount: 14,
      simpleCraterCount: 50,
      mariaBasaltFlooding: true,
      depthScale: 1.1,
      rimScale: 1.2,
    },
    oceanSubstance: 'water',
  },
  mars: {
    kind: 'mars',
    archetype: 'martian',
    tectonics: {
      oceanicFraction: 0.35,
      targetLandFraction: 1,
      plateCount: 4,
      ridgeBoost: 1.3,
      subductionUplift: 0.9,
    },
    climate: {
      baseTemperatureOffset: -0.5,
      aridBeltStrength: 0.9,
    },
    biomes: {
      archetype: 'martian',
    },
    features: { volcanoes: true, mesas: true },
    impactCraters: {
      basinCount: 2,
      complexCraterCount: 10,
      simpleCraterCount: 35,
      mariaBasaltFlooding: false,
      depthScale: 0.8,
      rimScale: 0.9,
    },
    oceanSubstance: 'water',
  },
  venus: {
    kind: 'venus',
    archetype: 'venusian',
    tectonics: {
      oceanicFraction: 0,
      targetLandFraction: 1,
      plateCount: 6,
      ridgeBoost: 1.4,
      subductionUplift: 1.1,
    },
    climate: {
      baseTemperatureOffset: 0.85,
    },
    biomes: {
      archetype: 'venusian',
    },
    features: { volcanoes: true, mesas: true },
    impactCraters: {
      basinCount: 0,
      complexCraterCount: 2,
      simpleCraterCount: 8,
      depthScale: 0.4,
      rimScale: 0.4,
    },
    oceanSubstance: 'water',
  },
  volcanic: {
    kind: 'volcanic',
    archetype: 'terran',
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
    archetype: 'terran',
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
