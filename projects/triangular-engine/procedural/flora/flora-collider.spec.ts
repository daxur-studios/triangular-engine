import { deriveFloraTrunkCollider } from './flora-collider';
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

describe('deriveFloraTrunkCollider', () => {
  it('returns undefined when the archetype opts out of a trunk collider', () => {
    const archetype = makeArchetype({ collider: { trunk: 'none' } });
    const skeleton = generateFloraSkeleton(archetype, 1);
    expect(deriveFloraTrunkCollider(skeleton, archetype)).toBeUndefined();
  });

  it('returns a capsule matching the trunk shape option', () => {
    const archetype = makeArchetype({ collider: { trunk: 'capsule' } });
    const skeleton = generateFloraSkeleton(archetype, 1);
    const collider = deriveFloraTrunkCollider(skeleton, archetype);
    expect(collider?.shape).toBe('capsule');
  });

  it('returns a cylinder matching the trunk shape option', () => {
    const archetype = makeArchetype({ collider: { trunk: 'cylinder' } });
    const skeleton = generateFloraSkeleton(archetype, 1);
    const collider = deriveFloraTrunkCollider(skeleton, archetype);
    expect(collider?.shape).toBe('cylinder');
  });

  it('derives [halfHeightM, radiusM] params from the trunk node', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 1);
    const trunk = skeleton[0];
    const collider = deriveFloraTrunkCollider(skeleton, archetype);
    const [halfHeightM, radiusM] = collider!.params;
    expect(halfHeightM).toBeCloseTo((trunk.endM[1] - trunk.startM[1]) / 2);
    expect(radiusM).toBe(trunk.radiusStartM);
  });

  it('is deterministic for an identical skeleton', () => {
    const archetype = makeArchetype();
    const skeleton = generateFloraSkeleton(archetype, 3);
    const a = deriveFloraTrunkCollider(skeleton, archetype);
    const b = deriveFloraTrunkCollider(skeleton, archetype);
    expect(a).toEqual(b);
  });
});
