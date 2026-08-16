import { animalUnit } from './animal-hash';
import type { AnimalGroupSnapshot } from './animal-group-timeline';
import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume, AnimalWaterVolumeSample } from './animal-water-volume';
import type { AnimalWorldSurface, AnimalWorldSurfaceSample } from './animal-world-surface';

export type AnimalLocomotionDomain = 'air' | 'land' | 'water';

interface AnimalLocalMaterializationBase {
  readonly spreadRadiusM: number;
  /** Hard local-detail cap. Defaults to 256 individuals. */
  readonly maximumMembers?: number;
}

export interface AnimalAirMaterialization extends AnimalLocalMaterializationBase {
  readonly domain: 'air';
  readonly surface: AnimalWorldSurface;
  readonly minimumAltitudeM: number;
  readonly maximumAltitudeM: number;
}

export interface AnimalLandMaterialization extends AnimalLocalMaterializationBase {
  readonly domain: 'land';
  readonly surface: AnimalWorldSurface;
}

export interface AnimalWaterMaterialization extends AnimalLocalMaterializationBase {
  readonly domain: 'water';
  readonly water: AnimalWaterVolume;
  readonly minimumSurfaceClearanceM: number;
  readonly minimumBottomClearanceM: number;
}

export type AnimalLocalMaterializationDefinition =
  | AnimalAirMaterialization
  | AnimalLandMaterialization
  | AnimalWaterMaterialization;

export interface AnimalLocalIndividual {
  readonly id: string;
  readonly groupId: string;
  readonly memberIndex: number;
  readonly position: AnimalVector3;
  readonly velocity: AnimalVector3;
  readonly surfaceUp: AnimalVector3;
  readonly activity: AnimalGroupSnapshot['activity'];
}

/**
 * Reconstructs stable nearby individuals directly from one aggregate group.
 * It branches only on locomotion domain; world topology remains adapter-owned.
 */
export function materializeLocalAnimalGroup(
  group: AnimalGroupSnapshot,
  definition: AnimalLocalMaterializationDefinition,
): readonly AnimalLocalIndividual[] {
  validateDefinition(definition);
  if (!Number.isSafeInteger(group.memberCount) || group.memberCount < 0) {
    throw new RangeError('Animal local member count must be a non-negative safe integer.');
  }
  const individuals: AnimalLocalIndividual[] = [];
  const materializedCount = Math.min(group.memberCount, definition.maximumMembers ?? 256);
  for (let memberIndex = 0; memberIndex < materializedCount; memberIndex++) {
    const id = `${group.id}:member:${memberIndex}`;
    const angle = animalUnit(group.seed, `${id}:angle`) * Math.PI * 2;
    const radius = Math.sqrt(animalUnit(group.seed, `${id}:radius`)) * definition.spreadRadiusM;
    const offsetU = Math.cos(angle) * radius;
    const offsetV = Math.sin(angle) * radius;
    const placement = definition.domain === 'land'
      ? placeOnLand(group.position, definition.surface, offsetU, offsetV)
      : definition.domain === 'air'
        ? placeInAir(group, id, definition, offsetU, offsetV)
        : placeInWater(group.time, group.position, id, definition, offsetU, offsetV);
    individuals.push({
      id,
      groupId: group.id,
      memberIndex,
      position: placement.position,
      velocity: { x: 0, y: 0, z: 0 },
      surfaceUp: placement.surfaceUp,
      activity: group.activity,
    });
  }
  return individuals;
}

function placeOnLand(
  origin: AnimalVector3,
  surface: AnimalWorldSurface,
  offsetU: number,
  offsetV: number,
): Placement {
  const originSample = surface.sample(origin);
  for (const scale of placementScales) {
    const candidate = offsetPosition(originSample, offsetU * scale, offsetV * scale);
    const sample = surface.sample(candidate);
    if (sample.walkable) return { position: sample.position, surfaceUp: sample.surfaceUp };
  }
  throw new Error('Animal land habitat has no walkable placement within the bounded local search.');
}

function placeInAir(
  group: AnimalGroupSnapshot,
  memberId: string,
  definition: AnimalAirMaterialization,
  offsetU: number,
  offsetV: number,
): Placement {
  const originSample = definition.surface.sample(group.position);
  const groundCandidate = offsetPosition(originSample, offsetU, offsetV);
  const ground = definition.surface.sample(groundCandidate);
  const altitude = definition.minimumAltitudeM
    + animalUnit(group.seed, `${memberId}:altitude`)
      * (definition.maximumAltitudeM - definition.minimumAltitudeM);
  return {
    position: addScaled(ground.position, ground.surfaceUp, altitude),
    surfaceUp: ground.surfaceUp,
  };
}

