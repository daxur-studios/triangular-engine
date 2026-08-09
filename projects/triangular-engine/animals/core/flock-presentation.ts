import { AnimalPresentation, FlockState } from './animal-types';

export function presentFlock(flock: readonly FlockState[]): readonly AnimalPresentation[] {
  return flock.map(({ id, position, velocity, activity }) => ({ id, position: { ...position }, heading: { ...velocity }, activity }));
}
