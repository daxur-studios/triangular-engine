import { sampleLifeCohortAtTime, sampleLifeLifecycleAtTime } from './life-lifecycle';

describe('life lifecycle', () => {
  it('reconstructs birth, growth, adulthood, and death from UT', () => {
    const definition = { birthTimeSeconds: 10, juvenileDurationSeconds: 5, lifespanSeconds: 20 };
    expect(sampleLifeLifecycleAtTime(definition, 9).phase).toBe('not-born');
    expect(sampleLifeLifecycleAtTime(definition, 12).growth01).toBeCloseTo(0.4);
    expect(sampleLifeLifecycleAtTime(definition, 16).phase).toBe('adult');
    expect(sampleLifeLifecycleAtTime(definition, 30).phase).toBe('dead');
  });

  it('aggregates staggered births and deaths deterministically', () => {
    const definition = {
      seed: 8,
      count: 20,
      birthTimeSeconds: 0,
      birthSpreadSeconds: 10,
      juvenileDurationSeconds: 5,
      lifespanSeconds: 30,
    };
    const first = sampleLifeCohortAtTime(definition, 7);
    sampleLifeCohortAtTime(definition, 100);
    expect(sampleLifeCohortAtTime(definition, 7)).toEqual(first);
    expect(first.total).toBe(20);
    expect(first.juvenile + first.adult + first.notBorn + first.dead).toBe(20);
  });
});
