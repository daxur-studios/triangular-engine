import type { IFloraArchetype } from './flora-archetype';
import { deriveFloraSockets } from './flora-sockets';
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

describe('deriveFloraSockets', () => {
  it('is deterministic for identical archetype + seed', () => {
    const archetype = makeArchetype({
      sockets: { perchesPerBranchDepth: { 1: 2 }, nestCavityChance01: 1, fruitSlotsMax: 3, flowerHeads: true },
    });
    const skeleton = generateFloraSkeleton(archetype, 5);
    const a = deriveFloraSockets(skeleton, archetype, 5);
    const b = deriveFloraSockets(skeleton, archetype, 5);
    expect(a).toEqual(b);
  });

  it('always includes exactly one root-base socket at the origin', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 1);
    const sockets = deriveFloraSockets(skeleton, archetype, 1);
    const rootBaseSockets = sockets.filter((s) => s.kind === 'root-base');
    expect(rootBaseSockets.length).toBe(1);
    expect(rootBaseSockets[0].positionM).toEqual([0, 0, 0]);
  });

  it('does not reshuffle socket ids when an unrelated archetype field changes', () => {
    const archetypeA = makeArchetype({
      sockets: { perchesPerBranchDepth: { 1: 2 }, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    });
    const archetypeB = { ...archetypeA, name: 'Renamed oak' };
    const skeletonA = generateFloraSkeleton(archetypeA, 5);
    const skeletonB = generateFloraSkeleton(archetypeB, 5);
    const socketsA = deriveFloraSockets(skeletonA, archetypeA, 5);
    const socketsB = deriveFloraSockets(skeletonB, archetypeB, 5);
    expect(socketsA.map((s) => s.id)).toEqual(socketsB.map((s) => s.id));
  });

  it('places at most the requested perch count per branch depth, clamped to eligible nodes', () => {
    // spreadAngleRad near pi/2 tilts depth-1 branches (parent direction is
    // exactly UP) to within a few degrees of horizontal, so every depth-1
    // node qualifies as a perch candidate regardless of azimuth.
    const archetype = makeArchetype({
      branching: { maxDepth: 2, childrenPerNode: [2, 2], spreadAngleRad: [1.4, 1.7], lengthFalloff01: 0.65 },
      sockets: { perchesPerBranchDepth: { 1: 1000 }, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    });
    const skeleton = generateFloraSkeleton(archetype, 2);
    const sockets = deriveFloraSockets(skeleton, archetype, 2);
    const perches = sockets.filter((s) => s.kind === 'perch');
    const nodesAtDepth1 = skeleton.filter((n) => n.depth === 1).length;
    expect(perches.length).toBe(nodesAtDepth1);
  });

  it('excludes steep or thin branches from perch eligibility even when the depth is requested', () => {
    // spreadAngleRad near 0 keeps depth-1 branches nearly vertical (straight
    // up, same as the trunk) — none should qualify as a perch.
    const archetype = makeArchetype({
      branching: { maxDepth: 2, childrenPerNode: [2, 2], spreadAngleRad: [0.02, 0.05], lengthFalloff01: 0.65 },
      sockets: { perchesPerBranchDepth: { 1: 1000 }, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    });
    const skeleton = generateFloraSkeleton(archetype, 2);
    const sockets = deriveFloraSockets(skeleton, archetype, 2);
    expect(sockets.some((s) => s.kind === 'perch')).toBe(false);
  });

  it('places perch gizmos along the branch midpoint, not at the fork endpoint', () => {
    const archetype = makeArchetype({
      branching: { maxDepth: 2, childrenPerNode: [2, 2], spreadAngleRad: [1.4, 1.7], lengthFalloff01: 0.65 },
      sockets: { perchesPerBranchDepth: { 1: 1000 }, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: false },
    });
    const skeleton = generateFloraSkeleton(archetype, 2);
    const sockets = deriveFloraSockets(skeleton, archetype, 2);
    const perches = sockets.filter((s) => s.kind === 'perch');
    const depth1Nodes = skeleton.filter((n) => n.depth === 1);
    expect(perches.length).toBeGreaterThan(0);
    for (const perch of perches) {
      const matchesEndpoint = depth1Nodes.some(
        (n) =>
          perch.positionM[0] === n.endM[0] &&
          perch.positionM[1] === n.endM[1] &&
          perch.positionM[2] === n.endM[2],
      );
      expect(matchesEndpoint).toBe(false);
    }
  });

  it('places no perches when perchesPerBranchDepth is empty', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 4);
    const sockets = deriveFloraSockets(skeleton, archetype, 4);
    expect(sockets.some((s) => s.kind === 'perch')).toBe(false);
  });

  it('places a nest cavity when chance is 1, never when chance is 0', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 8);

    const always = deriveFloraSockets(skeleton, { ...archetype, sockets: { ...archetype.sockets, nestCavityChance01: 1 } }, 8);
    expect(always.filter((s) => s.kind === 'nest-cavity').length).toBe(1);

    const never = deriveFloraSockets(skeleton, { ...archetype, sockets: { ...archetype.sockets, nestCavityChance01: 0 } }, 8);
    expect(never.some((s) => s.kind === 'nest-cavity')).toBe(false);
  });

  it('caps fruit slots at fruitSlotsMax and at the number of branch tips', () => {
    const archetype = makeArchetype({
      sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 1, flowerHeads: false },
    });
    const skeleton = generateFloraSkeleton(archetype, 6);
    const sockets = deriveFloraSockets(skeleton, archetype, 6);
    expect(sockets.filter((s) => s.kind === 'fruit-slot').length).toBe(1);
  });

  it('places no fruit or flower sockets when foliage style is none, even if requested', () => {
    const archetype = makeArchetype({
      foliage: { style: 'none', sizeM: [0.8, 1.4] },
      sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 5, flowerHeads: true },
    });
    const skeleton = generateFloraSkeleton(archetype, 6);
    const sockets = deriveFloraSockets(skeleton, archetype, 6);
    expect(sockets.some((s) => s.kind === 'fruit-slot' || s.kind === 'flower-head')).toBe(false);
  });

  it('places one flower-head per branch tip when enabled', () => {
    const archetype = makeArchetype({
      sockets: { perchesPerBranchDepth: {}, nestCavityChance01: 0, fruitSlotsMax: 0, flowerHeads: true },
    });
    const skeleton = generateFloraSkeleton(archetype, 6);
    const sockets = deriveFloraSockets(skeleton, archetype, 6);

    const hasChildren = new Set<number>();
    for (const node of skeleton) {
      if (node.parentId !== -1) hasChildren.add(node.parentId);
    }
    const tipCount = skeleton.filter((n) => !hasChildren.has(n.id)).length;
    expect(sockets.filter((s) => s.kind === 'flower-head').length).toBe(tipCount);
  });

  it('produces no NaN positions or clearance radii', () => {
    const archetype = makeArchetype({
      sockets: { perchesPerBranchDepth: { 0: 1, 1: 2 }, nestCavityChance01: 1, fruitSlotsMax: 3, flowerHeads: true },
    });
    const skeleton = generateFloraSkeleton(archetype, 9);
    const sockets = deriveFloraSockets(skeleton, archetype, 9);
    for (const socket of sockets) {
      for (const value of [...socket.positionM, socket.clearanceRadiusM]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
