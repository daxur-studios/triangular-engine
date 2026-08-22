import { DEMO_CHOPSTICK_TOWER_ARCHETYPE } from './structures-catalog';
import { deriveStructureColliders } from './structures-colliders';
import { deriveStructureFootprint2D } from './structures-footprint';
import { type IStructureVariant, poseStructureVariant } from './structures-joint';
import { generateStructureSkeleton } from './structures-skeleton';
import { deriveStructureSockets } from './structures-sockets';

describe('poseStructureVariant', () => {
  it('poses prismatic elevator carriage and rotary chopsticks', () => {
    const seed = 55;
    const solids = generateStructureSkeleton(DEMO_CHOPSTICK_TOWER_ARCHETYPE, seed);
    const sockets = deriveStructureSockets(solids, DEMO_CHOPSTICK_TOWER_ARCHETYPE, seed);
    const colliders = deriveStructureColliders(solids, DEMO_CHOPSTICK_TOWER_ARCHETYPE);
    const footprint = deriveStructureFootprint2D(DEMO_CHOPSTICK_TOWER_ARCHETYPE, seed);

    const variant: IStructureVariant = {
      archetypeId: DEMO_CHOPSTICK_TOWER_ARCHETYPE.id,
      seed,
      solids,
      sockets,
      colliders,
      footprint,
      joints: DEMO_CHOPSTICK_TOWER_ARCHETYPE.joints,
    };

    const carriageSolidsBefore = variant.solids.filter((s) => s.linkId === 1);
    const carriagePosYBefore = carriageSolidsBefore[0].positionM[1];

    // Lift carriage by +20m
    const posed = poseStructureVariant(variant, {
      'carriage-lift': 20,
      'chopstick-left-hinge': 0.2,
      'chopstick-right-hinge': -0.2,
    });

    const carriageSolidsAfter = posed.solids.filter((s) => s.linkId === 1);
    const carriagePosYAfter = carriageSolidsAfter[0].positionM[1];

    expect(carriagePosYAfter).toBeCloseTo(carriagePosYBefore + 20, 2);

    // Link 0 (ground foundation) should remain fixed
    const foundationBefore = variant.solids.find((s) => s.id === 'tower-foundation')!;
    const foundationAfter = posed.solids.find((s) => s.id === 'tower-foundation')!;
    expect(foundationAfter.positionM).toEqual(foundationBefore.positionM);
  });
});
