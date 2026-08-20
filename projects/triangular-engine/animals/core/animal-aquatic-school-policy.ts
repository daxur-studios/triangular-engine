import { stepConstrainedAnimalMovement, type AnimalMovementResult, type AnimalMovementState } from './animal-constrained-movement';
import { animalUnit } from './animal-hash';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume } from './animal-water-volume';

export type AnimalAquaticSchoolMode = 'travel' | 'approach' | 'forage' | 'rest' | 'blocked';
export interface AnimalAquaticSchoolMember extends AnimalMovementState {
  readonly id: string;
  readonly mode: AnimalAquaticSchoolMode;
  readonly zoneId?: string;
}
export interface AnimalAquaticHabitatZone {
  readonly id: string;
  /** Authoritative point inside the zone's water column. */
  readonly position: AnimalVector3;
  readonly radiusM: number;
  readonly capacity: number;
  readonly suitability01: number;
  readonly available?: boolean;
}
export interface AnimalAquaticZoneAssignment {
  readonly memberId: string;
  readonly zoneId?: string;
  readonly slotIndex?: number;
  readonly mode: 'assigned' | 'unassigned';
}
export interface AnimalAquaticSchoolPolicyDefinition {
  readonly water: AnimalWaterVolume;
  readonly maximumMembers: number;
  readonly maximumZones: number;
  readonly maximumZoneDistanceM: number;
  readonly minimumZoneSuitability01: number;
  readonly maximumSpeedMps: number;
  readonly maximumAccelerationMps2: number;
  readonly maximumSubstepDistanceM: number;
  readonly maximumSubsteps: number;
  readonly minimumSurfaceClearanceM: number;
  readonly minimumBottomClearanceM: number;
  readonly preferredSurfaceClearanceM: number;
  readonly maximumSurfaceClearanceM: number;
  readonly segmentSampleSpacingM: number;
  readonly separationRadiusM: number;
  readonly separationWeight: number;
  readonly cohesionWeight: number;
  readonly alignmentWeight: number;
  readonly targetWeight: number;
  readonly flowWeight: number;
  readonly depthWeight: number;
  readonly arrivalRadiusM: number;
  readonly slotSpacingM: number;
  /** Optional continuous motion around an assigned habitat anchor. Zero retains a stationary anchor. */
  readonly loiterRadiusM?: number;
  /** Radians per second used for deterministic habitat loitering. */
  readonly loiterAngularSpeedRadPerSecond?: number;
  readonly maximumAvoidanceAttempts: number;
}
export interface AnimalAquaticSchoolStepInput {
  readonly members: readonly AnimalAquaticSchoolMember[];
  readonly intent: 'travel' | 'forage' | 'rest';
  readonly target: AnimalVector3;
  readonly zones?: readonly AnimalAquaticHabitatZone[];
  readonly deltaSeconds: number;
  readonly universalTime: AnimalTime;
}
export interface AnimalAquaticSchoolStepResult {
  readonly members: readonly AnimalAquaticSchoolMember[];
  readonly assignments: readonly AnimalAquaticZoneAssignment[];
  readonly constrained: readonly AnimalMovementResult[];
}

export function allocateAnimalAquaticZones(
  memberIds: readonly string[],
  zones: readonly AnimalAquaticHabitatZone[],
  referencePosition: AnimalVector3,
  time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition,
): readonly AnimalAquaticZoneAssignment[] {
  const members = uniqueIds(memberIds, 'Animal aquatic member');
  if (zones.length > definition.maximumZones) throw new RangeError('Animal school exceeds its bounded habitat-zone limit.');
  const zoneIds = zones.map(zone => zone.id);
  if (new Set(zoneIds).size !== zoneIds.length) throw new Error('Animal aquatic habitat zone IDs must be unique.');
  const reference = definition.water.sample(referencePosition, time);
  const ordered = zones.map(validateZone).filter(zone => {
    const sample = definition.water.sample(zone.position, time);
    return zone.available !== false && zone.capacity > 0
      && zone.suitability01 >= definition.minimumZoneSuitability01
      && definition.water.surfaceDistance(referencePosition, zone.position) <= definition.maximumZoneDistanceM
      && isSafeWater(sample, definition)
      && sample.surface?.bodyId === reference.surface?.bodyId;
  }).sort((a, b) => b.suitability01 - a.suitability01
    || definition.water.surfaceDistance(referencePosition, a.position)
      - definition.water.surfaceDistance(referencePosition, b.position)
    || a.id.localeCompare(b.id));
  const slots: { zoneId: string; slotIndex: number }[] = [];
  for (const zone of ordered) for (let slotIndex = 0; slotIndex < zone.capacity && slots.length < members.length; slotIndex++) {
    slots.push({ zoneId: zone.id, slotIndex });
  }
  return members.map((memberId, index) => slots[index]
    ? { memberId, zoneId: slots[index].zoneId, slotIndex: slots[index].slotIndex, mode: 'assigned' }
    : { memberId, mode: 'unassigned' });
}