function placeInWater(
  time: AnimalTime,
  origin: AnimalVector3,
  memberId: string,
  definition: AnimalWaterMaterialization,
  offsetU: number,
  offsetV: number,
): Placement {
  const originWater = requireWaterSample(definition.water.sample(origin, time));
  const frame = originWater.bottom!;
  for (const scale of placementScales) {
    const candidate = {
      x: origin.x + frame.tangentU.x * offsetU * scale + frame.tangentV.x * offsetV * scale,
      y: origin.y + frame.tangentU.y * offsetU * scale + frame.tangentV.y * offsetV * scale,
      z: origin.z + frame.tangentU.z * offsetU * scale + frame.tangentV.z * offsetV * scale,
    };
    const column = definition.water.sample(candidate, time);
    if (!column.surface || !column.bottom || column.land || column.dry) continue;
    const usableDepth = column.waterColumnDepthM
      - definition.minimumSurfaceClearanceM - definition.minimumBottomClearanceM;
    if (usableDepth < 0) continue;
    const depth = definition.minimumSurfaceClearanceM
      + animalUnit(0, `${memberId}:depth`) * usableDepth;
    const position = addScaled(column.surface.position, column.surface.normal, -depth);
    const placed = definition.water.sample(position, time);
    if (placed.containsWater
      && placed.surfaceClearanceM + 1e-9 >= definition.minimumSurfaceClearanceM
      && placed.bottomClearanceM + 1e-9 >= definition.minimumBottomClearanceM
      && definition.water.isSegmentValid(
        origin,
        position,
        time,
        Math.max(0.5, definition.spreadRadiusM / 8),
      )) {
      return { position, surfaceUp: column.surface.normal };
    }
  }
  throw new Error('Animal water habitat has no valid placement within the bounded local search.');
}

function requireWaterSample(sample: AnimalWaterVolumeSample): AnimalWaterVolumeSample {
  if (!sample.containsWater || !sample.surface || !sample.bottom) {
    throw new Error('Animal water group origin must be inside a valid water volume.');
  }
  return sample;
}

function offsetPosition(sample: AnimalWorldSurfaceSample, u: number, v: number): AnimalVector3 {
  return {
    x: sample.position.x + sample.tangentU.x * u + sample.tangentV.x * v,
    y: sample.position.y + sample.tangentU.y * u + sample.tangentV.y * v,
    z: sample.position.z + sample.tangentU.z * u + sample.tangentV.z * v,
  };
}

function addScaled(origin: AnimalVector3, direction: AnimalVector3, scale: number): AnimalVector3 {
  return {
    x: origin.x + direction.x * scale,
    y: origin.y + direction.y * scale,
    z: origin.z + direction.z * scale,
  };
}

function validateDefinition(definition: AnimalLocalMaterializationDefinition): void {
  if (!Number.isFinite(definition.spreadRadiusM) || definition.spreadRadiusM < 0) {
    throw new RangeError('Animal local spread radius must be finite and non-negative.');
  }
  if (definition.maximumMembers !== undefined
    && (!Number.isSafeInteger(definition.maximumMembers) || definition.maximumMembers < 0)) {
    throw new RangeError('Animal maximum local members must be a non-negative safe integer.');
  }
  if (definition.domain === 'air') {
    if (!Number.isFinite(definition.minimumAltitudeM)
      || !Number.isFinite(definition.maximumAltitudeM)
      || definition.minimumAltitudeM < 0
      || definition.maximumAltitudeM < definition.minimumAltitudeM) {
      throw new RangeError('Animal air altitude range must be finite, non-negative, and ordered.');
    }
  }
  if (definition.domain === 'water') {
    if (!Number.isFinite(definition.minimumSurfaceClearanceM)
      || !Number.isFinite(definition.minimumBottomClearanceM)
      || definition.minimumSurfaceClearanceM < 0
      || definition.minimumBottomClearanceM < 0) {
      throw new RangeError('Animal water clearances must be finite and non-negative.');
    }
  }
}

interface Placement { readonly position: AnimalVector3; readonly surfaceUp: AnimalVector3; }
const placementScales = [1, 0.5, 0.25, 0] as const;
