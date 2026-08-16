import {
  allocateAnimalRoosts,
  resolveAnimalRoostPosition,
  stepAnimalAirFlock,
  type AnimalAirFlockMember,
  type AnimalAirFlockPolicyDefinition,
  type AnimalRoostSite,
} from './animal-air-flock-policy';
import type { AnimalTime, AnimalVector3 } from './animal-types';

export type AnimalAirFlockCyclePhase = 'roosting' | 'flying' | 'returning';

export interface AnimalAirFlockCycleDefinition {
  readonly groupId: string;
  readonly memberCount: number;
  readonly roostSites: readonly AnimalRoostSite[];
  readonly flightTarget: AnimalVector3;
  readonly roostDurationS: number;
  readonly flightDurationS: number;
  readonly returnDurationS: number;
  readonly fixedStepSeconds: number;
  readonly maximumReplaySteps: number;
  readonly policy: AnimalAirFlockPolicyDefinition;
}

export interface AnimalAirFlockCycleSample {
  readonly universalTime: AnimalTime;
  readonly cycleTimeS: number;
  readonly cycleDurationS: number;
  readonly cycleIndex: number;
  readonly phase: AnimalAirFlockCyclePhase;
  readonly replaySteps: number;
  readonly members: readonly AnimalAirFlockMember[];
}

/**
 * Direct, bounded Universal-Time reconstruction of one repeatable local daily
 * cycle. It never replays elapsed planetary history: at most one configured
 * cycle is stepped from its stable roost state.
 */
export function sampleAnimalAirFlockCycle(
  universalTime: AnimalTime,
  definition: AnimalAirFlockCycleDefinition,
): AnimalAirFlockCycleSample {
  validateCycle(definition, universalTime);
  const cycleDurationS = definition.roostDurationS + definition.flightDurationS + definition.returnDurationS;
  const cycleIndex = Math.floor(universalTime / cycleDurationS);
  const cycleTimeS = positiveModulo(universalTime, cycleDurationS);
  const assignments = allocateAnimalRoosts(
    Array.from({ length: definition.memberCount }, (_, index) => memberId(definition.groupId, index)),
    definition.roostSites,
    definition.flightTarget,
    definition.policy.surface,
    definition.policy.maximumRoostSites,
  );
  if (assignments.some(assignment => assignment.mode !== 'assigned'
    || assignment.perchId === undefined || assignment.slotIndex === undefined)) {
    throw new RangeError('A directly sampled flock cycle requires roost capacity for every member.');
  }
  const siteById = new Map(definition.roostSites.map(site => [site.id, site]));
  let members: readonly AnimalAirFlockMember[] = assignments.map(assignment => {
    const site = siteById.get(assignment.perchId!)!;
    return {
      id: assignment.memberId,
      position: resolveAnimalRoostPosition(site, assignment.slotIndex!, definition.policy),
      velocity: { x: 0, y: 0, z: 0 },
      mode: 'perched', perchId: site.id,
    };
  });
  let replaySteps = 0;
  let stepStart = 0;
  while (stepStart < cycleTimeS - 1e-12) {
    const boundary = nextPhaseBoundary(stepStart, cycleDurationS, definition);
    const deltaSeconds = Math.min(definition.fixedStepSeconds, cycleTimeS - stepStart, boundary - stepStart);
    if (!(deltaSeconds > 0)) break;
    replaySteps++;
    if (replaySteps > definition.maximumReplaySteps) {
      throw new RangeError('Animal flock cycle exceeds its bounded replay-step limit.');
    }
    const phase = phaseAt(stepStart + Math.min(1e-9, deltaSeconds / 2), definition);
    members = stepAnimalAirFlock({
      members,
      intent: phase === 'flying' ? 'fly' : 'roost',
      target: definition.flightTarget,
      roostSites: definition.roostSites,
      deltaSeconds,
      universalTime: stepStart + deltaSeconds,
    }, definition.policy).members;
    stepStart += deltaSeconds;
  }
  return {
    universalTime, cycleTimeS, cycleDurationS, cycleIndex,
    phase: phaseAt(cycleTimeS, definition), replaySteps, members,
  };
}

function phaseAt(time: number, definition: AnimalAirFlockCycleDefinition): AnimalAirFlockCyclePhase {
  if (time < definition.roostDurationS) return 'roosting';
  if (time < definition.roostDurationS + definition.flightDurationS) return 'flying';
  return 'returning';
}
function memberId(groupId: string, index: number): string { return `${groupId}:member:${index}`; }
function positiveModulo(value: number, modulus: number): number { return ((value % modulus) + modulus) % modulus; }
function validateCycle(definition: AnimalAirFlockCycleDefinition, time: AnimalTime): void {
  if (!Number.isFinite(time)) throw new RangeError('Animal flock cycle Universal Time must be finite.');
  if (definition.groupId.length === 0 || !Number.isSafeInteger(definition.memberCount)
    || definition.memberCount < 0 || definition.memberCount > definition.policy.maximumMembers) {
    throw new RangeError('Animal flock cycle group and member count are invalid.');
  }
  const durations = [definition.roostDurationS, definition.flightDurationS, definition.returnDurationS];
  if (durations.some(value => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(definition.fixedStepSeconds) || definition.fixedStepSeconds <= 0
    || !Number.isSafeInteger(definition.maximumReplaySteps) || definition.maximumReplaySteps < 1) {
    throw new RangeError('Animal flock cycle durations and work limits are invalid.');
  }
  const cycleDuration = durations.reduce((sum, value) => sum + value, 0);
  const worstCaseSteps = [definition.roostDurationS, definition.flightDurationS, definition.returnDurationS]
    .reduce((sum, duration) => sum + Math.ceil(duration / definition.fixedStepSeconds), 0);
  if (worstCaseSteps > definition.maximumReplaySteps) {
    throw new RangeError('Animal flock cycle cannot fit within its bounded replay-step limit.');
  }
}
function nextPhaseBoundary(time: number, cycleDuration: number, definition: AnimalAirFlockCycleDefinition): number {
  const boundaries = [definition.roostDurationS, definition.roostDurationS + definition.flightDurationS, cycleDuration];
  return boundaries.find(boundary => boundary > time + 1e-12) ?? cycleDuration;
}
