import { handoffAnimalGroupResidency } from './animal-group-residency';
import {
  AnimalGroupTimeline,
  sampleAnimalGroupTimeline,
} from './animal-group-timeline';

describe('handoffAnimalGroupResidency', () => {
  const timeline: AnimalGroupTimeline = {
    key: {
      worldId: 'world',
      planetId: 'planet',
      cellId: 'cell',
      speciesId: 'birds',
      groupId: 'flock',
      seed: 9,
    },
    destinations: [
      {
        id: 'feeding-area',
        position: { x: 0, y: 5, z: 0 },
        activity: 'feed',
        dwellDuration: 10,
      },
      {
        id: 'perch',
        position: { x: 20, y: 5, z: 0 },
        activity: 'rest',
        dwellDuration: 10,
      },
    ],
    travelSpeed: 2,
    memberCount: 3,
  };
  const materialization = {
    spacing: 2,
    speed: 3,
    cullDistance: 10,
    hysteresis: 3,
    travelDirection: { x: 1, y: 0, z: 0 },
  };
  const snapshot = sampleAnimalGroupTimeline(timeline, 5);
  const observer = (x: number) => ({ position: { x, y: 5, z: 0 }, radius: 0 });

  it('hands off between aggregate and nearby materialized state with hysteresis', () => {
    const far = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(20),
      materialization,
    });
    const near = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(0),
      materialization,
    });
    const hysteresis = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(12),
      materialization,
      previousMode: near.mode,
    });

    expect(far.mode).toBe('aggregate');
    expect(far.members).toEqual([]);
    expect(near.mode).toBe('materialized');
    expect(near.members.length).toBe(3);
    expect(hysteresis.mode).toBe('materialized');
  });

  it('retains individual members for interactions or explicit tracking', () => {
    const interacting = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(1000),
      materialization,
      interacting: true,
    });
    const tracked = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(1000),
      materialization,
      tracked: true,
    });

    expect(interacting.mode).toBe('interacting');
    expect(interacting.members.length).toBe(3);
    expect(tracked.mode).toBe('tracked');
    expect(tracked.members).toEqual(interacting.members);
  });

  it('unloads members and deterministically recreates them at the same time', () => {
    const request = { snapshot, observer: observer(0), materialization };
    const first = handoffAnimalGroupResidency(request);
    const unloaded = handoffAnimalGroupResidency({
      ...request,
      observer: observer(100),
      previousMode: first.mode,
    });
    const reloaded = handoffAnimalGroupResidency({
      ...request,
      snapshot: sampleAnimalGroupTimeline(timeline, snapshot.time),
      previousMode: unloaded.mode,
    });

    expect(unloaded.mode).toBe('aggregate');
    expect(unloaded.members).toEqual([]);
    expect(reloaded.mode).toBe('materialized');
    expect(reloaded.members).toEqual(first.members);
  });

  it('returns to aggregate state after retention ends while still out of range', () => {
    const retained = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(100),
      materialization,
      interacting: true,
    });
    const released = handoffAnimalGroupResidency({
      snapshot,
      observer: observer(100),
      materialization,
      previousMode: retained.mode,
    });

    expect(released.mode).toBe('aggregate');
    expect(released.members).toEqual([]);
  });
});