export function resolveAnimalAquaticZonePosition(
  zone: AnimalAquaticHabitatZone,
  slotIndex: number,
  time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition,
): AnimalVector3 {
  validateZone(zone);
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0 || slotIndex >= zone.capacity) throw new RangeError('Animal aquatic slot is outside zone capacity.');
  const center = definition.water.sample(zone.position, time);
  if (!isSafeWater(center, definition) || !center.surface || !center.bottom) throw new RangeError('Animal aquatic zone is outside safe water.');
  const angle = slotIndex * Math.PI * (3 - Math.sqrt(5));
  const radius = Math.min(zone.radiusM, definition.slotSpacingM * Math.sqrt(slotIndex));
  const tangent = add(scale(center.bottom.tangentU, Math.cos(angle) * radius),
    scale(center.bottom.tangentV, Math.sin(angle) * radius));
  const movedSurface = definition.water.moveAlongSurface(zone.position, tangent, 1, time);
  if (!movedSurface || movedSurface.bodyId !== center.surface.bodyId) return { ...zone.position };
  const columnProbe = add(movedSurface.position, scale(movedSurface.normal, -definition.minimumSurfaceClearanceM));
  const column = definition.water.sample(columnProbe, time);
  const maximumDepth = Math.min(
    column.waterColumnDepthM - definition.minimumBottomClearanceM,
    definition.maximumSurfaceClearanceM,
  );
  const depth = Math.min(maximumDepth, Math.max(definition.minimumSurfaceClearanceM, definition.preferredSurfaceClearanceM));
  const candidate = add(movedSurface.position, scale(movedSurface.normal, -depth));
  const sampled = definition.water.sample(candidate, time);
  return isSafeWater(sampled, definition)
    && sampled.surface?.bodyId === center.surface.bodyId
    && definition.water.isSegmentValid(zone.position, candidate, time, definition.segmentSampleSpacingM)
    ? candidate : { ...zone.position };
}

/** A deterministic moving target keeps each assigned fish distributed and active. */
export function resolveAnimalAquaticSchoolLoiterPosition(
  zone: AnimalAquaticHabitatZone,
  slotIndex: number,
  memberId: string,
  time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition,
): AnimalVector3 {
  const anchor = resolveAnimalAquaticZonePosition(zone, slotIndex, time, definition);
  const maxRadius = Math.min(zone.radiusM, loiterRadius(definition));
  const angularSpeed = definition.loiterAngularSpeedRadPerSecond ?? 0;
  if (maxRadius === 0 || angularSpeed === 0) return anchor;
  const sample = definition.water.sample(anchor, time);
  if (!sample.surface || !sample.bottom || !isSafeWater(sample, definition)) return anchor;
  const phase = animalUnit(0, `aquatic-loiter:${memberId}`) * Math.PI * 2 + time * angularSpeed;

  for (let factor = 1.0; factor >= 0.2; factor -= 0.2) {
    const radius = maxRadius * factor;
    const tangent = add(
      scale(sample.bottom.tangentU, Math.cos(phase) * radius),
      scale(sample.bottom.tangentV, Math.sin(phase) * radius),
    );
    const surface = definition.water.moveAlongSurface(anchor, tangent, 1, time);
    if (!surface || surface.bodyId !== sample.surface.bodyId) continue;
    const columnProbe = add(surface.position, scale(surface.normal, -definition.minimumSurfaceClearanceM));
    const column = definition.water.sample(columnProbe, time);
    const maximumDepth = Math.min(
      column.waterColumnDepthM - definition.minimumBottomClearanceM,
      definition.maximumSurfaceClearanceM,
    );
    const depth = Math.min(maximumDepth, Math.max(definition.minimumSurfaceClearanceM, definition.preferredSurfaceClearanceM));
    const candidate = add(surface.position, scale(surface.normal, -depth));
    const sampled = definition.water.sample(candidate, time);
    if (isSafeWater(sampled, definition)
      && sampled.surface?.bodyId === sample.surface.bodyId
      && definition.water.isSegmentValid(anchor, candidate, time, definition.segmentSampleSpacingM)) {
      return candidate;
    }
  }
  return anchor;
}

