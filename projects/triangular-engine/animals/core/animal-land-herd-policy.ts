import {
  stepConstrainedAnimalMovement,
  type AnimalMovementResult,
  type AnimalMovementState,
} from './animal-constrained-movement';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWorldSurface } from './animal-world-surface';

export type AnimalLandHerdMode = 'travel' | 'approach' | 'graze' | 'rest' | 'blocked';
export interface AnimalLandHerdMember extends AnimalMovementState {
  readonly id: string;
  readonly mode: AnimalLandHerdMode;
  readonly patchId?: string;
}
export interface AnimalGrazingPatch {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly radiusM: number;
  readonly capacity: number;
  readonly suitability01: number;
  readonly available?: boolean;
}
export interface AnimalLandObstacle {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly radiusM: number;
}
export interface AnimalHerdPatchAssignment {
  readonly memberId: string;
  readonly patchId?: string;
  readonly slotIndex?: number;
  readonly mode: 'assigned' | 'unassigned';
}
export interface AnimalLandHerdPolicyDefinition {
  readonly surface: AnimalWorldSurface;
  readonly maximumMembers: number;
  readonly maximumPatches: number;
  readonly maximumSpeedMps: number;
  readonly maximumAccelerationMps2: number;
  readonly maximumSubstepDistanceM: number;
  readonly maximumSubsteps: number;
  readonly maximumSlope01: number;
  readonly maximumPatchDistanceM: number;
  readonly minimumPatchSuitability01: number;
  readonly separationRadiusM: number;
  readonly separationWeight: number;
  readonly cohesionWeight: number;
  readonly alignmentWeight: number;
  readonly targetWeight: number;
  readonly arrivalRadiusM: number;
  readonly slotSpacingM: number;
  /** Optional stable, loose line formation used only while travelling. */
  readonly travelLineSpacingM?: number;
  /** Small side-to-side separation for a travelling line. */
  readonly travelLineLateralSpacingM?: number;
  /** Seconds of deterministic response lag for travelling followers. */
  readonly leaderFollowDelaySeconds?: number;
  readonly maximumAvoidanceAttempts: number;
  readonly obstacles?: readonly AnimalLandObstacle[];
}
export interface AnimalLandHerdStepInput {
  readonly members: readonly AnimalLandHerdMember[];
  readonly intent: 'travel' | 'graze' | 'rest';
  readonly target: AnimalVector3;
  readonly patches?: readonly AnimalGrazingPatch[];
  readonly deltaSeconds: number;
  readonly universalTime: AnimalTime;
}
export interface AnimalLandHerdStepResult {
  readonly members: readonly AnimalLandHerdMember[];
  readonly assignments: readonly AnimalHerdPatchAssignment[];
  readonly constrained: readonly AnimalMovementResult[];
}

export function allocateAnimalHerdPatches(
  memberIds: readonly string[],
  patches: readonly AnimalGrazingPatch[],
  referencePosition: AnimalVector3,
  surface: AnimalWorldSurface,
  maximumPatches: number,
  maximumDistanceM = Number.POSITIVE_INFINITY,
  minimumSuitability01 = 0,
  maximumSlope01 = 1,
): readonly AnimalHerdPatchAssignment[] {
  validateBound(maximumPatches, 'Animal maximum grazing patches');
  if ((maximumDistanceM !== Number.POSITIVE_INFINITY && (!Number.isFinite(maximumDistanceM) || maximumDistanceM < 0))
    || !Number.isFinite(minimumSuitability01) || minimumSuitability01 < 0 || minimumSuitability01 > 1
    || !Number.isFinite(maximumSlope01) || maximumSlope01 < 0 || maximumSlope01 > 1) {
    throw new RangeError('Animal grazing patch selection limits are invalid.');
  }
  const members = uniqueIds(memberIds, 'Animal herd member');
  const patchIds = patches.map(patch => patch.id);
  if (new Set(patchIds).size !== patchIds.length) throw new Error('Animal grazing patch IDs must be unique.');
  const ordered = patches.map(validatePatch)
    .filter(patch => {
      const sample = surface.sample(patch.position);
      return patch.available !== false && patch.capacity > 0
        && patch.suitability01 >= minimumSuitability01
        && surface.surfaceDistance(referencePosition, patch.position) <= maximumDistanceM
        && sample.walkable && sample.slope01 <= maximumSlope01;
    })
    .sort((a, b) => b.suitability01 - a.suitability01
      || surface.surfaceDistance(referencePosition, a.position)
        - surface.surfaceDistance(referencePosition, b.position)
      || a.id.localeCompare(b.id))
    .slice(0, maximumPatches);
  const slots: { patchId: string; slotIndex: number }[] = [];
  for (const patch of ordered) for (let slotIndex = 0; slotIndex < patch.capacity && slots.length < members.length; slotIndex++) {
    slots.push({ patchId: patch.id, slotIndex });
  }
  return members.map((memberId, index) => slots[index]
    ? { memberId, patchId: slots[index].patchId, slotIndex: slots[index].slotIndex, mode: 'assigned' }
    : { memberId, mode: 'unassigned' });
}

