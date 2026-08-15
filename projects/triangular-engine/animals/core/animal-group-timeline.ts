import { animalHash } from './animal-hash';
import { AnimalTime, AnimalVector3 } from './animal-types';

export interface AnimalGroupKey {
  worldId: string;
  planetId: string;
  cellId: string;
  speciesId: string;
  groupId: string;
  seed: number;
}

export type AnimalGroupActivity = 'rest' | 'feed' | 'travel';

export interface AnimalGroupDestination {
  id: string;
  position: AnimalVector3;
  activity: Exclude<AnimalGroupActivity, 'travel'>;
  dwellDuration: number;
}

export interface AnimalGroupTimeline {
  key: AnimalGroupKey;
  destinations: readonly AnimalGroupDestination[];
  travelSpeed: number;
  memberCount: number;
  /** Universal time at which the group begins dwelling at destination zero. */
  epoch?: AnimalTime;
}

export interface AnimalGroupSnapshot {
  id: string;
  seed: number;
  time: AnimalTime;
  position: AnimalVector3;
  activity: AnimalGroupActivity;
  destinationId: string;
  nextDestinationId?: string;
  progress: number;
  memberCount: number;
}

function encodePart(value: string): string {
  return `${value.length}:${value}`;
}

/** Stable identity that is independent of renderer-relative coordinates. */
export function animalGroupId(key: AnimalGroupKey): string {
  return [key.worldId, key.planetId, key.cellId, key.speciesId, key.groupId]
    .map(encodePart)
    .join('|');
}

export function animalGroupSeed(key: AnimalGroupKey): number {
  return animalHash(key.seed, animalGroupId(key));
}

function distance(a: AnimalVector3, b: AnimalVector3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function lerp(
  a: AnimalVector3,
  b: AnimalVector3,
  progress: number,
): AnimalVector3 {
  return {
    x: a.x + (b.x - a.x) * progress,
    y: a.y + (b.y - a.y) * progress,
    z: a.z + (b.z - a.z) * progress,
  };
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Samples a repeating authored destination cycle directly at universal time.
 * Runtime work depends only on destination count, never on elapsed ticks.
 */
export function sampleAnimalGroupTimeline(
  timeline: AnimalGroupTimeline,
  time: AnimalTime,
): AnimalGroupSnapshot {
  if (!Number.isFinite(time))
    throw new Error('Animal group time must be finite.');
  if (!(timeline.travelSpeed > 0))
    throw new Error('Animal group travelSpeed must be greater than zero.');
  if (timeline.destinations.length === 0)
    throw new Error('Animal group timeline requires at least one destination.');
  if (
    timeline.destinations.some((destination) => destination.dwellDuration < 0)
  ) {
    throw new Error('Animal group dwellDuration cannot be negative.');
  }

  const legs = timeline.destinations.map((destination, index) => {
    const next =
      timeline.destinations[(index + 1) % timeline.destinations.length];
    return {
      destination,
      next,
      travelDuration:
        distance(destination.position, next.position) / timeline.travelSpeed,
    };
  });
  const cycleDuration = legs.reduce(
    (total, leg) => total + leg.destination.dwellDuration + leg.travelDuration,
    0,
  );
  if (!(cycleDuration > 0) || !Number.isFinite(cycleDuration)) {
    throw new Error(
      'Animal group timeline must have a finite, non-zero cycle duration.',
    );
  }

  let cycleTime = positiveModulo(time - (timeline.epoch ?? 0), cycleDuration);
  for (const leg of legs) {
    if (cycleTime < leg.destination.dwellDuration) {
      return snapshot(
        timeline,
        time,
        leg.destination.position,
        leg.destination.activity,
        leg.destination.id,
        0,
      );
    }
    cycleTime -= leg.destination.dwellDuration;
    if (cycleTime < leg.travelDuration) {
      const progress =
        leg.travelDuration === 0 ? 1 : cycleTime / leg.travelDuration;
      return snapshot(
        timeline,
        time,
        lerp(leg.destination.position, leg.next.position, progress),
        'travel',
        leg.next.id,
        progress,
        leg.next.id,
      );
    }
    cycleTime -= leg.travelDuration;
  }

  const first = timeline.destinations[0];
  return snapshot(timeline, time, first.position, first.activity, first.id, 0);
}

function snapshot(
  timeline: AnimalGroupTimeline,
  time: AnimalTime,
  position: AnimalVector3,
  activity: AnimalGroupActivity,
  destinationId: string,
  progress: number,
  nextDestinationId?: string,
): AnimalGroupSnapshot {
  return {
    id: animalGroupId(timeline.key),
    seed: animalGroupSeed(timeline.key),
    time,
    position,
    activity,
    destinationId,
    nextDestinationId,
    progress,
    memberCount: Math.max(0, Math.floor(timeline.memberCount)),
  };
}
