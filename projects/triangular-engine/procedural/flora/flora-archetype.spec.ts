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

  it('accepts an archetype with frondPerches set and rejects a negative one', () => {
    const withFrondPerches = makeArchetype({
      sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false, frondPerches: 3 },
    });
    expect(() => validateFloraArchetype(withFrondPerches)).not.toThrow();

    const negative = makeArchetype({
      sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false, frondPerches: -1 },
    });
    expect(() => validateFloraArchetype(negative)).toThrowError(RangeError);
  });

  it('accepts a valid tiered-whorls conifer archetype', () => {
    const archetype = makeArchetype({
      branching: {
        distribution: 'tiered-whorls',
        maxDepth: 2,
        childrenPerNode: [2, 3],
        spreadAngleRad: [0.4, 0.7],
        lengthFalloff01: 0.5,
        tieredWhorls: {
          tierCount: [5, 7],
          startHeightFraction01: 0.22,
          branchesPerTier: [4, 6],
          droopRad: [0.1, 0.22],
          baseBranchLengthFraction: [0.38, 0.48],
        },
      },
      foliage: {
        style: 'conifer-tiered',
        sizeM: [0.6, 0.9],
        coniferTiered: {
          spireHeightM: [1.3, 1.8],
          spireRadiusM: [0.4, 0.6],
          boughWidthM: [0.6, 0.9],
        },
      },
    });
    expect(() => validateFloraArchetype(archetype)).not.toThrow();
  });

  it('rejects tiered-whorls distribution without tieredWhorls block', () => {
    const archetype = makeArchetype({
      branching: {
        distribution: 'tiered-whorls',
        maxDepth: 2,
        childrenPerNode: [2, 3],
        spreadAngleRad: [0.4, 0.7],
        lengthFalloff01: 0.5,
      },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });

  it('rejects non-positive tierCount in tieredWhorls', () => {
    const archetype = makeArchetype({
      branching: {
        distribution: 'tiered-whorls',
        maxDepth: 2,
        childrenPerNode: [2, 3],
        spreadAngleRad: [0.4, 0.7],
        lengthFalloff01: 0.5,
        tieredWhorls: {
          tierCount: [0, 5],
          startHeightFraction01: 0.22,
          branchesPerTier: [4, 6],
          droopRad: [0.1, 0.22],
          baseBranchLengthFraction: [0.38, 0.48],
        },
      },
    });
    expect(() => validateFloraArchetype(archetype)).toThrowError(RangeError);
  });
});
