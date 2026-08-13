import type { IFloraArchetype } from './flora-archetype';
import { generateFloraSkeleton } from './flora-skeleton';

function makeArchetype(overrides: Partial<IFloraArchetype> = {}): IFloraArchetype {
  return {
    schemaVersion: 1,
    id: 'oak-01',
    kind: 'tree',
    trunk: { heightM: [4, 6], radiusM: [0.3, 0.5], taper01: 0.4 },
    branching: {
      maxDepth: 2,
      childrenPerNode: [2, 4],
      spreadAngleRad: [0.4, 0.9],
      lengthFalloff01: 0.65,
    },
    foliage: { style: 'cluster-sphere', sizeM: [0.8, 1.4] },
    sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    collider: { trunk: 'capsule' },
    ...overrides,
  };
}

describe('generateFloraSkeleton', () => {
  it('is deterministic for identical archetype + seed', () => {
    const archetype = makeArchetype();
    const a = generateFloraSkeleton(archetype, 7);
    const b = generateFloraSkeleton(archetype, 7);
    expect(a).toEqual(b);
  });

  it('differs when the seed differs', () => {
    const archetype = makeArchetype();
    const a = generateFloraSkeleton(archetype, 7);
    const b = generateFloraSkeleton(archetype, 8);
    expect(a).not.toEqual(b);
  });

  it('root node is depth 0, parentId -1, rooted at the origin', () => {
    const [root] = generateFloraSkeleton(makeArchetype(), 1);
    expect(root.depth).toBe(0);
    expect(root.parentId).toBe(-1);
    expect(root.startM).toEqual([0, 0, 0]);
  });

  it('never produces a node deeper than branching.maxDepth', () => {
    const archetype = makeArchetype({
      branching: { maxDepth: 2, childrenPerNode: [3, 5], spreadAngleRad: [0.3, 0.8], lengthFalloff01: 0.7 },
    });
    const nodes = generateFloraSkeleton(archetype, 3);
    for (const node of nodes) {
      expect(node.depth).toBeLessThanOrEqual(2);
    }
  });

  it('produces only the root when maxDepth is 0', () => {
    const archetype = makeArchetype({
      branching: { maxDepth: 0, childrenPerNode: [2, 4], spreadAngleRad: [0.4, 0.9], lengthFalloff01: 0.65 },
    });
    const nodes = generateFloraSkeleton(archetype, 5);
    expect(nodes.length).toBe(1);
  });

  it('rejects a runaway archetype instead of hanging or exhausting memory', () => {
    const archetype = makeArchetype({
      branching: { maxDepth: 8, childrenPerNode: [6, 8], spreadAngleRad: [0.3, 0.8], lengthFalloff01: 0.8 },
    });
    expect(() => generateFloraSkeleton(archetype, 1)).toThrowError(RangeError);
  });

  it('produces no NaN coordinates or radii', () => {
    const nodes = generateFloraSkeleton(makeArchetype(), 42);
    for (const node of nodes) {
      for (const value of [...node.startM, ...node.endM, node.radiusStartM, node.radiusEndM]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
