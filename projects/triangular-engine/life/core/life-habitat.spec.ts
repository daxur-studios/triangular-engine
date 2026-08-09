import { canTraverseLifeSegment, type LifeHabitatQuery } from './life-habitat';

describe('life habitat traversal', () => {
  it('rejects a segment that crosses an invalid sample', () => {
    const query: LifeHabitatQuery = {
      sampleHabitat: ({ x }) => ({
        kind: x > 4 && x < 6 ? 'water' : 'land',
        surfaceY: 0,
        suitability01: x > 4 && x < 6 ? 0 : 1,
      }),
    };

    expect(canTraverseLifeSegment(query, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, ['land'])).toBeFalse();
  });

  it('accepts a segment when every sample is suitable', () => {
    const query: LifeHabitatQuery = {
      sampleHabitat: () => ({ kind: 'land', surfaceY: 0, suitability01: 1 }),
    };

    expect(canTraverseLifeSegment(query, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, ['land'])).toBeTrue();
  });
});
