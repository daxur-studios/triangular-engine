import { animalUnit } from './animal-hash';
import {
  allocateAnimalAquaticZones,
  resolveAnimalAquaticZonePosition,
  stepAnimalAquaticSchool,
  type AnimalAquaticHabitatZone,
  type AnimalAquaticSchoolMember,
  type AnimalAquaticSchoolPolicyDefinition,
} from './animal-aquatic-school-policy';
import type { AnimalTime } from './animal-types';

export type AnimalAquaticSchoolCyclePhase = 'home-schooling' | 'outbound-foraging' | 'feeding' | 'returning';
export interface AnimalAquaticSchoolCycleDefinition {
  readonly groupId: string;
  readonly groupSeed: number;
  readonly memberCount: number;
  readonly homeZone: AnimalAquaticHabitatZone;
  readonly feedingZones: readonly AnimalAquaticHabitatZone[];
  readonly schoolingDurationS: number;
  readonly outboundDurationS: number;
  readonly feedingDurationS: number;
  readonly returnDurationS: number;
  readonly fixedStepSeconds: number;
  readonly maximumReplaySteps: number;
  readonly policy: AnimalAquaticSchoolPolicyDefinition;
}
export interface AnimalAquaticSchoolCycleSample {
  readonly universalTime: AnimalTime;
  readonly cycleTimeS: number;
  readonly cycleDurationS: number;
  readonly cycleIndex: number;
  readonly phase: AnimalAquaticSchoolCyclePhase;
  readonly selectedFeedingZoneId?: string;
  readonly replaySteps: number;
  readonly members: readonly AnimalAquaticSchoolMember[];
}

/** Stateful deterministic reader for a materialized school. */
export interface AnimalAquaticSchoolCyclePlayback {
  sample(universalTime: AnimalTime): AnimalAquaticSchoolCycleSample;
  reset(): void;
}

