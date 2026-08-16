import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume } from './animal-water-volume';
import type { AnimalWorldSurface } from './animal-world-surface';

export interface AnimalMovementState {
  readonly position: AnimalVector3;
  readonly velocity: AnimalVector3;
}

interface AnimalMovementBase {
  readonly maximumSpeedMps: number;
  readonly maximumAccelerationMps2: number;
  readonly maximumSubstepDistanceM: number;
  readonly maximumSubsteps: number;
}

export interface AnimalLandMovement extends AnimalMovementBase {
  readonly domain: 'land';
  readonly surface: AnimalWorldSurface;
  readonly maximumSlope01?: number;
}

export interface AnimalAirMovement extends AnimalMovementBase {
  readonly domain: 'air';
  readonly surface: AnimalWorldSurface;
  readonly minimumAltitudeM: number;
  readonly maximumAltitudeM: number;
}

export interface AnimalWaterMovement extends AnimalMovementBase {
  readonly domain: 'water';
  readonly water: AnimalWaterVolume;
  readonly minimumSurfaceClearanceM: number;
  readonly minimumBottomClearanceM: number;
  readonly maximumSurfaceClearanceM?: number;
  readonly segmentSampleSpacingM?: number;
}

export type AnimalConstrainedMovementDefinition =
  | AnimalLandMovement
  | AnimalAirMovement
  | AnimalWaterMovement;

export type AnimalMovementBlockReason =
  | 'none'
  | 'invalid-start'
  | 'blocked-surface'
  | 'outside-water'
  | 'substep-bound';

export interface AnimalMovementResult extends AnimalMovementState {
  readonly blocked: boolean;
  readonly blockReason: AnimalMovementBlockReason;
  readonly substeps: number;
}

/** One deterministic local fixed step constrained by the supplied world adapters. */
export function stepConstrainedAnimalMovement(
  state: AnimalMovementState,
  desiredVelocity: AnimalVector3,
  deltaSeconds: number,
  universalTime: AnimalTime,
  definition: AnimalConstrainedMovementDefinition,
): AnimalMovementResult {
  validateVector(state.position, 'Animal movement position');
  validateVector(state.velocity, 'Animal movement velocity');
  validateVector(desiredVelocity, 'Animal desired velocity');
  validateDefinition(definition);
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('Animal movement delta time must be finite and non-negative.');
  }
  if (!Number.isFinite(universalTime)) throw new RangeError('Animal movement Universal Time must be finite.');
  if (deltaSeconds === 0) return result(state.position, state.velocity, false, 'none', 0);

  const target = clampMagnitude(desiredVelocity, definition.maximumSpeedMps);
  const distance = Math.max(magnitude(state.velocity), definition.maximumSpeedMps) * deltaSeconds;
  const requiredSubsteps = Math.max(1, Math.ceil(distance / definition.maximumSubstepDistanceM));
  if (requiredSubsteps > definition.maximumSubsteps) {
    return result(state.position, state.velocity, true, 'substep-bound', 0);
  }
  const substepSeconds = deltaSeconds / requiredSubsteps;
  return definition.domain === 'land'
    ? stepLand(state, target, substepSeconds, requiredSubsteps, definition)
    : definition.domain === 'air'
      ? stepAir(state, target, substepSeconds, requiredSubsteps, definition)
      : stepWater(state, target, substepSeconds, requiredSubsteps, universalTime, definition);
}

function stepLand(
  state: AnimalMovementState,
  target: AnimalVector3,
  seconds: number,
  substeps: number,
  definition: AnimalLandMovement,
): AnimalMovementResult {
  const start = state.position;
  let position = definition.surface.sample(start).position;
  if (!isWalkable(definition.surface.sample(position), definition.maximumSlope01)) {
    return result(start, { x: 0, y: 0, z: 0 }, true, 'invalid-start', 0);
  }
  let velocity = state.velocity;
  for (let index = 0; index < substeps; index++) {
    const frame = definition.surface.sample(position);
    velocity = approachVelocity(velocity, target, definition.maximumAccelerationMps2 * seconds);
    velocity = clampMagnitude(velocity, definition.maximumSpeedMps);
    velocity = reject(velocity, frame.normal);
    const next = definition.surface.moveAlongSurface(position, velocity, seconds);
    const nextSample = definition.surface.sample(next);
    if (!isWalkable(nextSample, definition.maximumSlope01)) {
      return result(position, { x: 0, y: 0, z: 0 }, true, 'blocked-surface', index + 1);
    }
    if (magnitude(velocity) > 1e-9 && definition.surface.surfaceDistance(position, nextSample.position) < 1e-9) {
      return result(position, { x: 0, y: 0, z: 0 }, true, 'blocked-surface', index + 1);
    }
    position = nextSample.position;
  }
  velocity = reject(velocity, definition.surface.sample(position).normal);
  return result(position, velocity, false, 'none', substeps);
}

