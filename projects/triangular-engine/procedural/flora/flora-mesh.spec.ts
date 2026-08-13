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
