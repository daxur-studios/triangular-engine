import { animalUnit } from './animal-hash';
import {
  AnimalGroupSnapshot,
  animalGroupId,
  animalGroupSeed,
  type AnimalGroupKey,
} from './animal-group-timeline';
import { AnimalTime, AnimalVector3 } from './animal-types';

export type AnimalHabitatActivity = 'feed' | 'rest';

export interface AnimalGroupRegion {
  readonly worldId: string;
  /** Stable identity of the plane, planet, or cylinder surface. */
  readonly surfaceId: string;
  /** Stable identity cell supplied by the world-domain adapter. */
  readonly cellId: string;
}

export interface AnimalHabitatCandidate {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly kind: string;
  /** Species-aware suitability supplied by the world adapter. */
  readonly suitability01: number;
  readonly activities: readonly AnimalHabitatActivity[];
}

export interface AnimalHabitatCandidates {
  /** Changes whenever candidate identity or placement is regenerated. */
  readonly version: string;
  readonly candidates: readonly AnimalHabitatCandidate[];
}

export interface AnimalGroupSpeciesDefinition {
  readonly id: string;
  /** Breaking population-regeneration version. */
  readonly populationVersion: string;
  /** Fixed bounded group slots considered in every queried cell. */
  readonly groupPoolSize: number;
  readonly occupancy01: number;
  readonly memberCount: { readonly min: number; readonly max: number };
  readonly allowedHabitatKinds: readonly string[];
  readonly minimumSuitability01: number;
  readonly activityDecisionPeriodSeconds: number;
  readonly activities: readonly AnimalHabitatActivity[];
  readonly maximumHabitatCandidates: number;
}

export interface QueryAnimalGroupsOptions {
  readonly worldSeed: number;
  readonly region: AnimalGroupRegion;
  readonly species: AnimalGroupSpeciesDefinition;
  readonly habitats: AnimalHabitatCandidates;
  readonly universalTime: AnimalTime;
}

export interface QueryAnimalPopulationOptions {
  readonly worldSeed: number;
  readonly region: AnimalGroupRegion;
  readonly species: readonly AnimalGroupSpeciesDefinition[];
  readonly habitats: AnimalHabitatCandidates;
  readonly universalTime: AnimalTime;
  /** Hard bound protecting callers from accidentally materializing a whole world cell. */
  readonly maximumGroups: number;
}

export interface QueriedAnimalGroup extends AnimalGroupSnapshot {
  readonly groupSlot: number;
  readonly habitatId: string;
  readonly habitatKind: string;
  readonly habitatVersion: string;
  readonly decisionBucket: number;
}

/**
 * Queries several species in one bounded, order-independent population read.
 * Each species remains an independent deterministic population; this function
 * only supplies the composition boundary used by a game cell/region.
 */
