import { animalUnit } from './animal-hash';
import { FlockDefinition } from './flock-definition';
import { AnimalObserver, FlockState } from './animal-types';
import { updateFlockResidency } from './flock-residency';

export function materializeFlock(definition: FlockDefinition, observer: AnimalObserver, previousVisible = false): FlockState[] {
  if (!updateFlockResidency(definition, observer, previousVisible).visible) return [];
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
