import { DEMO_CHOPSTICK_TOWER_ARCHETYPE, DEMO_RUNWAY_ARCHETYPE } from './structures-catalog';
import { generateStructureSkeleton } from './structures-skeleton';
import { deriveStructureSockets } from './structures-sockets';

describe('deriveStructureSockets', () => {
  it('derives stable sockets with IDs and valid orientations', () => {
    const solids = generateStructureSkeleton(DEMO_RUNWAY_ARCHETYPE, 12);
    const sockets = deriveStructureSockets(solids, DEMO_RUNWAY_ARCHETYPE, 12);

    expect(sockets.length).toBe(2);

    const spawn = sockets.find((s) => s.kind === 'spawn-point');
    expect(spawn).toBeDefined();
    expect(spawn?.id).toMatch(/^spawn-point-/);
    expect(spawn?.orientation.length).toBe(4);

    const touchdown = sockets.find((s) => s.kind === 'touchdown-zone');
    expect(touchdown).toBeDefined();
    expect(touchdown?.role).toBe('recovery');
  });

  it('derives catch-zone socket for chopstick tower', () => {
    const solids = generateStructureSkeleton(DEMO_CHOPSTICK_TOWER_ARCHETYPE, 99);
    const sockets = deriveStructureSockets(solids, DEMO_CHOPSTICK_TOWER_ARCHETYPE, 99);

    const catchZone = sockets.find((s) => s.kind === 'catch-zone');
    expect(catchZone).toBeDefined();
    expect(catchZone?.role).toBe('recovery');
    expect(catchZone?.clearanceRadiusM).toBe(12);
  });
});
