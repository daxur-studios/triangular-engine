import type { AnimalMovementState, AnimalMovementResult } from './animal-constrained-movement';
import { stepConstrainedAnimalMovement } from './animal-constrained-movement';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface } from './animal-world-surface';

export type AnimalAirFlockMode = 'flight' | 'approach' | 'holding' | 'perched';
export type AnimalAirFlightBehavior = 'route' | 'boid3d';

export interface AnimalAirFlockMember extends AnimalMovementState {
  readonly id: string;
  readonly mode: AnimalAirFlockMode;
  readonly perchId?: string;
}

export interface AnimalRoostSite {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly capacity: number;
  readonly available?: boolean;
}

export interface AnimalRoostAssignment {
  readonly memberId: string;
  readonly perchId?: string;
  readonly slotIndex?: number;
  readonly mode: 'assigned' | 'holding';
}

export interface AnimalAirFlockPolicyDefinition {
  readonly surface: AnimalWorldSurface;
  readonly maximumMembers: number;
  readonly maximumRoostSites: number;
  readonly maximumSpeedMps: number;
  readonly maximumAccelerationMps2: number;
  readonly maximumSubstepDistanceM: number;
  readonly maximumSubsteps: number;
  readonly minimumAltitudeM: number;
  readonly maximumAltitudeM: number;
  readonly preferredAltitudeM: number;
  readonly flightBehavior?: AnimalAirFlightBehavior;
  /** Deterministic per-member flight-height variation around preferred altitude. */
  readonly flightAltitudeSpreadM?: number;
  readonly separationRadiusM: number;
  readonly separationWeight: number;
  readonly cohesionWeight: number;
  readonly alignmentWeight: number;
  readonly targetWeight: number;
  readonly arrivalRadiusM: number;
  readonly holdingRadiusM: number;
  readonly holdingSpeedMps: number;
  /** Minimum deterministic spacing between capacity slots at one roost. */
  readonly roostSlotSpacingM: number;
}

export interface AnimalAirFlockStepInput {
  readonly members: readonly AnimalAirFlockMember[];
  readonly intent: 'fly' | 'roost';
  readonly target: AnimalVector3;
  readonly roostSites?: readonly AnimalRoostSite[];
  readonly deltaSeconds: number;
  readonly universalTime: AnimalTime;
}

export interface AnimalAirFlockStepResult {
  readonly members: readonly AnimalAirFlockMember[];
  readonly assignments: readonly AnimalRoostAssignment[];
  readonly constrained: readonly AnimalMovementResult[];
}

/** Stable capacity allocation. Input order never changes the result. */
export function allocateAnimalRoosts(
  memberIds: readonly string[],
  sites: readonly AnimalRoostSite[],
  referencePosition: AnimalVector3,
  surface: AnimalWorldSurface,
  maximumSites: number,
): readonly AnimalRoostAssignment[] {
  if (!Number.isSafeInteger(maximumSites) || maximumSites < 0) {
    throw new RangeError('Animal maximum roost sites must be a non-negative safe integer.');
  }
  const uniqueMembers = [...new Set(memberIds)].sort((a, b) => a.localeCompare(b));
  if (uniqueMembers.length !== memberIds.length || uniqueMembers.some(id => id.length === 0)) {
    throw new Error('Animal flock member IDs must be unique and non-empty.');
  }
  const orderedSites = sites.map(validateRoostSite)
    .filter(site => site.available !== false && site.capacity > 0)
    .sort((a, b) => surface.surfaceDistance(referencePosition, a.position)
      - surface.surfaceDistance(referencePosition, b.position) || a.id.localeCompare(b.id))
    .slice(0, maximumSites);
  const slots: { readonly siteId: string; readonly slotIndex: number }[] = [];
  for (const site of orderedSites) {
    for (let index = 0; index < site.capacity && slots.length < uniqueMembers.length; index++) {
      slots.push({ siteId: site.id, slotIndex: index });
    }
  }
  return uniqueMembers.map((memberId, index) => slots[index] === undefined
    ? { memberId, mode: 'holding' as const }
    : { memberId, perchId: slots[index].siteId, slotIndex: slots[index].slotIndex, mode: 'assigned' as const });
}

