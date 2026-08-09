import { chooseLifeActivityTarget, type LifeActivityTarget } from './life-activity';

describe('chooseLifeActivityTarget', () => {
  const targets: readonly LifeActivityTarget[] = [
    { id: 'meadow-a', activity: 'graze', position: { x: 0, y: 0, z: 0 }, suitability01: 0.7 },
    { id: 'meadow-b', activity: 'graze', position: { x: 10, y: 0, z: 0 }, suitability01: 0.9 },
    { id: 'pond', activity: 'drink', position: { x: 20, y: 0, z: 0 }, suitability01: 0.8 },
  ];

  it('chooses the best suitable resource deterministically', () => {
    const first = chooseLifeActivityTarget(targets, { seed: 4, universalTimeSeconds: 10 });
    chooseLifeActivityTarget(targets, { seed: 4, universalTimeSeconds: 9999 });
    expect(chooseLifeActivityTarget(targets, { seed: 4, universalTimeSeconds: 10 })).toEqual(first);
    expect(first?.id).toBe('meadow-b');
  });

  it('returns null when the season/resource filter rejects all targets', () => {
    expect(chooseLifeActivityTarget(targets, {
      seed: 4,
      universalTimeSeconds: 10,
      minimumSuitability01: 1,
    })).toBeNull();
  });
});
