export interface LifeSeasonDefinition {
  readonly id: string;
  readonly start01: number;
  readonly end01: number;
}

export interface LifeSeasonCycle {
  readonly yearLengthSeconds: number;
  readonly seasons: readonly LifeSeasonDefinition[];
  readonly phaseOffset01?: number;
}

export interface LifeSeasonSample {
  readonly season: LifeSeasonDefinition;
  readonly nextSeason: LifeSeasonDefinition;
  readonly seasonIndex: number;
  readonly year01: number;
  readonly progress01: number;
  readonly nextSeasonBlend01: number;
}

export const FOUR_SEASON_CYCLE: LifeSeasonCycle = {
  yearLengthSeconds: 31_536_000,
  seasons: [
    { id: 'spring', start01: 0, end01: 0.25 },
    { id: 'summer', start01: 0.25, end01: 0.5 },
    { id: 'autumn', start01: 0.5, end01: 0.75 },
    { id: 'winter', start01: 0.75, end01: 1 },
  ],
};

/** Samples climate phase directly from UT; it does not depend on frame history. */
export function sampleLifeSeasonAtTime(
  cycle: LifeSeasonCycle,
  universalTimeSeconds: number,
): LifeSeasonSample {
  if (cycle.seasons.length === 0) throw new Error('A life season cycle requires at least one season.');
  const yearLength = Math.max(1e-3, cycle.yearLengthSeconds);
  const year01 = positiveModulo(universalTimeSeconds / yearLength + (cycle.phaseOffset01 ?? 0), 1);
  const index = cycle.seasons.findIndex((season, seasonIndex) => {
    const next = cycle.seasons[(seasonIndex + 1) % cycle.seasons.length];
    return year01 >= season.start01 && (year01 < season.end01 || seasonIndex === cycle.seasons.length - 1);
  });
  const seasonIndex = Math.max(0, index);
  const season = cycle.seasons[seasonIndex];
  const nextSeason = cycle.seasons[(seasonIndex + 1) % cycle.seasons.length];
  const span = Math.max(1e-6, season.end01 - season.start01);
  const progress01 = Math.max(0, Math.min(1, (year01 - season.start01) / span));
  return {
    season,
    nextSeason,
    seasonIndex,
    year01,
    progress01,
    nextSeasonBlend01: smoothstep(Math.max(0, (progress01 - 0.8) / 0.2)),
  };
}

export interface LifeSeasonResponse {
  readonly habitatSuitability01: number;
  readonly migrationPressure01: number;
}

/** Converts a species' seasonal preference into deterministic route pressure. */
export function sampleLifeSeasonResponse(
  sample: LifeSeasonSample,
  preferredSeasonIds: readonly string[],
): LifeSeasonResponse {
  const preferred = preferredSeasonIds.includes(sample.season.id);
  const nextPreferred = preferredSeasonIds.includes(sample.nextSeason.id);
  const suitability = preferred ? 1 - sample.nextSeasonBlend01 * 0.35 : nextPreferred ? sample.nextSeasonBlend01 * 0.75 : 0.2;
  return {
    habitatSuitability01: Math.max(0, Math.min(1, suitability)),
    migrationPressure01: preferred ? sample.nextSeasonBlend01 * 0.35 : 0.65 + sample.nextSeasonBlend01 * 0.35,
  };
}

/** Wraps a world habitat query with deterministic seasonal suitability. */
export function createSeasonalLifeHabitatQuery(
  base: LifeHabitatQuery,
  cycle: LifeSeasonCycle,
  preferredSeasonIds: readonly string[],
): LifeHabitatQuery {
  return {
    sampleHabitat(position: LifeVector3, universalTimeSeconds = 0): LifeHabitatSample {
      const sample = base.sampleHabitat(position, universalTimeSeconds);
      const season = sampleLifeSeasonAtTime(cycle, universalTimeSeconds);
      const response = sampleLifeSeasonResponse(season, preferredSeasonIds);
      return {
        ...sample,
        suitability01: sample.suitability01 * response.habitatSuitability01,
      };
    },
  };
}

function smoothstep(value: number): number { return value * value * (3 - 2 * value); }
function positiveModulo(value: number, modulus: number): number { return ((value % modulus) + modulus) % modulus; }
import type { LifeHabitatQuery, LifeHabitatSample } from './life-habitat';
import type { LifeVector3 } from './life-vector';