/**
 * Computes one bounded deterministic flock tick. It owns behavior, while the
 * movement kernel and world adapter own topology and constraint enforcement.
 */
export function stepAnimalAirFlock(
  input: AnimalAirFlockStepInput,
  definition: AnimalAirFlockPolicyDefinition,
): AnimalAirFlockStepResult {
  validateDefinition(definition);
  validateVector(input.target, 'Animal flock target');
  if (input.members.length > definition.maximumMembers) {
    throw new RangeError('Animal flock exceeds its bounded member limit.');
  }
  if ((input.roostSites?.length ?? 0) > definition.maximumRoostSites) {
    throw new RangeError('Animal flock exceeds its bounded roost-site limit.');
  }
  const ids = input.members.map(member => member.id);
  if (new Set(ids).size !== ids.length || ids.some(id => id.length === 0)) {
    throw new Error('Animal flock member IDs must be unique and non-empty.');
  }
  const roostIds = (input.roostSites ?? []).map(site => site.id);
  if (new Set(roostIds).size !== roostIds.length) throw new Error('Animal roost site IDs must be unique.');
  const assignments: readonly AnimalRoostAssignment[] = input.intent === 'roost'
    ? allocateAnimalRoosts(ids, input.roostSites ?? [], input.target, definition.surface, definition.maximumRoostSites)
    : [...new Set(ids)].sort((a, b) => a.localeCompare(b)).map(memberId => ({ memberId, mode: 'holding' }));
  const assignmentByMember = new Map(assignments.map(assignment => [assignment.memberId, assignment]));
  const siteById = new Map((input.roostSites ?? []).map(site => [site.id, site]));
  const center = mean(input.members.map(member => member.position), input.target);
  const averageVelocity = mean(input.members.map(member => member.velocity), zero);
  const constrained: AnimalMovementResult[] = [];
  const members = input.members.map(member => {
    validateMember(member);
    const assignment = assignmentByMember.get(member.id);
    const site = assignment?.perchId === undefined ? undefined : siteById.get(assignment.perchId);
    const perchPosition = site && assignment?.slotIndex !== undefined
      ? resolveAnimalRoostPosition(site, assignment.slotIndex, definition)
      : undefined;
    if (input.intent === 'roost' && site && perchPosition
      && distance(member.position, perchPosition) <= definition.arrivalRadiusM) {
      constrained.push({ position: { ...perchPosition }, velocity: { ...zero }, blocked: false, blockReason: 'none', substeps: 0 });
      return { id: member.id, position: { ...perchPosition }, velocity: { ...zero }, mode: 'perched' as const, perchId: site.id };
    }
    const target = input.intent === 'fly'
      ? input.target
      : perchPosition ?? holdingTarget(member.id, input.target, input.universalTime, definition, definition.surface);
    const targetGround = definition.surface.sample(target);
    const baseAltitude = site
      ? Math.max(0, dot(subtract(site.position, targetGround.position), targetGround.surfaceUp))
      : definition.preferredAltitudeM;
    const targetAltitude = input.intent === 'fly' && !site
      ? clamp(baseAltitude + Math.sin(stablePhase(member.id)) * (definition.flightAltitudeSpreadM ?? 0),
        definition.minimumAltitudeM, definition.maximumAltitudeM)
      : baseAltitude;
    const desired = flockDesiredVelocity(member, input.members, center, averageVelocity, target, targetAltitude, definition);
    const moved = stepConstrainedAnimalMovement(member, desired, input.deltaSeconds, input.universalTime, {
      domain: 'air', surface: definition.surface,
      minimumAltitudeM: definition.minimumAltitudeM, maximumAltitudeM: definition.maximumAltitudeM,
      maximumSpeedMps: definition.maximumSpeedMps,
      maximumAccelerationMps2: definition.maximumAccelerationMps2,
      maximumSubstepDistanceM: definition.maximumSubstepDistanceM,
      maximumSubsteps: definition.maximumSubsteps,
    });
    constrained.push(moved);
    return {
      id: member.id, position: moved.position, velocity: moved.velocity,
      mode: input.intent === 'fly' ? 'flight' as const : site ? 'approach' as const : 'holding' as const,
      ...(site ? { perchId: site.id } : {}),
    };
  });
  return { members, assignments, constrained };
}

