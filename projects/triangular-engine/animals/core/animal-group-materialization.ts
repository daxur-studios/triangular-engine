import { AnimalGroupSnapshot } from './animal-group-timeline';
import { FlockDefinition } from './flock-definition';
import { materializeFlock } from './flock-materialization';
import { AnimalObserver, FlockState } from './animal-types';

export type AnimalGroupMaterialization = Omit<
  FlockDefinition,
  'id' | 'seed' | 'origin' | 'count'
>;

/**
 * Converts an arbitrary-time aggregate snapshot into deterministic nearby
 * flock members. Member identity and offsets come from the stable group, not
 * from query order or renderer-relative state.
 */
export function materializeAnimalGroup(
  snapshot: AnimalGroupSnapshot,
  observer: AnimalObserver,
  definition: AnimalGroupMaterialization,
  previousVisible = false,
): FlockState[] {
  return materializeFlock(
    {
      ...definition,
      id: snapshot.id,
      seed: snapshot.seed,
      origin: snapshot.position,
      count: snapshot.memberCount,
      speed: snapshot.activity === 'travel' ? definition.speed : 0,
    },
    observer,
    previousVisible,
  );
}
