import {
  queryAnimalGroups,
  type QueriedAnimalGroup,
  type QueryAnimalGroupsOptions,
} from './animal-population-query';
import type { AnimalTime } from './animal-types';

interface AnimalConsequenceBase {
  readonly id: string;
  readonly effectiveTime: AnimalTime;
}

export interface AnimalMemberLossConsequence extends AnimalConsequenceBase {
  readonly kind: 'member-loss';
  readonly groupId: string;
  readonly lostMembers: number;
}

export interface AnimalGroupDisplacementConsequence extends AnimalConsequenceBase {
  readonly kind: 'group-displacement';
  readonly groupId: string;
  readonly expiresAt: AnimalTime;
  readonly excludedHabitatIds: readonly string[];
}

export interface AnimalHabitatInvalidatedConsequence extends AnimalConsequenceBase {
  readonly kind: 'habitat-invalidated';
  readonly habitatId: string;
}

export type AnimalGroupConsequence =
  | AnimalMemberLossConsequence
  | AnimalGroupDisplacementConsequence
  | AnimalHabitatInvalidatedConsequence;

export interface EffectiveAnimalGroup extends QueriedAnimalGroup {
  readonly extinct: boolean;
  readonly appliedConsequenceIds: readonly string[];
}

export interface QueryEffectiveAnimalGroupsOptions extends QueryAnimalGroupsOptions {
  readonly consequences: readonly AnimalGroupConsequence[];
  readonly maximumConsequences: number;
}

/**
 * Reconstructs consequences over the deterministic population baseline at one
 * Universal Time. It scans only the caller-bounded event set; elapsed history
 * is never stepped or replayed.
 */
export function queryEffectiveAnimalGroups(
  options: QueryEffectiveAnimalGroupsOptions,
): readonly EffectiveAnimalGroup[] {
  validateConsequences(options.consequences, options.maximumConsequences);
  const events = [...options.consequences].sort((a, b) => a.id.localeCompare(b.id));
  const effectiveEvents = events.filter(event => event.effectiveTime <= options.universalTime);
  const invalidatedHabitats = new Set(effectiveEvents
    .filter((event): event is AnimalHabitatInvalidatedConsequence => event.kind === 'habitat-invalidated')
    .map(event => event.habitatId));
  const baseOptions: QueryAnimalGroupsOptions = {
    ...options,
    habitats: {
      ...options.habitats,
      candidates: options.habitats.candidates.filter(candidate => !invalidatedHabitats.has(candidate.id)),
    },
  };
  const baseline = queryAnimalGroups(baseOptions);
  const result: EffectiveAnimalGroup[] = [];

  for (const original of baseline) {
    const groupEvents = effectiveEvents.filter(event =>
      event.kind !== 'habitat-invalidated' && event.groupId === original.id);
    const displacementEvents = groupEvents.filter(
      (event): event is AnimalGroupDisplacementConsequence =>
        event.kind === 'group-displacement' && options.universalTime < event.expiresAt,
    );
    const excludedHabitats = new Set(displacementEvents.flatMap(event => event.excludedHabitatIds));
    let group: QueriedAnimalGroup | undefined = original;
    if (excludedHabitats.size > 0) {
      group = queryAnimalGroups({
        ...baseOptions,
        habitats: {
          ...baseOptions.habitats,
          candidates: baseOptions.habitats.candidates.filter(candidate => !excludedHabitats.has(candidate.id)),
        },
      }).find(candidate => candidate.id === original.id);
    }
    if (!group) continue;

    const losses = groupEvents
      .filter((event): event is AnimalMemberLossConsequence => event.kind === 'member-loss')
      .reduce((sum, event) => sum + event.lostMembers, 0);
    const memberCount = Math.max(0, group.memberCount - losses);
    const appliedConsequenceIds = [
      ...effectiveEvents
        .filter((event): event is AnimalHabitatInvalidatedConsequence =>
          event.kind === 'habitat-invalidated' && invalidatedHabitats.has(event.habitatId))
        .map(event => event.id),
      ...groupEvents
        .filter(event => event.kind !== 'group-displacement' || options.universalTime < event.expiresAt)
        .map(event => event.id),
    ].sort((a, b) => a.localeCompare(b));
    result.push({ ...group, memberCount, extinct: memberCount === 0, appliedConsequenceIds });
  }
  return result;
}

function validateConsequences(
  consequences: readonly AnimalGroupConsequence[],
  maximumConsequences: number,
): void {
  if (!Number.isSafeInteger(maximumConsequences) || maximumConsequences < 0) {
    throw new RangeError('Animal consequence bound must be a non-negative safe integer.');
  }
  if (consequences.length > maximumConsequences) {
    throw new RangeError('Animal consequence count exceeds its configured bound.');
  }
  const ids = new Set<string>();
  for (const event of consequences) {
    validateId(event.id, 'Animal consequence');
    if (ids.has(event.id)) throw new Error(`Animal consequence IDs must be unique: ${event.id}`);
    ids.add(event.id);
    if (!Number.isFinite(event.effectiveTime)) throw new RangeError('Animal consequence time must be finite.');
    if (event.kind === 'habitat-invalidated') {
      validateId(event.habitatId, 'Animal invalidated habitat');
    } else {
      validateId(event.groupId, 'Animal consequence group');
    }
    if (event.kind === 'member-loss'
      && (!Number.isSafeInteger(event.lostMembers) || event.lostMembers <= 0)) {
      throw new RangeError('Animal lost-member count must be a positive safe integer.');
    }
    if (event.kind === 'group-displacement') {
      if (!Number.isFinite(event.expiresAt) || event.expiresAt <= event.effectiveTime) {
        throw new RangeError('Animal displacement expiry must be finite and after its effective time.');
      }
      const habitatIds = new Set<string>();
      for (const habitatId of event.excludedHabitatIds) {
        validateId(habitatId, 'Animal displaced habitat');
        if (habitatIds.has(habitatId)) throw new Error(`Animal displaced habitat IDs must be unique: ${habitatId}`);
        habitatIds.add(habitatId);
      }
    }
  }
}

function validateId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} ID must not be empty.`);
}
