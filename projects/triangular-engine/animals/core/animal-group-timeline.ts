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
  /**
   * Optional height of the analytical travel arc. Zero (the default) keeps
   * the legacy straight route. This is a broad group route, not a flight
   * simulation or terrain-avoidance result.
   */
  travelArcHeight?: number;
  memberCount: number;
  /** Universal time at which the group begins dwelling at destination zero. */
  epoch?: AnimalTime;
}

export interface AnimalGroupSnapshot {
  id: string;
  seed: number;
  time: AnimalTime;
  position: AnimalVector3;
  /** Analytical centre velocity at this exact universal time. */
  velocity: AnimalVector3;
  activity: AnimalGroupActivity;
  /** Normalized progress through the current dwell or travel activity. */
  activityProgress?: number;
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

/**
 * Smoothstep ease used for travel progress so a group glides away from a
 * destination and glides into the next one, instead of snapping from dwell
 * (zero velocity) to cruise velocity. This keeps velocity continuous across
 * every dwell/travel boundary, which is required for materialized offsets
 * that are themselves continuous functions of velocity.
 */
function easeProgress(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Derivative of easeProgress with respect to raw progress. */
function easeProgressRate(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 6 * clamped * (1 - clamped);
}

function travelPosition(
  a: AnimalVector3,
  b: AnimalVector3,
  progress: number,
  arcHeight: number,
): AnimalVector3 {
  const eased = easeProgress(progress);
  const position = lerp(a, b, eased);
  return { ...position, y: position.y + 4 * arcHeight * eased * (1 - eased) };
}

function travelVelocity(
  a: AnimalVector3,
  b: AnimalVector3,
  progress: number,
  duration: number,
  arcHeight: number,
): AnimalVector3 {
  if (!(duration > 0)) return { x: 0, y: 0, z: 0 };
  const eased = easeProgress(progress);
  const rate = easeProgressRate(progress) / duration;
  return {
    x: (b.x - a.x) * rate,
    y: ((b.y - a.y) + 4 * arcHeight * (1 - 2 * eased)) * rate,
    z: (b.z - a.z) * rate,
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
      const activityProgress =
        leg.destination.dwellDuration === 0
          ? 1
          : cycleTime / leg.destination.dwellDuration;
      return snapshot(
        timeline,
        time,
        leg.destination.position,
        { x: 0, y: 0, z: 0 },
        leg.destination.activity,
        activityProgress,
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
        travelPosition(
          leg.destination.position,
          leg.next.position,
          progress,
          timeline.travelArcHeight ?? 0,
        ),
        travelVelocity(
          leg.destination.position,
          leg.next.position,
          progress,
          leg.travelDuration,
          timeline.travelArcHeight ?? 0,
        ),
        'travel',
        progress,
        leg.next.id,
        progress,
        leg.next.id,
      );
    }
    cycleTime -= leg.travelDuration;
  }

  const first = timeline.destinations[0];
  return snapshot(timeline, time, first.position, { x: 0, y: 0, z: 0 }, first.activity, 0, first.id, 0);
}

function snapshot(
  timeline: AnimalGroupTimeline,
  time: AnimalTime,
  position: AnimalVector3,
  velocity: AnimalVector3,
  activity: AnimalGroupActivity,
  activityProgress: number,
  destinationId: string,
  progress: number,
  nextDestinationId?: string,
): AnimalGroupSnapshot {
  return {
    id: animalGroupId(timeline.key),
    seed: animalGroupSeed(timeline.key),
    time,
    position,
    velocity,
    activity,
    activityProgress,
    destinationId,
    nextDestinationId,
    progress,
    memberCount: Math.max(0, Math.floor(timeline.memberCount)),
  };
}
