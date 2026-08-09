import { AnimalPresentation, FlockState } from './animal-types';

function snapshot(animal: FlockState, position = animal.position, velocity = animal.velocity, bank = 0): AnimalPresentation {
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const heading = speed > 1e-8
    ? { x: velocity.x / speed, y: velocity.y / speed, z: velocity.z / speed }
    : { x: 0, y: 0, z: 1 };
  return { id: animal.id, position: { ...position }, heading, speed, activity: animal.activity, bank };
}

export function presentFlock(flock: readonly FlockState[]): readonly AnimalPresentation[] {
  return flock.map((animal) => snapshot(animal));
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
    return snapshot(animal, position, heading, Math.max(-0.55, Math.min(0.55, -angularDelta * 3)));
  });
}
