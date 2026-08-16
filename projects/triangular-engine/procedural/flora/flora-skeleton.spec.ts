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

describe('generateFloraSkeleton with tiered-whorls', () => {
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
      foliage: { style: 'conifer-tiered', sizeM: [0.6, 0.9] },
    });
  }

  it('is deterministic for identical archetype + seed', () => {
    const archetype = makePineArchetype();
    const a = generateFloraSkeleton(archetype, 13);
    const b = generateFloraSkeleton(archetype, 13);
    expect(a).toEqual(b);
  });

  it('generates tier branches distributed along the trunk height', () => {
    const archetype = makePineArchetype();
    const nodes = generateFloraSkeleton(archetype, 5);
    const depth1 = nodes.filter((n) => n.depth === 1);
    expect(depth1.length).toBeGreaterThanOrEqual(15);

    const attachHeights = depth1.map((n) => n.startM[1]);
    const minHeight = Math.min(...attachHeights);
    const maxHeight = Math.max(...attachHeights);

    // Lowest tier starts above ground (startHeightFraction ~0.22 of 7.5m = ~1.65m)
    expect(minHeight).toBeGreaterThan(1.0);
    // Highest tier reaches near top of trunk (~6.5m)
    expect(maxHeight).toBeGreaterThan(minHeight + 3.0);
  });

  it('lower tier branches are longer than upper tier branches', () => {
    const archetype = makePineArchetype();
    const nodes = generateFloraSkeleton(archetype, 5);
    const depth1 = nodes.filter((n) => n.depth === 1);

    const sortedByHeight = [...depth1].sort((a, b) => a.startM[1] - b.startM[1]);
    const lowest = sortedByHeight[0];
    const highest = sortedByHeight[sortedByHeight.length - 1];

    const lowLen = Math.hypot(
      lowest.endM[0] - lowest.startM[0],
      lowest.endM[1] - lowest.startM[1],
      lowest.endM[2] - lowest.startM[2],
    );
    const highLen = Math.hypot(
      highest.endM[0] - highest.startM[0],
      highest.endM[1] - highest.startM[1],
      highest.endM[2] - highest.startM[2],
    );

    expect(lowLen).toBeGreaterThan(highLen);
  });
});

describe('generateFloraSkeleton with curved trunk', () => {
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

  it('is deterministic for identical archetype + seed', () => {
    const archetype = makePalmArchetype();
    const a = generateFloraSkeleton(archetype, 42);
    const b = generateFloraSkeleton(archetype, 42);
    expect(a).toEqual(b);
  });

  it('generates the specified number of trunk segments', () => {
    const archetype = makePalmArchetype();
    const nodes = generateFloraSkeleton(archetype, 42);
    expect(nodes.length).toBe(5);
    for (let i = 0; i < nodes.length; i++) {
      expect(nodes[i].depth).toBe(0);
      if (i > 0) {
        expect(nodes[i].parentId).toBe(i - 1);
        expect(nodes[i].startM).toEqual(nodes[i - 1].endM);
      }
    }
  });

  it('applies base flare to the root node start radius', () => {
    const archetype = makePalmArchetype();
    const nodes = generateFloraSkeleton(archetype, 42);
    const root = nodes[0];
    const second = nodes[1];
    // Root start radius should be flared wider than its taper would predict
    expect(root.radiusStartM).toBeGreaterThan(root.radiusEndM * 1.2);
  });

  it('curves laterally away from the vertical axis', () => {
    const archetype = makePalmArchetype();
    const nodes = generateFloraSkeleton(archetype, 42);
    const tip = nodes[nodes.length - 1];
    const horizOffset = Math.hypot(tip.endM[0], tip.endM[2]);
    expect(horizOffset).toBeGreaterThan(0.5);
  });
});