function stepAir(
  state: AnimalMovementState,
  target: AnimalVector3,
  seconds: number,
  substeps: number,
  definition: AnimalAirMovement,
): AnimalMovementResult {
  const start = state.position;
  let ground = definition.surface.sample(start);
  let altitude = dot(subtract(start, ground.position), ground.surfaceUp);
  if (altitude < definition.minimumAltitudeM - 1e-6 || altitude > definition.maximumAltitudeM + 1e-6) {
    return result(start, { x: 0, y: 0, z: 0 }, true, 'invalid-start', 0);
  }
  altitude = Math.min(definition.maximumAltitudeM, altitude);
  let position = addScaled(ground.position, ground.surfaceUp, altitude);
  let velocity = state.velocity;
  for (let index = 0; index < substeps; index++) {
    ground = definition.surface.sample(position);
    velocity = approachVelocity(velocity, target, definition.maximumAccelerationMps2 * seconds);
    velocity = clampMagnitude(velocity, definition.maximumSpeedMps);
    const verticalSpeed = dot(velocity, ground.surfaceUp);
    const tangentVelocity = reject(velocity, ground.surfaceUp);
    const nextGroundPosition = definition.surface.moveAlongSurface(ground.position, tangentVelocity, seconds);
    const nextGround = definition.surface.sample(nextGroundPosition);
    altitude = clamp(
      altitude + verticalSpeed * seconds,
      definition.minimumAltitudeM,
      definition.maximumAltitudeM,
    );
    position = addScaled(nextGround.position, nextGround.surfaceUp, altitude);
    velocity = addScaled(reject(velocity, nextGround.surfaceUp), nextGround.surfaceUp, verticalSpeed);
  }
  return result(position, clampMagnitude(velocity, definition.maximumSpeedMps), false, 'none', substeps);
}

function stepWater(
  state: AnimalMovementState,
  target: AnimalVector3,
  seconds: number,
  substeps: number,
  time: AnimalTime,
  definition: AnimalWaterMovement,
): AnimalMovementResult {
  const start = state.position;
  const startSample = definition.water.sample(start, time);
  if (!isSafeWater(startSample, definition)) {
    return result(start, { x: 0, y: 0, z: 0 }, true, 'invalid-start', 0);
  }
  let position = { ...start };
  let velocity = state.velocity;
  let bodyId = startSample.surface?.bodyId;
  for (let index = 0; index < substeps; index++) {
    const stepTime = time + seconds * (index + 1);
    const current = definition.water.sample(position, stepTime);
    if (!current.surface) return result(position, { x: 0, y: 0, z: 0 }, true, 'outside-water', index + 1);
    velocity = approachVelocity(velocity, target, definition.maximumAccelerationMps2 * seconds);
    velocity = clampMagnitude(velocity, definition.maximumSpeedMps);
    const normalSpeed = dot(velocity, current.surface.normal);
    const tangentVelocity = reject(velocity, current.surface.normal);
    const nextSurface = definition.water.moveAlongSurface(position, tangentVelocity, seconds, stepTime);
    if (!nextSurface || nextSurface.bodyId !== bodyId) {
      return result(position, { x: 0, y: 0, z: 0 }, true, 'outside-water', index + 1);
    }
    const maximumDepth = Math.min(
      current.waterColumnDepthM - definition.minimumBottomClearanceM,
      definition.maximumSurfaceClearanceM ?? Number.POSITIVE_INFINITY,
    );
    const depth = clamp(
      current.surfaceClearanceM - normalSpeed * seconds,
      definition.minimumSurfaceClearanceM,
      maximumDepth,
    );
    const next = addScaled(nextSurface.position, nextSurface.normal, -depth);
    if (!definition.water.isSegmentValid(
      position,
      next,
      stepTime,
      definition.segmentSampleSpacingM ?? definition.maximumSubstepDistanceM,
    )) {
      return result(position, { x: 0, y: 0, z: 0 }, true, 'outside-water', index + 1);
    }
    const sample = definition.water.sample(next, stepTime);
    if (!isSafeWater(sample, definition) || sample.surface?.bodyId !== bodyId) {
      return result(position, { x: 0, y: 0, z: 0 }, true, 'outside-water', index + 1);
    }
    position = next;
    velocity = addScaled(reject(velocity, nextSurface.normal), nextSurface.normal, normalSpeed);
  }
  return result(position, clampMagnitude(velocity, definition.maximumSpeedMps), false, 'none', substeps);
}