export function selectAnimalAquaticHabitat(
  groupSeed: number,
  cycleIndex: number,
  home: AnimalAquaticHabitatZone,
  candidates: readonly AnimalAquaticHabitatZone[],
  memberCount: number,
  time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition,
): AnimalAquaticHabitatZone | undefined {
  if (!Number.isSafeInteger(cycleIndex) || !Number.isSafeInteger(memberCount) || memberCount < 0
    || candidates.length > definition.maximumZones) throw new RangeError('Animal aquatic habitat selection bounds are invalid.');
  const ids = candidates.map(candidate => candidate.id);
  if (new Set(ids).size !== ids.length) throw new Error('Animal aquatic feeding-zone IDs must be unique.');
  const homeSample = definition.water.sample(home.position, time);
  return [...candidates].sort((a, b) => a.id.localeCompare(b.id)).filter(candidate => {
    const sample = definition.water.sample(candidate.position, time);
    return candidate.available !== false && candidate.capacity >= memberCount
      && candidate.suitability01 >= definition.minimumZoneSuitability01
      && definition.water.surfaceDistance(home.position, candidate.position) <= definition.maximumZoneDistanceM
      && safe(sample, definition) && sample.surface?.bodyId === homeSample.surface?.bodyId;
  }).map(candidate => ({ candidate,
    score: candidate.suitability01 * (0.8 + animalUnit(groupSeed, `aquatic:${cycleIndex}:${candidate.id}`) * 0.2) }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate;
}

/** Reconstructs at most one canonical schooling/feeding cycle at arbitrary Universal Time. */
export function sampleAnimalAquaticSchoolCycle(
  universalTime: AnimalTime,
  definition: AnimalAquaticSchoolCycleDefinition,
): AnimalAquaticSchoolCycleSample {
  return sampleCycle(universalTime, definition);
}

/**
 * Keeps the last local-cycle state so a playing school never reconstructs its
 * entire cycle each render. Seeking remains direct and deterministic.
 */
export function createAnimalAquaticSchoolCyclePlayback(
  definition: AnimalAquaticSchoolCycleDefinition,
): AnimalAquaticSchoolCyclePlayback {
  let checkpoint: AnimalAquaticSchoolCycleSample | undefined;
  return {
    sample(universalTime) {
      const duration = definition.schoolingDurationS + definition.outboundDurationS
        + definition.feedingDurationS + definition.returnDurationS;
      const cycleIndex = Math.floor(universalTime / duration);
      const cycleTimeS = positiveModulo(universalTime, duration);
      const result = checkpoint !== undefined && checkpoint.cycleIndex === cycleIndex
        && cycleTimeS + 1e-12 >= checkpoint.cycleTimeS
        ? sampleCycle(universalTime, definition, { cycleIndex, cycleTimeS: checkpoint.cycleTimeS, members: checkpoint.members })
        : sampleCycle(universalTime, definition);
      checkpoint = { ...result, members: cloneMembers(result.members) };
      return result;
    },
    reset() { checkpoint = undefined; },
  };
}

function sampleCycle(
  universalTime: AnimalTime,
  definition: AnimalAquaticSchoolCycleDefinition,
  startState?: { readonly cycleIndex: number; readonly cycleTimeS: number; readonly members: readonly AnimalAquaticSchoolMember[] },
): AnimalAquaticSchoolCycleSample {
  validateCycle(universalTime, definition);
  const durations = [definition.schoolingDurationS, definition.outboundDurationS,
    definition.feedingDurationS, definition.returnDurationS];
  const cycleDurationS = durations.reduce((sum, value) => sum + value, 0);
  const cycleIndex = Math.floor(universalTime / cycleDurationS);
  const cycleTimeS = positiveModulo(universalTime, cycleDurationS);
  const cycleStartTime = cycleIndex * cycleDurationS;
  const selected = selectAnimalAquaticHabitat(definition.groupSeed, cycleIndex, definition.homeZone,
    definition.feedingZones, definition.memberCount, cycleStartTime, definition.policy);
  const ids = Array.from({ length: definition.memberCount }, (_, index) => `${definition.groupId}:member:${index}`);
  const homeAssignments = allocateAnimalAquaticZones(ids, [definition.homeZone], definition.homeZone.position,
    cycleStartTime, definition.policy);
  if (homeAssignments.some(value => value.mode !== 'assigned'
    || value.zoneId === undefined || value.slotIndex === undefined)) {
    throw new RangeError('A directly sampled aquatic cycle requires safe home capacity for every member.');
  }
  let members: readonly AnimalAquaticSchoolMember[] = startState?.cycleIndex === cycleIndex
    ? cloneMembers(startState.members)
    : homeAssignments.map(assignment => ({
    id: assignment.memberId,
    position: resolveAnimalAquaticZonePosition(definition.homeZone, assignment.slotIndex!, cycleStartTime, definition.policy),
    velocity: { x: 0, y: 0, z: 0 }, mode: 'rest', zoneId: definition.homeZone.id,
    }));
  let replaySteps = 0;
  let start = startState?.cycleIndex === cycleIndex ? startState.cycleTimeS : 0;
  while (start < cycleTimeS - 1e-12) {
    const boundary = nextPhaseBoundary(start, cycleDurationS, definition);
    const deltaSeconds = Math.min(definition.fixedStepSeconds, cycleTimeS - start, boundary - start);
    if (!(deltaSeconds > 0)) break;
    replaySteps++;
    if (replaySteps > definition.maximumReplaySteps) throw new RangeError('Animal aquatic cycle exceeds its bounded replay limit.');
    const phase = selected
      ? phaseAt(start + Math.min(1e-9, deltaSeconds / 2), definition) : 'home-schooling';
    const intent = phase === 'home-schooling' ? 'rest'
      : phase === 'outbound-foraging' ? 'travel'
        : phase === 'feeding' ? 'forage' : 'rest';
    const zone = phase === 'home-schooling' || phase === 'returning' ? definition.homeZone : selected!;
    members = stepAnimalAquaticSchool({
      members, intent, target: zone.position,
      ...(intent === 'travel' ? {} : { zones: [zone] }),
      deltaSeconds, universalTime: cycleStartTime + start + deltaSeconds,
    }, definition.policy).members;
    start += deltaSeconds;
  }
  return { universalTime, cycleTimeS, cycleDurationS, cycleIndex,
    phase: selected ? phaseAt(cycleTimeS, definition) : 'home-schooling',
    ...(selected ? { selectedFeedingZoneId: selected.id } : {}), replaySteps, members };
}

function cloneMembers(members: readonly AnimalAquaticSchoolMember[]): readonly AnimalAquaticSchoolMember[] {
  return members.map(member => ({ ...member, position: { ...member.position }, velocity: { ...member.velocity } }));
}

function phaseAt(time: number, definition: AnimalAquaticSchoolCycleDefinition): AnimalAquaticSchoolCyclePhase {
  if (time < definition.schoolingDurationS) return 'home-schooling';
  if (time < definition.schoolingDurationS + definition.outboundDurationS) return 'outbound-foraging';
  if (time < definition.schoolingDurationS + definition.outboundDurationS + definition.feedingDurationS) return 'feeding';
  return 'returning';
}
function nextPhaseBoundary(time: number, cycleDuration: number, definition: AnimalAquaticSchoolCycleDefinition): number {
  const outbound = definition.schoolingDurationS + definition.outboundDurationS;
  const feeding = outbound + definition.feedingDurationS;
  return [definition.schoolingDurationS, outbound, feeding, cycleDuration]
    .find(boundary => boundary > time + 1e-12) ?? cycleDuration;
}
function validateCycle(time: AnimalTime, definition: AnimalAquaticSchoolCycleDefinition): void {
  if (!Number.isFinite(time) || definition.groupId.length === 0 || !Number.isSafeInteger(definition.groupSeed)
    || !Number.isSafeInteger(definition.memberCount) || definition.memberCount < 0
    || definition.memberCount > definition.policy.maximumMembers) throw new RangeError('Animal aquatic cycle identity or time is invalid.');
  const durations = [definition.schoolingDurationS, definition.outboundDurationS,
    definition.feedingDurationS, definition.returnDurationS];
  if (durations.some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(definition.fixedStepSeconds) || definition.fixedStepSeconds <= 0
    || !Number.isSafeInteger(definition.maximumReplaySteps) || definition.maximumReplaySteps < 1
    || durations.reduce((sum, value) => sum + Math.ceil(value / definition.fixedStepSeconds), 0)
      > definition.maximumReplaySteps) throw new RangeError('Animal aquatic cycle work bounds are invalid.');
}
function safe(sample: ReturnType<AnimalAquaticSchoolPolicyDefinition['water']['sample']>, definition: AnimalAquaticSchoolPolicyDefinition): boolean { return sample.containsWater && sample.surfaceClearanceM + 1e-9 >= definition.minimumSurfaceClearanceM && sample.surfaceClearanceM <= definition.maximumSurfaceClearanceM + 1e-9 && sample.bottomClearanceM + 1e-9 >= definition.minimumBottomClearanceM; }
function positiveModulo(value: number, modulus: number): number { return ((value % modulus) + modulus) % modulus; }