export function stepAnimalAquaticSchool(
  input: AnimalAquaticSchoolStepInput,
  definition: AnimalAquaticSchoolPolicyDefinition,
): AnimalAquaticSchoolStepResult {
  validateDefinition(definition);
  validateVector(input.target, 'Animal school target');
  if (input.members.length > definition.maximumMembers) throw new RangeError('Animal school exceeds its bounded member limit.');
  const ids = input.members.map(member => member.id); uniqueIds(ids, 'Animal aquatic member');
  const assignments = input.intent === 'travel' ? []
    : allocateAnimalAquaticZones(ids, input.zones ?? [], input.target, input.universalTime, definition);
  const assignmentById = new Map(assignments.map(value => [value.memberId, value]));
  const zoneById = new Map((input.zones ?? []).map(zone => [zone.id, zone]));
  const center = mean(input.members.map(member => member.position), input.target);
  const averageVelocity = mean(input.members.map(member => member.velocity), zero);
  const constrained: AnimalMovementResult[] = [];
  const members = input.members.map(member => {
    validateMember(member);
    const assignment = assignmentById.get(member.id);
    const zone = assignment?.zoneId ? zoneById.get(assignment.zoneId) : undefined;
    const slot = zone && assignment?.slotIndex !== undefined
      ? resolveAnimalAquaticSchoolLoiterPosition(zone, assignment.slotIndex, member.id, input.universalTime, definition) : undefined;
    const target = slot ?? input.target;
    const arrived = definition.water.surfaceDistance(member.position, target) <= definition.arrivalRadiusM;
    if (arrived && zone && input.intent !== 'travel' && loiterRadius(definition) === 0) {
      const stopped = movement(member.position, zero, false, 'none', 0); constrained.push(stopped);
      return { id: member.id, position: stopped.position, velocity: stopped.velocity,
        mode: input.intent === 'rest' ? 'rest' as const : 'forage' as const, zoneId: zone.id };
    }
    const desired = schoolDesiredVelocity(member, input.members, center, averageVelocity, target, input.universalTime, definition);
    const moved = moveWithAvoidance(member, desired, input.deltaSeconds, input.universalTime, definition);
    constrained.push(moved);
    return { id: member.id, position: moved.position, velocity: moved.velocity,
      mode: moved.blocked ? 'blocked' as const : input.intent === 'travel' ? 'travel' as const : 'approach' as const,
      ...(zone ? { zoneId: zone.id } : {}) };
  });
  return { members, assignments, constrained };
}

function schoolDesiredVelocity(member: AnimalAquaticSchoolMember, members: readonly AnimalAquaticSchoolMember[],
  center: AnimalVector3, averageVelocity: AnimalVector3, target: AnimalVector3, time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition): AnimalVector3 {
  const water = definition.water.sample(member.position, time);
  if (!water.surface) return { ...zero };
  const normal = water.surface.normal;
  let desired = scale(tangentDirection(member.position, target, normal), definition.targetWeight);
  desired = add(desired, scale(tangentDirection(member.position, center, normal), definition.cohesionWeight));
  desired = add(desired, scale(reject(averageVelocity, normal), definition.alignmentWeight));
  desired = add(desired, scale(reject(water.surface.flow, normal), definition.flowWeight));
  let separation = { ...zero };
  for (const other of members) { if (other.id === member.id) continue; const offset = subtract(member.position, other.position); const gap = magnitude(offset); if (gap > 1e-9 && gap < definition.separationRadiusM) separation = add(separation, scale(offset, (definition.separationRadiusM - gap) / (gap * definition.separationRadiusM))); }
  desired = add(desired, scale(reject(separation, normal), definition.separationWeight));
  desired = add(desired, scale(normal, (water.surfaceClearanceM - definition.preferredSurfaceClearanceM) * definition.depthWeight));
  const stoppingSpeed = Math.sqrt(2 * definition.maximumAccelerationMps2
    * definition.water.surfaceDistance(member.position, target));
  return scaleTo(desired, Math.min(definition.maximumSpeedMps, stoppingSpeed));
}

