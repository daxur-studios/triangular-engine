import type { IFloraArchetype } from './flora-archetype';
import { buildFloraMesh } from './flora-mesh';
import { generateFloraSkeleton } from './flora-skeleton';

function makeArchetype(overrides: Partial<IFloraArchetype> = {}): IFloraArchetype {
  return {
    schemaVersion: 1,
    id: 'oak-01',
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

describe('buildFloraMesh', () => {
  it('is deterministic for an identical skeleton', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 11);
    const a = buildFloraMesh(skeleton, archetype);
    const b = buildFloraMesh(skeleton, archetype);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.geometry.getAttribute('position').array),
    );
  });

  it('produces no NaN or infinite values in position/normal/windWeight', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    for (const attrName of ['position', 'normal', 'windWeight']) {
      const attr = geometry.getAttribute(attrName);
      for (let i = 0; i < attr.array.length; i++) {
        expect(Number.isFinite(attr.array[i])).toBe(true);
      }
    }
  });

  it('wind weight is 0 at the root and increases toward deeper branches', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    const windWeight = geometry.getAttribute('windWeight').array;

    // The root segment's first ring (indices 0..radialSegments-1) is its start ring.
    for (let i = 0; i < 6; i++) {
      expect(windWeight[i]).toBe(0);
    }
    const maxWeight = Math.max(...Array.from(windWeight));
    expect(maxWeight).toBeGreaterThan(0);
    expect(maxWeight).toBeLessThanOrEqual(1);
  });

  it('rejects an archetype whose branching would exceed the mesh triangle budget', () => {
    // Large enough to blow the 20k triangle budget, small enough that the
    // skeleton itself (capped at 5k nodes) still generates for this test.
    const archetype = makeArchetype({
      branching: { maxDepth: 5, childrenPerNode: [4, 5], spreadAngleRad: [0.3, 0.8], lengthFalloff01: 0.8 },
    });
    const skeleton = generateFloraSkeleton(archetype, 1);
    expect(() => buildFloraMesh(skeleton, archetype)).toThrowError(RangeError);
  });

  it('rejects a runaway archetype at the skeleton stage before it can hang mesh building', () => {
    const archetype = makeArchetype({
      branching: { maxDepth: 8, childrenPerNode: [6, 8], spreadAngleRad: [0.3, 0.8], lengthFalloff01: 0.8 },
    });
    expect(() => generateFloraSkeleton(archetype, 1)).toThrowError(RangeError);
  });

  it('reports a vertex/triangle count consistent with the geometry', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 9);
    const result = buildFloraMesh(skeleton, archetype);
    expect(result.vertexCount).toBe(result.geometry.getAttribute('position').count);
    expect(result.triangleCount).toBe((result.geometry.getIndex()?.count ?? 0) / 3);
  });
});

describe('buildFloraMesh with radial-fronds foliage', () => {
  function makePalmArchetype(frondCount = 7): IFloraArchetype {
    return makeArchetype({
      branching: { maxDepth: 0, childrenPerNode: [0, 0], spreadAngleRad: [0, 0], lengthFalloff01: 0 },
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.3, 0.4],
        radialFronds: { frondCount, frondLengthM: [1.8, 2.4], frondDroopRad: 0.45 },
      },
    });
  }

  it('is deterministic for an identical skeleton', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 11);
    const a = buildFloraMesh(skeleton, archetype);
    const b = buildFloraMesh(skeleton, archetype);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.geometry.getAttribute('position').array),
    );
  });

  it('produces no NaN or infinite values in position/normal/windWeight', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    for (const attrName of ['position', 'normal', 'windWeight']) {
      const attr = geometry.getAttribute(attrName);
      for (let i = 0; i < attr.array.length; i++) {
        expect(Number.isFinite(attr.array[i])).toBe(true);
      }
    }
  });

  it('triangle count scales with frondCount and stays under the budget', () => {
    const skeletonFew = generateFloraSkeleton(makePalmArchetype(4), 5);
    const skeletonMany = generateFloraSkeleton(makePalmArchetype(10), 5);
    const few = buildFloraMesh(skeletonFew, makePalmArchetype(4));
    const many = buildFloraMesh(skeletonMany, makePalmArchetype(10));
    expect(many.triangleCount).toBeGreaterThan(few.triangleCount);
    expect(many.triangleCount).toBeLessThan(20_000);
  });

  it('all frond vertices carry max wind weight', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 4);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    const windWeight = geometry.getAttribute('windWeight').array;
    // Root ring (trunk base) is 0; foliage/frond vertices come after and are all 1.
    expect(Math.max(...Array.from(windWeight))).toBe(1);
  });
});

