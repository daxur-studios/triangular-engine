import { AnimalPresentation, FlockState } from './animal-types';

export function presentFlock(flock: readonly FlockState[]): readonly AnimalPresentation[] {
  return flock.map(({ id, position, velocity, activity }) => ({ id, position: { ...position }, heading: { ...velocity }, activity, bank: 0 }));
}

/**
 * Creates renderer snapshots between two fixed simulation states. This never
 * feeds back into the simulation, so changing render frame rate cannot change
 * deterministic flock motion.
 */
export function presentInterpolatedFlock(
  previous: readonly FlockState[],
  current: readonly FlockState[],
  alpha: number,
): readonly AnimalPresentation[] {
  const clampedAlpha = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 0));
  const previousById = new Map(previous.map((animal) => [animal.id, animal]));
  return current.map((animal) => {
    const before = previousById.get(animal.id) ?? animal;
    const position = {
      x: before.position.x + (animal.position.x - before.position.x) * clampedAlpha,
      y: before.position.y + (animal.position.y - before.position.y) * clampedAlpha,
      z: before.position.z + (animal.position.z - before.position.z) * clampedAlpha,
    };
    const heading = {
      x: before.velocity.x + (animal.velocity.x - before.velocity.x) * clampedAlpha,
      y: before.velocity.y + (animal.velocity.y - before.velocity.y) * clampedAlpha,
      z: before.velocity.z + (animal.velocity.z - before.velocity.z) * clampedAlpha,
    };
    const beforeAngle = Math.atan2(before.velocity.x, before.velocity.z);
    const currentAngle = Math.atan2(animal.velocity.x, animal.velocity.z);
    const angularDelta = Math.atan2(Math.sin(currentAngle - beforeAngle), Math.cos(currentAngle - beforeAngle));
    return { id: animal.id, position, heading, activity: animal.activity, bank: Math.max(-0.55, Math.min(0.55, -angularDelta * 3)) };
  });
}
