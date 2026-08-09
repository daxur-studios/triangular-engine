import { animalUnit } from './animal-hash';
import { FlockDefinition } from './flock-definition';
import { AnimalObserver, FlockState } from './animal-types';

const distanceSquared = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

export function materializeFlock(definition: FlockDefinition, observer: AnimalObserver, previousVisible = false): FlockState[] {
  const limit = definition.cullDistance + (previousVisible ? definition.hysteresis : 0);
  if (distanceSquared(definition.origin, observer.position) > limit * limit) return [];
  return Array.from({ length: Math.max(0, Math.floor(definition.count)) }, (_, index) => {
    const angle = animalUnit(definition.seed, index) * Math.PI * 2;
    const radius = Math.sqrt(animalUnit(definition.seed + 1, index)) * definition.spacing;
    return {
      id: `${definition.id}:${index}`,
      position: { x: definition.origin.x + Math.cos(angle) * radius, y: definition.origin.y, z: definition.origin.z + Math.sin(angle) * radius },
      velocity: { x: 0, y: 0, z: definition.speed },
      activity: 'travel' as const,
      visible: true,
    };
  });
}
