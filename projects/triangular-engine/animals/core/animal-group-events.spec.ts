import { applyAnimalGroupEvents, AnimalGroupEvent } from './animal-group-events';
import { AnimalGroupSnapshot } from './animal-group-timeline';

describe('applyAnimalGroupEvents', () => {
  const baseline: AnimalGroupSnapshot = {
    id: 'group-a',
    seed: 17,
    time: 100,
    position: { x: 1, y: 2, z: 3 },
    activity: 'travel',
    destinationId: 'perch',
    progress: 0.5,
    memberCount: 12,
  };
  const loss: AnimalGroupEvent = {
    id: 'collision-1',
    type: 'member-loss',
    targetGroupId: 'group-a',
    effectiveTime: 100,
    memberCountLoss: 2,
  };

  it('has no effect before its time and persists at and after its time', () => {
    expect(
      applyAnimalGroupEvents({ ...baseline, time: 99 }, [loss]).memberCount,
    ).toBe(12);
    expect(applyAnimalGroupEvents(baseline, [loss]).memberCount).toBe(10);
    expect(
      applyAnimalGroupEvents({ ...baseline, time: 1_000_000 }, [loss])
        .memberCount,
    ).toBe(10);
  });

  it('restores the pre-event result when queried before the event', () => {
    const after = applyAnimalGroupEvents(
      { ...baseline, time: 150 },
      [loss],
    );
    const rewound = applyAnimalGroupEvents(
      { ...baseline, time: 50 },
      [loss],
    );

    expect(after.memberCount).toBe(10);
    expect(rewound.memberCount).toBe(12);
  });

  it('does not affect unrelated groups or depend on event input order', () => {
    const secondLoss: AnimalGroupEvent = {
      ...loss,
      id: 'collision-2',
      effectiveTime: 90,
      memberCountLoss: 3,
    };
    const unrelated: AnimalGroupEvent = {
      ...loss,
      id: 'other-group-event',
      targetGroupId: 'group-b',
      memberCountLoss: 11,
    };

    expect(applyAnimalGroupEvents(baseline, [unrelated]).memberCount).toBe(12);
    expect(applyAnimalGroupEvents(baseline, [loss, secondLoss])).toEqual(
      applyAnimalGroupEvents(baseline, [secondLoss, loss]),
    );
    expect(
      applyAnimalGroupEvents(baseline, [loss, secondLoss]).memberCount,
    ).toBe(7);
  });

  it('does not mutate the baseline or event history and clamps at zero', () => {
    const originalBaseline = structuredClone(baseline);
    const events: AnimalGroupEvent[] = [
      { ...loss, memberCountLoss: 100 },
    ];
    const originalEvents = structuredClone(events);

    expect(applyAnimalGroupEvents(baseline, events).memberCount).toBe(0);
    expect(baseline).toEqual(originalBaseline);
    expect(events).toEqual(originalEvents);
  });

  it('rejects ambiguous duplicate IDs and invalid event data', () => {
    expect(() => applyAnimalGroupEvents(baseline, [loss, { ...loss }])).toThrowError(
      /unique/,
    );
    expect(() =>
      applyAnimalGroupEvents(baseline, [
        { ...loss, memberCountLoss: -1 },
      ]),
    ).toThrowError(/non-negative/);
  });
});
