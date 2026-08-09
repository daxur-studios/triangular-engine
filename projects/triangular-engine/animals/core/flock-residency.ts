import { FlockDefinition } from './flock-definition';
import { AnimalObserver, AnimalVector3 } from './animal-types';

export interface FlockResidency {
  readonly visible: boolean;
  readonly distance: number;
  readonly enterDistance: number;
  readonly exitDistance: number;
}

const distance = (a: AnimalVector3, b: AnimalVector3) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

/** Deterministically decides whether a flock should have active presentation. */
export function updateFlockResidency(
  definition: FlockDefinition,
  observer: AnimalObserver,
  previousVisible = false,
): FlockResidency {
  const rawDistance = distance(definition.origin, observer.position);
  const effectiveDistance = Math.max(0, rawDistance - Math.max(0, observer.radius));
  const enterDistance = Math.max(0, definition.cullDistance);
  const exitDistance = enterDistance + Math.max(0, definition.hysteresis);
  return {
    visible: effectiveDistance <= (previousVisible ? exitDistance : enterDistance),
    distance: effectiveDistance,
    enterDistance,
    exitDistance,
  };
}
