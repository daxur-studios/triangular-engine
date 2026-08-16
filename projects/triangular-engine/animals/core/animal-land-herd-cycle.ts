import { animalUnit } from './animal-hash';
import {
  allocateAnimalHerdPatches,
  resolveAnimalHerdPatchPosition,
  stepAnimalLandHerd,
  type AnimalGrazingPatch,
  type AnimalLandHerdMember,
  type AnimalLandHerdPolicyDefinition,
} from './animal-land-herd-policy';
import type { AnimalTime } from './animal-types';

export type AnimalLandHerdCyclePhase = 'resting' | 'outbound-travel' | 'grazing' | 'return-travel';
export interface AnimalLandHerdCycleDefinition {
  readonly groupId: string;
  readonly groupSeed: number;
  readonly memberCount: number;
  readonly homePatch: AnimalGrazingPatch;
  readonly grazingPatches: readonly AnimalGrazingPatch[];
  readonly restDurationS: number;
  readonly outboundTravelDurationS: number;
  readonly grazeDurationS: number;
  readonly returnTravelDurationS: number;
  readonly fixedStepSeconds: number;
  readonly maximumReplaySteps: number;
  readonly policy: AnimalLandHerdPolicyDefinition;
}
export interface AnimalLandHerdCycleSample {
  readonly universalTime: AnimalTime;
  readonly cycleTimeS: number;
  readonly cycleDurationS: number;
  readonly cycleIndex: number;
  readonly phase: AnimalLandHerdCyclePhase;
  readonly selectedGrazingPatchId?: string;
  readonly replaySteps: number;
  readonly members: readonly AnimalLandHerdMember[];
}

export function selectAnimalGrazingPatch(
  groupSeed: number,
  cycleIndex: number,
  homePatch: AnimalGrazingPatch,
  candidates: readonly AnimalGrazingPatch[],
  definition: AnimalLandHerdPolicyDefinition,
  memberCount: number,
): AnimalGrazingPatch | undefined {
  if (!Number.isSafeInteger(cycleIndex) || !Number.isSafeInteger(memberCount) || memberCount < 0
    || candidates.length > definition.maximumPatches) throw new RangeError('Animal grazing selection bounds are invalid.');
  const ids = candidates.map(candidate => candidate.id);
  if (new Set(ids).size !== ids.length) throw new Error('Animal grazing candidate IDs must be unique.');
  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))
    .filter(candidate => {
      const sample = definition.surface.sample(candidate.position);
      return candidate.available !== false && candidate.capacity >= memberCount
        && candidate.suitability01 >= definition.minimumPatchSuitability01
        && definition.surface.surfaceDistance(homePatch.position, candidate.position) <= definition.maximumPatchDistanceM
        && sample.walkable && sample.slope01 <= definition.maximumSlope01;
    })
    .map(candidate => ({
      candidate,
      score: candidate.suitability01 * (0.8 + animalUnit(groupSeed, `graze:${cycleIndex}:${candidate.id}`) * 0.2),
    }))
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate;
}