function moveWithAvoidance(member: AnimalAquaticSchoolMember, desired: AnimalVector3, seconds: number, time: AnimalTime,
  definition: AnimalAquaticSchoolPolicyDefinition): AnimalMovementResult {
  const movementDefinition = { domain: 'water' as const, water: definition.water,
    minimumSurfaceClearanceM: definition.minimumSurfaceClearanceM,
    minimumBottomClearanceM: definition.minimumBottomClearanceM,
    maximumSurfaceClearanceM: definition.maximumSurfaceClearanceM,
    segmentSampleSpacingM: definition.segmentSampleSpacingM,
    maximumSpeedMps: definition.maximumSpeedMps, maximumAccelerationMps2: definition.maximumAccelerationMps2,
    maximumSubstepDistanceM: definition.maximumSubstepDistanceM, maximumSubsteps: definition.maximumSubsteps };
  let result = stepConstrainedAnimalMovement(member, desired, seconds, time, movementDefinition);
  if (!result.blocked || result.blockReason !== 'outside-water') return result;
  const sample = definition.water.sample(member.position, time);
  if (!sample.bottom || !sample.surface) return result;
  const u = dot(desired, sample.bottom.tangentU); const v = dot(desired, sample.bottom.tangentV);
  for (let attempt = 0; attempt < definition.maximumAvoidanceAttempts; attempt++) {
    const angle = ((attempt % 2 === 0) ? 1 : -1) * Math.PI / 4 * (Math.floor(attempt / 2) + 1);
    const alternative = add(add(scale(sample.bottom.tangentU, u * Math.cos(angle) - v * Math.sin(angle)),
      scale(sample.bottom.tangentV, u * Math.sin(angle) + v * Math.cos(angle))),
      scale(sample.surface.normal, (sample.surfaceClearanceM - definition.preferredSurfaceClearanceM) * definition.depthWeight));
    result = stepConstrainedAnimalMovement(member, alternative, seconds, time, movementDefinition);
    if (!result.blocked) return result;
  }
  return result;
}

function isSafeWater(sample: ReturnType<AnimalWaterVolume['sample']>, definition: AnimalAquaticSchoolPolicyDefinition): boolean { return sample.containsWater && sample.surfaceClearanceM + 1e-9 >= definition.minimumSurfaceClearanceM && sample.surfaceClearanceM <= definition.maximumSurfaceClearanceM + 1e-9 && sample.bottomClearanceM + 1e-9 >= definition.minimumBottomClearanceM; }
function loiterRadius(definition: AnimalAquaticSchoolPolicyDefinition): number { return definition.loiterRadiusM ?? 0; }
function validateDefinition(value: AnimalAquaticSchoolPolicyDefinition): void { const bounds = [value.maximumMembers, value.maximumZones, value.maximumSubsteps, value.maximumAvoidanceAttempts]; if (bounds.some(number => !Number.isSafeInteger(number) || number < 0) || value.maximumSubsteps < 1) throw new RangeError('Animal aquatic bounded-work limits are invalid.'); const numbers = [value.maximumZoneDistanceM, value.minimumZoneSuitability01, value.maximumSpeedMps, value.maximumAccelerationMps2, value.maximumSubstepDistanceM, value.minimumSurfaceClearanceM, value.minimumBottomClearanceM, value.preferredSurfaceClearanceM, value.maximumSurfaceClearanceM, value.segmentSampleSpacingM, value.separationRadiusM, value.separationWeight, value.cohesionWeight, value.alignmentWeight, value.targetWeight, value.flowWeight, value.depthWeight, value.arrivalRadiusM, value.slotSpacingM, loiterRadius(value), value.loiterAngularSpeedRadPerSecond ?? 0]; if (numbers.some(number => !Number.isFinite(number) || number < 0) || value.minimumZoneSuitability01 > 1 || value.preferredSurfaceClearanceM < value.minimumSurfaceClearanceM || value.preferredSurfaceClearanceM > value.maximumSurfaceClearanceM || value.maximumSubstepDistanceM <= 0 || value.segmentSampleSpacingM <= 0) throw new RangeError('Animal aquatic policy limits are invalid.'); }
function validateZone(zone: AnimalAquaticHabitatZone): AnimalAquaticHabitatZone { if (zone.id.length === 0 || !Number.isSafeInteger(zone.capacity) || zone.capacity < 0 || !Number.isFinite(zone.radiusM) || zone.radiusM < 0 || !Number.isFinite(zone.suitability01) || zone.suitability01 < 0 || zone.suitability01 > 1) throw new RangeError('Animal aquatic habitat zone is invalid.'); validateVector(zone.position, `Animal aquatic zone ${zone.id}`); return zone; }
function validateMember(member: AnimalAquaticSchoolMember): void { validateVector(member.position, `Animal aquatic ${member.id} position`); validateVector(member.velocity, `Animal aquatic ${member.id} velocity`); }
function uniqueIds(ids: readonly string[], label: string): string[] { const ordered = [...ids].sort((a, b) => a.localeCompare(b)); if (ordered.some(id => id.length === 0) || new Set(ordered).size !== ordered.length) throw new Error(`${label} IDs must be unique and non-empty.`); return ordered; }
function tangentDirection(from: AnimalVector3, to: AnimalVector3, normal: AnimalVector3): AnimalVector3 { const value = reject(subtract(to, from), normal); const length = magnitude(value); return length > 1e-9 ? scale(value, 1 / length) : { ...zero }; }
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