export function queryAnimalPopulation(
  options: QueryAnimalPopulationOptions,
): readonly QueriedAnimalGroup[] {
  if (!Number.isSafeInteger(options.maximumGroups) || options.maximumGroups < 0) {
    throw new RangeError('Animal population group bound must be a non-negative safe integer.');
  }
  if (options.species.length === 0) return [];
  const species = [...options.species].sort((a, b) => a.id.localeCompare(b.id));
  for (let index = 1; index < species.length; index++) {
    if (species[index - 1].id === species[index].id) {
      throw new Error(`Animal species IDs must be unique: ${species[index].id}`);
    }
  }
  const groups = species.flatMap((definition) => queryAnimalGroups({
    worldSeed: options.worldSeed,
    region: options.region,
    species: definition,
    habitats: options.habitats,
    universalTime: options.universalTime,
  }));
  if (groups.length > options.maximumGroups) {
    throw new RangeError('Animal population group bound exceeded.');
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Direct, bounded population query. It derives aggregate groups from stable
 * world/habitat inputs and never consumes authored routes or destinations.
 */
export function queryAnimalGroups(
  options: QueryAnimalGroupsOptions,
): readonly QueriedAnimalGroup[] {
  validateOptions(options);
  const { species, habitats, universalTime } = options;
  const candidates = [...habitats.candidates].sort((a, b) => a.id.localeCompare(b.id));
  validateCandidates(candidates, species.maximumHabitatCandidates);
  const decisionBucket = Math.floor(universalTime / species.activityDecisionPeriodSeconds);
  const activityProgress = positiveModulo(universalTime, species.activityDecisionPeriodSeconds)
    / species.activityDecisionPeriodSeconds;
  const result: QueriedAnimalGroup[] = [];

  for (let groupSlot = 0; groupSlot < species.groupPoolSize; groupSlot++) {
    const key: AnimalGroupKey = {
      worldId: options.region.worldId,
      planetId: options.region.surfaceId,
      cellId: options.region.cellId,
      speciesId: species.id,
      groupId: `${species.populationVersion}:${habitats.version}:${groupSlot}`,
      seed: options.worldSeed,
    };
    const id = animalGroupId(key);
    const seed = animalGroupSeed(key);
    if (animalUnit(seed, 'present') >= species.occupancy01) continue;

    const activity = selectActivity(species.activities, seed, decisionBucket);
    const habitat = selectHabitat(candidates, species, activity, seed, decisionBucket);
    if (!habitat) continue;
    const memberSpan = species.memberCount.max - species.memberCount.min + 1;
    const memberCount = species.memberCount.min
      + Math.min(memberSpan - 1, Math.floor(animalUnit(seed, 'members') * memberSpan));

    result.push({
      id,
      seed,
      time: universalTime,
      position: { ...habitat.position },
      velocity: { x: 0, y: 0, z: 0 },
      activity,
      activityProgress,
      destinationId: habitat.id,
      progress: 0,
      memberCount,
      groupSlot,
      habitatId: habitat.id,
      habitatKind: habitat.kind,
      habitatVersion: habitats.version,
      decisionBucket,
    });
  }
  return result;
}

function selectActivity(
  activities: readonly AnimalHabitatActivity[],
  seed: number,
  bucket: number,
): AnimalHabitatActivity {
  const index = Math.min(
    activities.length - 1,
    Math.floor(animalUnit(seed, `activity:${bucket}`) * activities.length),
  );
  return activities[index];
}

function selectHabitat(
  candidates: readonly AnimalHabitatCandidate[],
  species: AnimalGroupSpeciesDefinition,
  activity: AnimalHabitatActivity,
  seed: number,
  bucket: number,
): AnimalHabitatCandidate | undefined {
  let selected: AnimalHabitatCandidate | undefined;
  let selectedTie = -1;
  for (const candidate of candidates) {
    if (!species.allowedHabitatKinds.includes(candidate.kind)
      || candidate.suitability01 < species.minimumSuitability01
      || !candidate.activities.includes(activity)) continue;
    const tie = animalUnit(seed, `habitat:${bucket}:${activity}:${candidate.id}`);
    if (!selected
      || candidate.suitability01 > selected.suitability01
      || (candidate.suitability01 === selected.suitability01 && tie > selectedTie)
      || (candidate.suitability01 === selected.suitability01 && tie === selectedTie
        && candidate.id.localeCompare(selected.id) < 0)) {
      selected = candidate;
      selectedTie = tie;
    }
  }
  return selected;
}

function validateOptions(options: QueryAnimalGroupsOptions): void {
  validateId(options.region.worldId, 'Animal world');
  validateId(options.region.surfaceId, 'Animal surface');
  validateId(options.region.cellId, 'Animal cell');
  validateId(options.species.id, 'Animal species');
  validateId(options.species.populationVersion, 'Animal population version');
  validateId(options.habitats.version, 'Animal habitat version');
  if (!Number.isSafeInteger(options.worldSeed)) throw new RangeError('Animal world seed must be a safe integer.');
  if (!Number.isFinite(options.universalTime)) throw new RangeError('Animal Universal Time must be finite.');
  if (!Number.isSafeInteger(options.species.groupPoolSize) || options.species.groupPoolSize < 0) {
    throw new RangeError('Animal group pool size must be a non-negative safe integer.');
  }
  if (!Number.isFinite(options.species.occupancy01)
    || options.species.occupancy01 < 0 || options.species.occupancy01 > 1) {
    throw new RangeError('Animal occupancy must be between zero and one.');
  }
  const { min, max } = options.species.memberCount;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
    throw new RangeError('Animal member-count range must contain positive safe integers.');
  }
  if (!Number.isFinite(options.species.minimumSuitability01)
    || options.species.minimumSuitability01 < 0 || options.species.minimumSuitability01 > 1) {
    throw new RangeError('Animal minimum suitability must be between zero and one.');
  }
  if (!(options.species.activityDecisionPeriodSeconds > 0)
    || !Number.isFinite(options.species.activityDecisionPeriodSeconds)) {
    throw new RangeError('Animal activity decision period must be positive and finite.');
  }
  if (options.species.activities.length === 0) throw new Error('Animal species requires at least one activity.');
  if (new Set(options.species.activities).size !== options.species.activities.length) {
    throw new Error('Animal species activities must be unique.');
  }
  if (options.species.allowedHabitatKinds.length === 0
    || options.species.allowedHabitatKinds.some((kind) => kind.length === 0)) {
    throw new Error('Animal species requires non-empty allowed habitat kinds.');
  }
  if (!Number.isSafeInteger(options.species.maximumHabitatCandidates)
    || options.species.maximumHabitatCandidates < 0) {
    throw new RangeError('Animal maximum habitat candidates must be a non-negative safe integer.');
  }
}

function validateCandidates(candidates: readonly AnimalHabitatCandidate[], maximum: number): void {
  if (candidates.length > maximum) throw new RangeError('Animal habitat candidate bound exceeded.');
  let previousId: string | undefined;
  for (const candidate of candidates) {
    validateId(candidate.id, 'Animal habitat');
    if (candidate.id === previousId) throw new Error(`Animal habitat IDs must be unique: ${candidate.id}`);
    previousId = candidate.id;
    if (![candidate.position.x, candidate.position.y, candidate.position.z].every(Number.isFinite)) {
      throw new RangeError(`Animal habitat position must be finite: ${candidate.id}`);
    }
    if (!Number.isFinite(candidate.suitability01)
      || candidate.suitability01 < 0 || candidate.suitability01 > 1) {
      throw new RangeError(`Animal habitat suitability must be between zero and one: ${candidate.id}`);
    }
    if (candidate.kind.length === 0 || candidate.activities.length === 0) {
      throw new Error(`Animal habitat kind and activities cannot be empty: ${candidate.id}`);
    }
    if (new Set(candidate.activities).size !== candidate.activities.length) {
      throw new Error(`Animal habitat activities must be unique: ${candidate.id}`);
    }
  }
}

function validateId(value: string, label: string): void {
  if (value.length === 0) throw new Error(`${label} ID cannot be empty.`);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