function flockDesiredVelocity(
  member: AnimalAirFlockMember,
  members: readonly AnimalAirFlockMember[],
  center: AnimalVector3,
  averageVelocity: AnimalVector3,
  target: AnimalVector3,
  targetAltitude: number,
  definition: AnimalAirFlockPolicyDefinition,
): AnimalVector3 {
  const ground = definition.surface.sample(member.position);
  const altitude = dot(subtract(member.position, ground.position), ground.surfaceUp);
  const isBoid3d = (definition.flightBehavior ?? 'route') === 'boid3d';
  let desired = scale(isBoid3d
    ? normalize(subtract(target, member.position))
    : tangentDirection(member.position, target, ground.normal), definition.targetWeight);
  desired = add(desired, scale(isBoid3d
    ? normalize(subtract(center, member.position))
    : tangentDirection(member.position, center, ground.normal), definition.cohesionWeight));
  desired = add(desired, scale(isBoid3d ? averageVelocity : reject(averageVelocity, ground.normal), definition.alignmentWeight));
  let separation = { ...zero };
  for (const other of members) {
    if (other.id === member.id) continue;
    const offset = subtract(member.position, other.position);
    const gap = magnitude(offset);
    if (gap > 1e-9 && gap < definition.separationRadiusM) {
      separation = add(separation, scale(offset, (definition.separationRadiusM - gap) / (gap * definition.separationRadiusM)));
    }
  }
  desired = add(desired, scale(reject(separation, ground.normal), definition.separationWeight));
  const altitudeError = targetAltitude - altitude;
  desired = add(desired, scale(ground.surfaceUp, altitudeError));
  return scaleTo(desired, definition.maximumSpeedMps);
}

function holdingTarget(
  memberId: string,
  center: AnimalVector3,
  time: AnimalTime,
  definition: AnimalAirFlockPolicyDefinition,
  surface: AnimalWorldSurface,
): AnimalVector3 {
  const frame = surface.sample(center);
  const phase = stablePhase(memberId) + time * definition.holdingSpeedMps / Math.max(0.001, definition.holdingRadiusM);
  const ground = surface.moveAlongSurface(frame.position, add(
    scale(frame.tangentU, Math.cos(phase) * definition.holdingRadiusM),
    scale(frame.tangentV, Math.sin(phase) * definition.holdingRadiusM),
  ), 1);
  const sample = surface.sample(ground);
  return add(sample.position, scale(sample.surfaceUp, definition.preferredAltitudeM));
}

/** Resolves one stable capacity slot without assuming a world axis. */
export function resolveAnimalRoostPosition(
  site: AnimalRoostSite,
  slotIndex: number,
  definition: AnimalAirFlockPolicyDefinition,
): AnimalVector3 {
  if (slotIndex === 0 || definition.roostSlotSpacingM === 0) return { ...site.position };
  const base = definition.surface.sample(site.position);
  const altitude = Math.max(0, dot(subtract(site.position, base.position), base.surfaceUp));
  const angle = slotIndex * Math.PI * (3 - Math.sqrt(5));
  const radius = definition.roostSlotSpacingM * Math.sqrt(slotIndex);
  const ground = definition.surface.moveAlongSurface(base.position, add(
    scale(base.tangentU, Math.cos(angle) * radius),
    scale(base.tangentV, Math.sin(angle) * radius),
  ), 1);
  const sample = definition.surface.sample(ground);
  return add(sample.position, scale(sample.surfaceUp, altitude));
}