export function resolveAnimalHerdPatchPosition(
  patch: AnimalGrazingPatch,
  slotIndex: number,
  definition: AnimalLandHerdPolicyDefinition,
  _universalTime?: AnimalTime,
): AnimalVector3 {
  validatePatch(patch);
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || slotIndex >= patch.capacity) {
    throw new RangeError('Animal grazing slot index is outside patch capacity.');
  }
  const center = definition.surface.sample(patch.position);
  const angle = slotIndex * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.min(patch.radiusM, definition.slotSpacingM * Math.sqrt(slotIndex));
  let offsetU = Math.cos(angle) * radius;
  let offsetV = Math.sin(angle) * radius;
  const moved = definition.surface.moveAlongSurface(center.position, add(
    scale(center.tangentU, offsetU), scale(center.tangentV, offsetV)), 1);
  const sampled = definition.surface.sample(moved);
  return sampled.walkable && sampled.slope01 <= definition.maximumSlope01
    ? sampled.position : center.position;
}

/**
 * Resolves a member's deterministic place in a travelling herd.  The target
 * remains the route destination; followers trail behind it in the local
 * surface frame rather than all steering toward the identical world point.
 */
export function resolveAnimalHerdTravelPosition(
  memberId: string,
  memberIds: readonly string[],
  center: AnimalVector3,
  target: AnimalVector3,
  averageVelocity: AnimalVector3,
  definition: AnimalLandHerdPolicyDefinition,
): AnimalVector3 {
  const spacing = definition.travelLineSpacingM ?? 0;
  if (spacing === 0 || memberIds.length < 2) return { ...target };
  const orderedIds = uniqueIds(memberIds, 'Animal herd member');
  const rank = orderedIds.indexOf(memberId);
  if (rank < 0) throw new Error('Animal herd travel member must be present in the herd.');
  const frame = definition.surface.sample(target);
  let forward = tangentDirection(center, target, frame.normal);
  if (magnitude(forward) <= 1e-9) forward = normalize(reject(averageVelocity, frame.normal));
  if (magnitude(forward) <= 1e-9) return { ...target };
  let side = normalize(reject(subtract(frame.tangentU, scale(forward, dot(frame.tangentU, forward))), frame.normal));
  if (magnitude(side) <= 1e-9) side = normalize(reject(subtract(frame.tangentV, scale(forward, dot(frame.tangentV, forward))), frame.normal));
  const lateral = (definition.travelLineLateralSpacingM ?? 0) * (rank % 2 === 0 ? -1 : 1);
  return definition.surface.moveAlongSurface(target, add(scale(forward, -rank * spacing), scale(side, lateral)), 1);
}