/** Reconstructs at most one canonical rest/travel/graze/return cycle. */
export function sampleAnimalLandHerdCycle(
  universalTime: AnimalTime,
  definition: AnimalLandHerdCycleDefinition,
): AnimalLandHerdCycleSample {
  validateCycle(universalTime, definition);
  const cycleDurationS = definition.restDurationS + definition.outboundTravelDurationS
    + definition.grazeDurationS + definition.returnTravelDurationS;
  const cycleIndex = Math.floor(universalTime / cycleDurationS);
  const cycleTimeS = positiveModulo(universalTime, cycleDurationS);
  const selected = selectAnimalGrazingPatch(definition.groupSeed, cycleIndex, definition.homePatch,
    definition.grazingPatches, definition.policy, definition.memberCount);
  const memberIds = Array.from({ length: definition.memberCount }, (_, index) => `${definition.groupId}:member:${index}`);
  const homeAssignments = allocateAnimalHerdPatches(memberIds, [definition.homePatch], definition.homePatch.position,
    definition.policy.surface, 1, definition.policy.maximumPatchDistanceM,
    definition.policy.minimumPatchSuitability01, definition.policy.maximumSlope01);
  if (homeAssignments.some(value => value.mode !== 'assigned'
    || value.slotIndex === undefined || value.patchId === undefined)) {
    throw new RangeError('A directly sampled herd cycle requires home capacity for every member.');
  }
  let members: readonly AnimalLandHerdMember[] = homeAssignments.map(assignment => ({
    id: assignment.memberId,
    position: resolveAnimalHerdPatchPosition(definition.homePatch, assignment.slotIndex!, definition.policy),
    velocity: { x: 0, y: 0, z: 0 }, mode: 'rest', patchId: definition.homePatch.id,
  }));
  let replaySteps = 0;
  let start = 0;
  while (start < cycleTimeS - 1e-12) {
    const boundary = nextPhaseBoundary(start, cycleDurationS, definition);
    const deltaSeconds = Math.min(definition.fixedStepSeconds, cycleTimeS - start, boundary - start);
    if (!(deltaSeconds > 0)) break;
    replaySteps++;
    if (replaySteps > definition.maximumReplaySteps) throw new RangeError('Animal herd cycle exceeds its bounded replay limit.');
    const phase = selected
      ? phaseAt(start + Math.min(1e-9, deltaSeconds / 2), definition) : 'resting';
    const intent = phase === 'resting' ? 'rest'
      : phase === 'outbound-travel' ? 'travel'
        : phase === 'grazing' ? 'graze' : 'rest';
    const patch = phase === 'resting' || phase === 'return-travel' ? definition.homePatch : selected!;
    members = stepAnimalLandHerd({
      members, intent, target: patch.position,
      ...(intent === 'travel' ? {} : { patches: [patch] }),
      deltaSeconds, universalTime: start + deltaSeconds,
    }, definition.policy).members;
    start += deltaSeconds;
  }
  return {
    universalTime, cycleTimeS, cycleDurationS, cycleIndex,
    phase: selected ? phaseAt(cycleTimeS, definition) : 'resting',
    ...(selected ? { selectedGrazingPatchId: selected.id } : {}),
    replaySteps, members,
  };
}

function phaseAt(time: number, definition: AnimalLandHerdCycleDefinition): AnimalLandHerdCyclePhase {
  if (time < definition.restDurationS) return 'resting';
  if (time < definition.restDurationS + definition.outboundTravelDurationS) return 'outbound-travel';
  if (time < definition.restDurationS + definition.outboundTravelDurationS + definition.grazeDurationS) return 'grazing';
  return 'return-travel';
}
function validateCycle(time: AnimalTime, definition: AnimalLandHerdCycleDefinition): void {
  if (!Number.isFinite(time) || definition.groupId.length === 0 || !Number.isSafeInteger(definition.groupSeed)
    || !Number.isSafeInteger(definition.memberCount) || definition.memberCount < 0
    || definition.memberCount > definition.policy.maximumMembers) throw new RangeError('Animal herd cycle identity or time is invalid.');
  const durations = [definition.restDurationS, definition.outboundTravelDurationS,
    definition.grazeDurationS, definition.returnTravelDurationS];
  if (durations.some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(definition.fixedStepSeconds) || definition.fixedStepSeconds <= 0
    || !Number.isSafeInteger(definition.maximumReplaySteps) || definition.maximumReplaySteps < 1
    || durations.reduce((sum, value) => sum + Math.ceil(value / definition.fixedStepSeconds), 0)
      > definition.maximumReplaySteps) throw new RangeError('Animal herd cycle work bounds are invalid.');
}
function nextPhaseBoundary(time: number, cycleDuration: number, definition: AnimalLandHerdCycleDefinition): number {
  const outbound = definition.restDurationS + definition.outboundTravelDurationS;
  const grazing = outbound + definition.grazeDurationS;
  const boundaries = [definition.restDurationS, outbound, grazing, cycleDuration];
  return boundaries.find(boundary => boundary > time + 1e-12) ?? cycleDuration;
}
function positiveModulo(value: number, modulus: number): number { return ((value % modulus) + modulus) % modulus; }