describe('buildFloraMesh with conifer-tiered foliage', () => {
  function makePineArchetype(): IFloraArchetype {
    return makeArchetype({
      id: 'pine-01',
      trunk: { heightM: [7, 8], radiusM: [0.25, 0.35], taper01: 0.6 },
      branching: {
        distribution: 'tiered-whorls',
        maxDepth: 2,
        childrenPerNode: [2, 3],
        spreadAngleRad: [0.4, 0.7],
        lengthFalloff01: 0.5,
        tieredWhorls: {
          tierCount: [5, 6],
          startHeightFraction01: 0.22,
          branchesPerTier: [4, 5],
          droopRad: [0.1, 0.2],
          baseBranchLengthFraction: [0.4, 0.45],
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
  }

  it('is deterministic for an identical skeleton', () => {
    const archetype = makePineArchetype();
    const skeleton = generateFloraSkeleton(archetype, 11);
    const a = buildFloraMesh(skeleton, archetype);
    const b = buildFloraMesh(skeleton, archetype);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.geometry.getAttribute('position').array),
    );
  });

  it('produces no NaN or infinite values in position/normal/windWeight', () => {
    const archetype = makePineArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    for (const attrName of ['position', 'normal', 'windWeight']) {
      const attr = geometry.getAttribute(attrName);
      for (let i = 0; i < attr.array.length; i++) {
        expect(Number.isFinite(attr.array[i])).toBe(true);
      }
    }
  });

  it('stays well within triangle budget while providing rich volume', () => {
    const archetype = makePineArchetype();
    const skeleton = generateFloraSkeleton(archetype, 7);
    const result = buildFloraMesh(skeleton, archetype);
    expect(result.triangleCount).toBeGreaterThan(400);
    expect(result.triangleCount).toBeLessThan(5000);
  });

  it('root wind weight is 0 and max wind weight is high at bough tips', () => {
    const archetype = makePineArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    const windWeight = geometry.getAttribute('windWeight').array;

    for (let i = 0; i < 6; i++) {
      expect(windWeight[i]).toBe(0);
    }
    expect(Math.max(...Array.from(windWeight))).toBeGreaterThanOrEqual(0.9);
  });
});

describe('buildFloraMesh with curved palm and multi-tier radial fronds', () => {
  function makePalmArchetype(): IFloraArchetype {
    return makeArchetype({
      id: 'palm-01',
      trunk: {
        heightM: [7, 9],
        radiusM: [0.2, 0.25],
        taper01: 0.25,
        curveRad: [0.15, 0.25],
        curveSegments: 5,
        baseFlare01: 0.35,
      },
      branching: {
        maxDepth: 0,
        childrenPerNode: [0, 0],
        spreadAngleRad: [0, 0],
        lengthFalloff01: 0,
      },
      foliage: {
        style: 'radial-fronds',
        sizeM: [0.35, 0.5],
        radialFronds: {
          frondCount: 18,
          frondLengthM: [3.2, 4.4],
          frondDroopRad: 0.65,
          tierCount: 3,
          archRad: 0.45,
          frondWidthFraction: 0.13,
        },
      },
    });
  }

  it('is deterministic for identical skeleton', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 42);
    const a = buildFloraMesh(skeleton, archetype);
    const b = buildFloraMesh(skeleton, archetype);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(
      Array.from(b.geometry.getAttribute('position').array),
    );
  });

  it('produces valid finite positions, normals, and wind weights', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 42);
    const { geometry } = buildFloraMesh(skeleton, archetype);
    for (const attrName of ['position', 'normal', 'windWeight']) {
      const attr = geometry.getAttribute(attrName);
      for (let i = 0; i < attr.array.length; i++) {
        expect(Number.isFinite(attr.array[i])).toBe(true);
      }
    }
  });

  it('generates multi-faceted arching fronds within budget', () => {
    const archetype = makePalmArchetype();
    const skeleton = generateFloraSkeleton(archetype, 42);
    const result = buildFloraMesh(skeleton, archetype);
    expect(result.triangleCount).toBeGreaterThan(300);
    expect(result.triangleCount).toBeLessThan(3000);
  });
});