function resolveAnimalHerdFollowerTarget(
  memberId: string,
  memberIds: readonly string[],
  leader: AnimalLandHerdMember,
  center: AnimalVector3,
  routeTarget: AnimalVector3,
  definition: AnimalLandHerdPolicyDefinition,
): AnimalVector3 {
  const orderedIds = uniqueIds(memberIds, 'Animal herd member');
  const rank = orderedIds.indexOf(memberId);
  if (rank <= 0) return { ...routeTarget };
  const frame = definition.surface.sample(leader.position);
  const route = tangentDirection(center, routeTarget, frame.normal);
  const velocity = reject(leader.velocity, frame.normal);
  const delay = definition.leaderFollowDelaySeconds ?? 0;
  const spacing = definition.travelLineSpacingM ?? 0;
  const behind = add(scale(velocity, -delay), scale(route, -rank * spacing));
  return definition.surface.moveAlongSurface(leader.position, behind, 1);
}

export function stepAnimalLandHerd(
  input: AnimalLandHerdStepInput,
  definition: AnimalLandHerdPolicyDefinition,
): AnimalLandHerdStepResult {
  validateDefinition(definition);
  validateVector(input.target, 'Animal herd target');
  if (input.members.length > definition.maximumMembers) throw new RangeError('Animal herd exceeds its bounded member limit.');
  if ((input.patches?.length ?? 0) > definition.maximumPatches) throw new RangeError('Animal herd exceeds its bounded patch limit.');
  const ids = input.members.map(member => member.id);
  uniqueIds(ids, 'Animal herd member');
  const assignments = input.intent === 'travel' ? [] : allocateAnimalHerdPatches(
    ids, input.patches ?? [], input.target, definition.surface, definition.maximumPatches,
    definition.maximumPatchDistanceM, definition.minimumPatchSuitability01, definition.maximumSlope01);
  const assignmentById = new Map(assignments.map(value => [value.memberId, value]));
  const patchById = new Map((input.patches ?? []).map(patch => [patch.id, patch]));
  const center = mean(input.members.map(member => member.position), input.target);
  const averageVelocity = mean(input.members.map(member => member.velocity), zero);
  const orderedIds = uniqueIds(ids, 'Animal herd member');
  const leader = input.members.find(member => member.id === orderedIds[0]);
  const constrained: AnimalMovementResult[] = [];
  const members = input.members.map(member => {
    validateMember(member);
    const assignment = assignmentById.get(member.id);
    const patch = assignment?.patchId ? patchById.get(assignment.patchId) : undefined;
    const slot = patch && assignment?.slotIndex !== undefined
      ? resolveAnimalHerdPatchPosition(patch, assignment.slotIndex, definition,
        input.intent === 'graze' ? input.universalTime : undefined)
      : undefined;
    const target = slot ?? (input.intent === 'travel' && leader
      ? resolveAnimalHerdFollowerTarget(member.id, ids, leader, center, input.target, definition)
      : input.target);
    const arrived = definition.surface.surfaceDistance(member.position, target) <= definition.arrivalRadiusM;
    if (arrived && (input.intent === 'rest' || input.intent === 'graze') && patch) {
      const stopped = movement(member.position, zero, false, 'none', 0);
      constrained.push(stopped);
      return { id: member.id, position: stopped.position, velocity: stopped.velocity,
        mode: input.intent === 'rest' ? 'rest' as const : 'graze' as const, patchId: patch.id };
    }
    const desired = herdDesiredVelocity(member, input.members, center, averageVelocity, target, definition);
    const moved = moveWithAvoidance(member, desired, input.deltaSeconds, input.universalTime, definition);
    constrained.push(moved);
    return {
      id: member.id, position: moved.position, velocity: moved.velocity,
      mode: moved.blocked ? 'blocked' as const
        : input.intent === 'travel' ? 'travel' as const
          : arrived && input.intent === 'graze' ? 'graze' as const : 'approach' as const,
      ...(patch ? { patchId: patch.id } : {}),
    };
  });
  return { members, assignments, constrained };
}

