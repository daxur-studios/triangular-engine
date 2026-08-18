import type { IGroundCoverArchetype } from './ground-cover-archetype';
import { validateGroundCoverArchetype } from './ground-cover-archetype';

function makeArchetype(overrides: Partial<IGroundCoverArchetype> = {}): IGroundCoverArchetype {
  return {
    schemaVersion: 1,
    id: 'grass-01',
    blade: { heightM: [0.2, 0.4], widthM: [0.02, 0.03], curveRad: [0.1, 0.4] },
    clump: { bladeCount: [5, 8], radiusM: [0.05, 0.1] },
    ...overrides,
  };
}

describe('validateGroundCoverArchetype', () => {
  it('accepts a well-formed archetype', () => {
    expect(() => validateGroundCoverArchetype(makeArchetype())).not.toThrow();
  });

  it('rejects a non-positive blade height', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ blade: { heightM: [0, 0.4], widthM: [0.02, 0.03], curveRad: [0.1, 0.4] } })),
    ).toThrow();
  });

  it('rejects a non-positive blade width', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ blade: { heightM: [0.2, 0.4], widthM: [0, 0.03], curveRad: [0.1, 0.4] } })),
    ).toThrow();
  });

  it('rejects curveRad outside [0, PI/2]', () => {
    expect(() =>
      validateGroundCoverArchetype(
        makeArchetype({ blade: { heightM: [0.2, 0.4], widthM: [0.02, 0.03], curveRad: [0.1, 2] } }),
      ),
    ).toThrow();
  });

  it('rejects non-integer bladeCount', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ clump: { bladeCount: [1.5, 8], radiusM: [0.05, 0.1] } })),
    ).toThrow();
  });

  it('rejects a negative clump radius', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ clump: { bladeCount: [5, 8], radiusM: [-0.1, 0.1] } })),
    ).toThrow();
  });

  it('accepts a well-formed head', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ head: { radiusM: [0.05, 0.08] } })),
    ).not.toThrow();
  });

  it('rejects a non-positive head radius', () => {
    expect(() =>
      validateGroundCoverArchetype(makeArchetype({ head: { radiusM: [0, 0.08] } })),
    ).toThrow();
  });
});
