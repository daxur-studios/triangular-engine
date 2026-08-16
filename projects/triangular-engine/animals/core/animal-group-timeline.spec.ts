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

  it('reports direct progress through dwell activities', () => {
    expect(sampleAnimalGroupTimeline(timeline, 100).activityProgress).toBe(0);
    expect(sampleAnimalGroupTimeline(timeline, 105).activityProgress).toBe(0.5);
    expect(sampleAnimalGroupTimeline(timeline, 125).activityProgress).toBe(0.25);
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

  it('samples an optional 3D travel arc and its tangent without ticking', () => {
    const arced = { ...timeline, travelArcHeight: 8 };
    const midpoint = sampleAnimalGroupTimeline(arced, 115);

    // Progress is eased (smoothstep), so the midpoint still lands exactly
    // halfway, but velocity there is faster than the naive distance/duration
    // rate since the group must cover the same distance while gliding away
    // from zero speed at both ends of the leg.
    expect(midpoint.position).toEqual({ x: 15, y: 15, z: 0 });
    expect(midpoint.velocity.x).toBeCloseTo(4.5);
    expect(midpoint.velocity.y).toBeCloseTo(0.9);
    expect(midpoint.velocity.z).toBeCloseTo(0);
    expect(sampleAnimalGroupTimeline(arced, 115)).toEqual(midpoint);
  });

  it('keeps velocity continuous (zero) across every dwell/travel boundary', () => {
    const arced = { ...timeline, travelArcHeight: 8 };
    // cycleTime 20 is the exact instant the group arrives at tree-perch and
    // switches from 'travel' to 'rest'; cycleTime 40 is the exact instant it
    // departs again. Velocity must not pop from cruise speed to zero (or
    // back) at these instants, or materialized members would visibly snap.
    const arrivalApproach = sampleAnimalGroupTimeline(arced, 100 + 20 - 1e-6);
    const arrivalDwell = sampleAnimalGroupTimeline(arced, 100 + 20);
    const departureDwell = sampleAnimalGroupTimeline(arced, 100 + 40 - 1e-6);
    const departureTravel = sampleAnimalGroupTimeline(arced, 100 + 40);

    for (const speed of [
      Math.hypot(arrivalApproach.velocity.x, arrivalApproach.velocity.y, arrivalApproach.velocity.z),
      Math.hypot(arrivalDwell.velocity.x, arrivalDwell.velocity.y, arrivalDwell.velocity.z),
      Math.hypot(departureDwell.velocity.x, departureDwell.velocity.y, departureDwell.velocity.z),
      Math.hypot(departureTravel.velocity.x, departureTravel.velocity.y, departureTravel.velocity.z),
    ]) {
      expect(speed).toBeCloseTo(0, 3);
    }
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