function moveWithAvoidance(
  member: AnimalLandHerdMember,
  desired: AnimalVector3,
  deltaSeconds: number,
  time: AnimalTime,
  definition: AnimalLandHerdPolicyDefinition,
): AnimalMovementResult {
  const movementDefinition = {
    domain: 'land' as const, surface: definition.surface,
    maximumSpeedMps: definition.maximumSpeedMps,
    maximumAccelerationMps2: definition.maximumAccelerationMps2,
    maximumSubstepDistanceM: definition.maximumSubstepDistanceM,
    maximumSubsteps: definition.maximumSubsteps,
    maximumSlope01: definition.maximumSlope01,
  };
  let result = stepConstrainedAnimalMovement(member, desired, deltaSeconds, time, movementDefinition);
  if (!result.blocked || result.blockReason !== 'blocked-surface') return result;
  const frame = definition.surface.sample(member.position);
  const u = dot(desired, frame.tangentU);
  const v = dot(desired, frame.tangentV);
  for (let attempt = 0; attempt < definition.maximumAvoidanceAttempts; attempt++) {
    const sign = (stablePhase(member.id) + attempt) % 2 < 1 ? 1 : -1;
    const angle = sign * Math.PI / 4 * (Math.floor(attempt / 2) + 1);
    const alternative = add(scale(frame.tangentU, u * Math.cos(angle) - v * Math.sin(angle)),
      scale(frame.tangentV, u * Math.sin(angle) + v * Math.cos(angle)));
    result = stepConstrainedAnimalMovement(member, alternative, deltaSeconds, time, movementDefinition);
    if (!result.blocked) return result;
  }
  return result;
}

function herdDesiredVelocity(
  member: AnimalLandHerdMember,
  members: readonly AnimalLandHerdMember[],
  center: AnimalVector3,
  averageVelocity: AnimalVector3,
  target: AnimalVector3,
  definition: AnimalLandHerdPolicyDefinition,
): AnimalVector3 {
  const frame = definition.surface.sample(member.position);
  let desired = scale(tangentDirection(member.position, target, frame.normal), definition.targetWeight);
  desired = add(desired, scale(tangentDirection(member.position, center, frame.normal), definition.cohesionWeight));
  desired = add(desired, scale(reject(averageVelocity, frame.normal), definition.alignmentWeight));
  let separation = { ...zero };
  for (const other of members) {
    if (other.id === member.id) continue;
    const offset = subtract(member.position, other.position);
    const gap = magnitude(offset);
    if (gap > 1e-9 && gap < definition.separationRadiusM) {
      separation = add(separation, scale(offset, (definition.separationRadiusM - gap) / (gap * definition.separationRadiusM)));
    }
  }
  desired = add(desired, scale(reject(separation, frame.normal), definition.separationWeight));
  let obstacleRepulsion = { ...zero };
  for (const obstacle of definition.obstacles ?? []) {
    const offset = subtract(member.position, obstacle.position);
    const distance = magnitude(offset);
    const clearance = obstacle.radiusM + definition.separationRadiusM;
    if (distance > 1e-9 && distance < clearance) {
      obstacleRepulsion = add(obstacleRepulsion,
        scale(reject(offset, frame.normal), (clearance - distance) / (distance * clearance)));
    }
  }
  desired = add(desired, scale(obstacleRepulsion, definition.separationWeight));
  return scaleTo(desired, definition.maximumSpeedMps);
}

