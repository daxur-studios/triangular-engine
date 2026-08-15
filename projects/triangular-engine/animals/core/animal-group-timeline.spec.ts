import {
  AnimalGroupTimeline,
  animalGroupId,
  sampleAnimalGroupTimeline,
} from './animal-group-timeline';

describe('sampleAnimalGroupTimeline', () => {
  const timeline: AnimalGroupTimeline = {
    key: {
      worldId: 'world',
      planetId: 'planet',
      cellId: 'cell-7',
      speciesId: 'birds',
      groupId: 'flock-2',
      seed: 41,
    },
    destinations: [
      {
        id: 'feeding-area',
        position: { x: 0, y: 4, z: 0 },
        activity: 'feed',
        dwellDuration: 10,
      },
      {
        id: 'tree-perch',
        position: { x: 30, y: 10, z: 0 },
        activity: 'rest',
        dwellDuration: 20,
      },
    ],
    travelSpeed: Math.sqrt(30 * 30 + 6 * 6) / 10,
    memberCount: 12,
    epoch: 100,
  };

  it('uses an unambiguous stable identity independent of position', () => {
    expect(animalGroupId(timeline.key)).toBe(
      '5:world|6:planet|6:cell-7|5:birds|7:flock-2',
    );
    expect(
      animalGroupId({ ...timeline.key, cellId: 'cell', groupId: '7flock-2' }),
    ).not.toBe(animalGroupId(timeline.key));
  });

  it('samples dwell and travel directly at universal time', () => {
    expect(sampleAnimalGroupTimeline(timeline, 105)).toEqual(
      jasmine.objectContaining({
        activity: 'feed',
        destinationId: 'feeding-area',
        progress: 0,
        position: { x: 0, y: 4, z: 0 },
        memberCount: 12,
      }),
    );
    expect(sampleAnimalGroupTimeline(timeline, 115)).toEqual(
      jasmine.objectContaining({
        activity: 'travel',
        destinationId: 'tree-perch',
        nextDestinationId: 'tree-perch',
        progress: 0.5,
        position: { x: 15, y: 7, z: 0 },
      }),
    );
    expect(sampleAnimalGroupTimeline(timeline, 125)).toEqual(
      jasmine.objectContaining({
        activity: 'rest',
        destinationId: 'tree-perch',
        progress: 0,
        position: { x: 30, y: 10, z: 0 },
      }),
    );
  });

  it('is deterministic across query order and very large time jumps', () => {
    const distantTime = 100 + 50 * 10_000_000 + 15;
    const expected = sampleAnimalGroupTimeline(timeline, 115);
    sampleAnimalGroupTimeline(timeline, -5000);
    expect(sampleAnimalGroupTimeline(timeline, distantTime)).toEqual({
      ...expected,
      time: distantTime,
    });
    expect(sampleAnimalGroupTimeline(timeline, 115)).toEqual(expected);
  });

  it('rejects invalid timelines instead of producing corrupt state', () => {
    expect(() =>
      sampleAnimalGroupTimeline({ ...timeline, destinations: [] }, 0),
    ).toThrowError();
    expect(() =>
      sampleAnimalGroupTimeline({ ...timeline, travelSpeed: 0 }, 0),
    ).toThrowError();
    expect(() =>
      sampleAnimalGroupTimeline(timeline, Number.POSITIVE_INFINITY),
    ).toThrowError();
  });
});