function isSafeWater(
  sample: ReturnType<AnimalWaterVolume['sample']>,
  definition: AnimalWaterMovement,
): boolean {
  return sample.containsWater
    && sample.surfaceClearanceM + 1e-9 >= definition.minimumSurfaceClearanceM
    && sample.surfaceClearanceM <= (definition.maximumSurfaceClearanceM ?? Number.POSITIVE_INFINITY) + 1e-9
    && sample.bottomClearanceM + 1e-9 >= definition.minimumBottomClearanceM;
}

function approachVelocity(current: AnimalVector3, target: AnimalVector3, maximumDelta: number): AnimalVector3 {
  const delta = subtract(target, current);
  const length = magnitude(delta);
  if (length <= maximumDelta || length === 0) return { ...target };
  return addScaled(current, delta, maximumDelta / length);
}
function clampMagnitude(value: AnimalVector3, maximum: number): AnimalVector3 {
  const length = magnitude(value);
  return length > maximum && length > 0 ? scale(value, maximum / length) : { ...value };
}
function reject(value: AnimalVector3, normal: AnimalVector3): AnimalVector3 {
  return addScaled(value, normal, -dot(value, normal));
}
function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function addScaled(origin: AnimalVector3, direction: AnimalVector3, amount: number): AnimalVector3 {
  return { x: origin.x + direction.x * amount, y: origin.y + direction.y * amount, z: origin.z + direction.z * amount };
}
function scale(value: AnimalVector3, amount: number): AnimalVector3 {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}
function dot(a: AnimalVector3, b: AnimalVector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function magnitude(value: AnimalVector3): number { return Math.hypot(value.x, value.y, value.z); }
function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function result(
  position: AnimalVector3,
  velocity: AnimalVector3,
  blocked: boolean,
  blockReason: AnimalMovementBlockReason,
  substeps: number,
): AnimalMovementResult {
  return { position: { ...position }, velocity: { ...velocity }, blocked, blockReason, substeps };
}
function validateDefinition(definition: AnimalConstrainedMovementDefinition): void {
  if (!Number.isFinite(definition.maximumSpeedMps) || definition.maximumSpeedMps < 0
    || !Number.isFinite(definition.maximumAccelerationMps2) || definition.maximumAccelerationMps2 < 0
    || !Number.isFinite(definition.maximumSubstepDistanceM) || definition.maximumSubstepDistanceM <= 0
    || !Number.isSafeInteger(definition.maximumSubsteps) || definition.maximumSubsteps < 1) {
    throw new RangeError('Animal movement limits must be finite, non-negative, and bounded.');
  }
  if (definition.domain === 'air'
    && (!Number.isFinite(definition.minimumAltitudeM) || !Number.isFinite(definition.maximumAltitudeM)
      || definition.minimumAltitudeM < 0 || definition.maximumAltitudeM < definition.minimumAltitudeM)) {
    throw new RangeError('Animal movement altitude range is invalid.');
  }
  if (definition.domain === 'land' && definition.maximumSlope01 !== undefined
    && (!Number.isFinite(definition.maximumSlope01)
      || definition.maximumSlope01 < 0 || definition.maximumSlope01 > 1)) {
    throw new RangeError('Animal movement maximum slope must be between zero and one.');
  }
  if (definition.domain === 'water'
    && (!Number.isFinite(definition.minimumSurfaceClearanceM)
      || !Number.isFinite(definition.minimumBottomClearanceM)
      || definition.minimumSurfaceClearanceM < 0 || definition.minimumBottomClearanceM < 0)) {
    throw new RangeError('Animal movement water clearances are invalid.');
  }
  if (definition.domain === 'water' && definition.maximumSurfaceClearanceM !== undefined
    && (!Number.isFinite(definition.maximumSurfaceClearanceM)
      || definition.maximumSurfaceClearanceM < definition.minimumSurfaceClearanceM)) {
    throw new RangeError('Animal movement maximum water depth is invalid.');
  }
  if (definition.domain === 'water' && definition.segmentSampleSpacingM !== undefined
    && (!Number.isFinite(definition.segmentSampleSpacingM) || definition.segmentSampleSpacingM <= 0)) {
    throw new RangeError('Animal movement water segment spacing is invalid.');
  }
}
function isWalkable(sample: ReturnType<AnimalWorldSurface['sample']>, maximumSlope01 = 1): boolean {
  return sample.walkable && sample.slope01 <= maximumSlope01;
}
function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`);
}
