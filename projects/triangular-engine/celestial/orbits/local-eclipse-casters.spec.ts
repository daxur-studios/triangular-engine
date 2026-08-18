import { ICelestialBody } from '../bodies/celestial-body';
import { selectLocalEclipseCasters } from './local-eclipse-casters';

const bodies: readonly ICelestialBody[] = [
  { id: 'sun', kind: 'star', radiusM: 100, muM3PerS2: 1 },
  {
    id: 'earth',
    kind: 'planet',
    radiusM: 10,
    muM3PerS2: 1,
    parentBodyId: 'sun',
  },
  { id: 'moon', kind: 'moon', radiusM: 3, muM3PerS2: 1, parentBodyId: 'earth' },
  {
    id: 'far-moon',
    kind: 'moon',
    radiusM: 2,
    muM3PerS2: 1,
    parentBodyId: 'earth',
  },
  {
    id: 'jupiter',
    kind: 'planet',
    radiusM: 50,
    muM3PerS2: 1,
    parentBodyId: 'sun',
  },
];

const positions = new Map([
  ['sun', [0, 0, 0] as const],
  ['earth', [1_000, 0, 0] as const],
  ['moon', [1_020, 0, 0] as const],
  ['far-moon', [1_040, 0, 0] as const],
  ['jupiter', [10_000, 0, 0] as const],
]);

describe('selectLocalEclipseCasters', () => {
  it('selects a planet children, but excludes unrelated planets', () => {
    const result = selectLocalEclipseCasters(bodies[1], bodies, positions);
    expect(result.occluders.map((body) => body.bodyId)).toEqual([
      'moon',
      'far-moon',
    ]);
  });

  it('selects a moon parent and siblings', () => {
    const result = selectLocalEclipseCasters(bodies[2], bodies, positions);
    expect(result.occluders.map((body) => body.bodyId)).toEqual([
      'earth',
      'far-moon',
    ]);
  });
});
