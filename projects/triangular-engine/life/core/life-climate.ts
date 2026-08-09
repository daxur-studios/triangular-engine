import type { LifeHabitatQuery, LifeHabitatSample } from './life-habitat';
import type { LifeVector3 } from './life-vector';

export interface LifeClimateSample {
  readonly temperatureC: number;
  readonly precipitation01: number;
  readonly wind: LifeVector3;
  /** 0 means climate makes the location unusable; 1 means no climate penalty. */
  readonly habitatSuitability01: number;
}

export interface LifeClimateQuery {
  sampleClimate(position: LifeVector3, universalTimeSeconds?: number): LifeClimateSample;
}

export interface ClimateHabitatOptions {
  readonly minSuitability01?: number;
}

/**
 * Composes weather/climate with terrain habitat. The climate provider may be
 * a CPU field, sampled weather texture, or BSP's wind simulation adapter.
 */
export function createClimateAwareLifeHabitatQuery(
  base: LifeHabitatQuery,
  climate: LifeClimateQuery,
  options: ClimateHabitatOptions = {},
): LifeHabitatQuery {
  const minimum = Math.max(0, Math.min(1, options.minSuitability01 ?? 0));
  return {
    sampleHabitat(position: LifeVector3, universalTimeSeconds = 0): LifeHabitatSample {
      const habitat = base.sampleHabitat(position, universalTimeSeconds);
      const weather = climate.sampleClimate(position, universalTimeSeconds);
      const climateSuitability = Math.max(minimum, Math.min(1, weather.habitatSuitability01));
      return {
        ...habitat,
        suitability01: habitat.suitability01 * climateSuitability,
      };
    },
  };
}