function validateRoostSite(site: AnimalRoostSite): AnimalRoostSite {
  if (site.id.length === 0 || !Number.isSafeInteger(site.capacity) || site.capacity < 0) {
    throw new RangeError('Animal roost IDs and capacities must be valid.');
  }
  validateVector(site.position, `Animal roost ${site.id}`);
  return site;
}
function validateMember(member: AnimalAirFlockMember): void {
  if (member.id.length === 0) throw new Error('Animal flock member ID cannot be empty.');
  validateVector(member.position, `Animal flock ${member.id} position`);
  validateVector(member.velocity, `Animal flock ${member.id} velocity`);
}
function validateDefinition(value: AnimalAirFlockPolicyDefinition): void {
  if (value.flightBehavior !== undefined && value.flightBehavior !== 'route' && value.flightBehavior !== 'boid3d') {
    throw new RangeError('Animal air-flight behavior is invalid.');
  }
  const nonNegative = [value.maximumSpeedMps, value.maximumAccelerationMps2, value.minimumAltitudeM,
    value.maximumAltitudeM, value.preferredAltitudeM, value.separationRadiusM, value.separationWeight,
    value.cohesionWeight, value.alignmentWeight, value.targetWeight, value.arrivalRadiusM,
    value.flightAltitudeSpreadM ?? 0,
    value.holdingRadiusM, value.holdingSpeedMps, value.roostSlotSpacingM];
  if (nonNegative.some(number => !Number.isFinite(number) || number < 0)
    || value.maximumAltitudeM < value.minimumAltitudeM
    || value.preferredAltitudeM < value.minimumAltitudeM
    || value.preferredAltitudeM > value.maximumAltitudeM
    || !Number.isSafeInteger(value.maximumMembers) || value.maximumMembers < 0
    || !Number.isSafeInteger(value.maximumRoostSites) || value.maximumRoostSites < 0) {
    throw new RangeError('Animal air-flock policy limits are invalid.');
  }
}
function tangentDirection(from: AnimalVector3, to: AnimalVector3, normal: AnimalVector3): AnimalVector3 {
  const tangent = reject(subtract(to, from), normal);
  const length = magnitude(tangent);
  return length > 1e-9 ? scale(tangent, 1 / length) : { ...zero };
}
function stablePhase(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return (hash >>> 0) / 0x100000000 * Math.PI * 2;
}
function mean(values: readonly AnimalVector3[], fallback: AnimalVector3): AnimalVector3 {
  if (values.length === 0) return { ...fallback };
  return scale(values.reduce((sum, value) => add(sum, value), { ...zero }), 1 / values.length);
}
function scaleTo(value: AnimalVector3, length: number): AnimalVector3 {
  const current = magnitude(value);
  return current > 1e-9 ? scale(value, length / current) : { ...zero };
}
function reject(value: AnimalVector3, normal: AnimalVector3): AnimalVector3 { return add(value, scale(normal, -dot(value, normal))); }
function add(a: AnimalVector3, b: AnimalVector3): AnimalVector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(value: AnimalVector3, amount: number): AnimalVector3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function dot(a: AnimalVector3, b: AnimalVector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function magnitude(value: AnimalVector3): number { return Math.hypot(value.x, value.y, value.z); }
function normalize(value: AnimalVector3): AnimalVector3 { const length = magnitude(value); return length > 1e-9 ? scale(value, 1 / length) : { ...zero }; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function distance(a: AnimalVector3, b: AnimalVector3): number { return magnitude(subtract(a, b)); }
function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`);
}
const zero: AnimalVector3 = { x: 0, y: 0, z: 0 };
