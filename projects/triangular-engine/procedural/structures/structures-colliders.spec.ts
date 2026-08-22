import { DEMO_LAUNCHPAD_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';
import { deriveStructureColliders } from './structures-colliders';
import { generateStructureSkeleton } from './structures-skeleton';

describe('deriveStructureColliders', () => {
  it('derives scatter/Jolt-compatible primitive descriptors', () => {
    const solids = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 5);
    const colliders = deriveStructureColliders(solids, DEMO_RUNWAY_ARCHETYPE);

    expect(colliders.length).toBeGreaterThan(0);

    for (const col of colliders) {
      expect(['box', 'sphere', 'cylinder', 'capsule']).toContain(col.shape);
      expect(col.params.length).toBeGreaterThan(0);
      expect(col.anchorRelativePositionM.length).toBe(3);
      expect(col.rotation.length).toBe(4);
    }
  });

  it('correctly maps cylinder shapes for launchpads', () => {
    const solids = generateStructureSkeleton(DEMO_LAUNCHPAD_ARCHETYPE, 7);
    const colliders = deriveStructureColliders(solids, DEMO_LAUNCHPAD_ARCHETYPE);

    const padCollider = colliders.find((c) => c.shape === 'cylinder');
    expect(padCollider).toBeDefined();
    expect(padCollider?.params.length).toBe(2); // [halfHeight, radius]
  });
});
