import type { AnimalTime, AnimalVector3 } from './animal-types';
import type { AnimalWaterVolume } from './animal-water-volume';
import type { AnimalWorldSurface } from './animal-world-surface';

export type AnimalInteractionTopology =
  | { readonly kind: 'surface'; readonly surface: AnimalWorldSurface }
  | { readonly kind: 'water'; readonly water: AnimalWaterVolume; readonly time: AnimalTime };

export interface AnimalInteractionDisturbance {
  readonly id: string;
  readonly position: AnimalVector3;
  readonly velocity: AnimalVector3;
  readonly radiusM: number;
  readonly strength01: number;
}

export interface AnimalMaterializedGroupTarget {
  readonly groupId: string;
  readonly position: AnimalVector3;
}

export interface AnimalDisturbanceHit {
  readonly groupId: string;
  readonly disturbanceId: string;
  readonly position: AnimalVector3;
  readonly velocity: AnimalVector3;
  readonly distanceM: number;
  readonly influence01: number;
}

export interface ResolveAnimalDisturbancesInput {
  readonly topology: AnimalInteractionTopology;
  readonly groups: readonly AnimalMaterializedGroupTarget[];
  readonly disturbances: readonly AnimalInteractionDisturbance[];
  readonly maximumGroups: number;
  readonly maximumDisturbances: number;
  readonly maximumHitsPerGroup: number;
}

/**
 * Resolves bounded local influences without embedding a plane/sphere/cylinder
 * assumption. Species policies decide how to react to the returned hits.
 */
export function resolveAnimalDisturbances(
  input: ResolveAnimalDisturbancesInput,
): readonly AnimalDisturbanceHit[] {
  validateLimit(input.maximumGroups, 'Animal disturbance group bound');
  validateLimit(input.maximumDisturbances, 'Animal disturbance disturbance bound');
  validateLimit(input.maximumHitsPerGroup, 'Animal disturbance hit bound');
  if (input.groups.length > input.maximumGroups) {
    throw new RangeError('Animal disturbance group count exceeds its configured bound.');
  }
  if (input.disturbances.length > input.maximumDisturbances) {
    throw new RangeError('Animal disturbance count exceeds its configured bound.');
  }
  if (input.topology.kind === 'water' && !Number.isFinite(input.topology.time)) {
    throw new RangeError('Animal disturbance water time must be finite.');
  }

  const groups = [...input.groups].sort((a, b) => a.groupId.localeCompare(b.groupId));
  const disturbances = [...input.disturbances].sort((a, b) => a.id.localeCompare(b.id));
  validateGroups(groups);
  validateDisturbances(disturbances);

  const hits: AnimalDisturbanceHit[] = [];
  for (const group of groups) {
    const groupHits: AnimalDisturbanceHit[] = [];
    for (const disturbance of disturbances) {
      const distanceM = topologyDistance(input.topology, group.position, disturbance.position);
      if (distanceM === undefined || distanceM >= disturbance.radiusM) continue;
      groupHits.push({
        groupId: group.groupId,
        disturbanceId: disturbance.id,
        position: { ...disturbance.position },
        velocity: { ...disturbance.velocity },
        distanceM,
        influence01: disturbance.strength01 * (1 - distanceM / disturbance.radiusM),
      });
    }
    groupHits.sort((a, b) =>
      b.influence01 - a.influence01
      || a.distanceM - b.distanceM
      || a.disturbanceId.localeCompare(b.disturbanceId));
    hits.push(...groupHits.slice(0, input.maximumHitsPerGroup));
  }
  return hits;
}

function topologyDistance(
  topology: AnimalInteractionTopology,
  from: AnimalVector3,
  to: AnimalVector3,
): number | undefined {
  if (topology.kind === 'surface') {
    const fromSample = topology.surface.sample(from);
    const toSample = topology.surface.sample(to);
    const fromHeight = dot(subtract(from, fromSample.position), fromSample.surfaceUp);
    const toHeight = dot(subtract(to, toSample.position), toSample.surfaceUp);
    return Math.hypot(topology.surface.surfaceDistance(from, to), toHeight - fromHeight);
  }

  const fromSample = topology.water.sample(from, topology.time);
  const toSample = topology.water.sample(to, topology.time);
  if (!fromSample.surface || !toSample.surface
    || fromSample.surface.bodyId !== toSample.surface.bodyId
    || fromSample.signedSurfaceDistanceM === undefined
    || toSample.signedSurfaceDistanceM === undefined) return undefined;
  return Math.hypot(
    topology.water.surfaceDistance(from, to),
    toSample.signedSurfaceDistanceM - fromSample.signedSurfaceDistanceM,
  );
}

function validateGroups(groups: readonly AnimalMaterializedGroupTarget[]): void {
  let previousId: string | undefined;
  for (const group of groups) {
    validateId(group.groupId, 'Animal disturbance group');
    validateVector(group.position, 'Animal disturbance group position');
    if (group.groupId === previousId) throw new Error(`Animal disturbance group IDs must be unique: ${group.groupId}`);
    previousId = group.groupId;
  }
}

function validateDisturbances(disturbances: readonly AnimalInteractionDisturbance[]): void {
  let previousId: string | undefined;
  for (const disturbance of disturbances) {
    validateId(disturbance.id, 'Animal disturbance');
    validateVector(disturbance.position, 'Animal disturbance position');
    validateVector(disturbance.velocity, 'Animal disturbance velocity');
    if (!Number.isFinite(disturbance.radiusM) || disturbance.radiusM <= 0) {
      throw new RangeError('Animal disturbance radius must be positive and finite.');
    }
    if (!Number.isFinite(disturbance.strength01)
      || disturbance.strength01 < 0 || disturbance.strength01 > 1) {
      throw new RangeError('Animal disturbance strength must be between zero and one.');
    }
    if (disturbance.id === previousId) throw new Error(`Animal disturbance IDs must be unique: ${disturbance.id}`);
    previousId = disturbance.id;
  }
}

function validateLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
}

function validateId(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} ID must not be empty.`);
}

function validateVector(value: AnimalVector3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError(`${label} must be finite.`);
}

function subtract(a: AnimalVector3, b: AnimalVector3): AnimalVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: AnimalVector3, b: AnimalVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
