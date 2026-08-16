import type { IFloraArchetype } from './flora-archetype';
import { validateFloraArchetype } from './flora-archetype';

function makeArchetype(overrides: Partial<IFloraArchetype> = {}): IFloraArchetype {
  return {
    schemaVersion: 1,
    id: 'test-species',
    kind: 'tree',
    trunk: { heightM: [4, 6], radiusM: [0.3, 0.5], taper01: 0.4 },
    branching: {
      maxDepth: 2,
      childrenPerNode: [2, 3],
      spreadAngleRad: [0.4, 0.9],
      lengthFalloff01: 0.65,
    },
    foliage: { style: 'cluster-sphere', sizeM: [0.8, 1.4] },
    sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    collider: { trunk: 'capsule' },
    ...overrides,
  };
}

describe('validateFloraArchetype', () => {
  it('accepts a valid cluster-style archetype', () => {
    expect(() => validateFloraArchetype(makeArchetype())).not.toThrow();
  });

  it('accepts a valid radial-fronds archetype', () => {
    const archetype = makeArchetype({
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.3, 0.4],
        radialFronds: { frondCount: 7, frondLengthM: [1.8, 2.4], frondDroopRad: 0.45 },
      },
    });
    expect(() => validateFloraArchetype(archetype)).not.toThrow();
  });

  it('rejects radial-fronds style with no radialFronds block', () => {
    const archetype = makeArchetype({
      foliage: { style: 'radial-fronds', sizeM: [0.3, 0.4] },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });

  it('rejects a non-positive-integer frondCount', () => {
    const archetype = makeArchetype({
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.3, 0.4],
        radialFronds: { frondCount: 0, frondLengthM: [1.8, 2.4], frondDroopRad: 0.45 },
      },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });

  it('rejects an invalid frondLengthM range', () => {
    const archetype = makeArchetype({
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.3, 0.4],
        radialFronds: { frondCount: 6, frondLengthM: [2.4, 1.8], frondDroopRad: 0.45 },
      },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });

  it('rejects a frondDroopRad outside [0, PI/2]', () => {
    const archetype = makeArchetype({
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.3, 0.4],
        radialFronds: { frondCount: 6, frondLengthM: [1.8, 2.4], frondDroopRad: Math.PI },
      },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });
});