function validateDefinition(value: AnimalLandHerdPolicyDefinition): void {
  validateBound(value.maximumMembers, 'Animal maximum herd members');
  validateBound(value.maximumPatches, 'Animal maximum herd patches');
  validateBound(value.maximumAvoidanceAttempts, 'Animal maximum avoidance attempts');
  const nonNegative = [value.maximumSpeedMps, value.maximumAccelerationMps2, value.separationRadiusM,
    value.separationWeight, value.cohesionWeight, value.alignmentWeight, value.targetWeight,
    value.arrivalRadiusM, value.slotSpacingM, value.travelLineSpacingM ?? 0,
    value.travelLineLateralSpacingM ?? 0, value.leaderFollowDelaySeconds ?? 0, value.maximumPatchDistanceM,
    value.minimumPatchSuitability01, value.maximumSlope01];
  if (nonNegative.some(number => !Number.isFinite(number) || number < 0)
    || value.maximumSlope01 > 1 || value.minimumPatchSuitability01 > 1
    || !Number.isFinite(value.maximumSubstepDistanceM) || value.maximumSubstepDistanceM <= 0
    || !Number.isSafeInteger(value.maximumSubsteps) || value.maximumSubsteps < 1) {
    throw new RangeError('Animal land-herd policy limits are invalid.');
  }
  for (const obstacle of value.obstacles ?? []) {
    if (obstacle.id.length === 0 || !Number.isFinite(obstacle.radiusM) || obstacle.radiusM < 0) {
      throw new RangeError('Animal land-herd obstacle is invalid.');
    }
    validateVector(obstacle.position, `Animal land-herd obstacle ${obstacle.id}`);
  }
}
function validatePatch(patch: AnimalGrazingPatch): AnimalGrazingPatch {
  if (patch.id.length === 0 || !Number.isSafeInteger(patch.capacity) || patch.capacity < 0
    || !Number.isFinite(patch.radiusM) || patch.radiusM < 0
    || !Number.isFinite(patch.suitability01) || patch.suitability01 < 0 || patch.suitability01 > 1) {
    throw new RangeError('Animal grazing patch is invalid.');
  }
  validateVector(patch.position, `Animal grazing patch ${patch.id}`);
  return patch;
}
function validateMember(member: AnimalLandHerdMember): void {
  validateVector(member.position, `Animal herd ${member.id} position`);
  validateVector(member.velocity, `Animal herd ${member.id} velocity`);
}
function validateBound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}
function uniqueIds(ids: readonly string[], label: string): string[] {
  const ordered = [...ids].sort((a, b) => a.localeCompare(b));
  if (ordered.some(id => id.length === 0) || new Set(ordered).size !== ordered.length) throw new Error(`${label} IDs must be unique and non-empty.`);
  return ordered;
}
function tangentDirection(from: AnimalVector3, to: AnimalVector3, normal: AnimalVector3): AnimalVector3 {
  const value = reject(subtract(to, from), normal); const length = magnitude(value);
  return length > 1e-9 ? scale(value, 1 / length) : { ...zero };
}
function normalize(value: AnimalVector3): AnimalVector3 { const length = magnitude(value); return length > 1e-9 ? scale(value, 1 / length) : { ...zero }; }
function stablePhase(id: string): number { let hash = 2166136261; for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619); return (hash >>> 0) / 0x100000000 * Math.PI * 2; }
function mean(values: readonly AnimalVector3[], fallback: AnimalVector3): AnimalVector3 { return values.length ? scale(values.reduce((sum, value) => add(sum, value), { ...zero }), 1 / values.length) : { ...fallback }; }
function scaleTo(value: AnimalVector3, length: number): AnimalVector3 { const current = magnitude(value); return current > 1e-9 ? scale(value, length / current) : { ...zero }; }
function reject(value: AnimalVector3, normal: AnimalVector3): AnimalVector3 { return add(value, scale(normal, -dot(value, normal))); }
function add(a: AnimalVector3, b: AnimalVector3): AnimalVector3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(value: AnimalVector3, amount: number): AnimalVector3 { return { x: value.x * amount, y: value.y * amount, z: value.z * amount }; }
function dot(a: AnimalVector3, b: AnimalVector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function magnitude(value: AnimalVector3): number { return Math.hypot(value.x, value.y, value.z); }
function movement(position: AnimalVector3, velocity: AnimalVector3, blocked: boolean, blockReason: AnimalMovementResult['blockReason'], substeps: number): AnimalMovementResult { return { position: { ...position }, velocity: { ...velocity }, blocked, blockReason, substeps }; }
function validateVector(value: AnimalVector3, label: string): void { if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`); }
const zero: AnimalVector3 = { x: 0, y: 0, z: 0 };
