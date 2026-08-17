import type { IPartArchetype } from './parts-archetype';
import { generatePartSkeleton } from './parts-skeleton';
import { derivePartSockets, quaternionFromUnitZ } from './parts-sockets';

describe('parts-sockets', () => {
  const engineArchetype: IPartArchetype = {
    schemaVersion: 1,
    id: 'part-test-engine',
    solids: [
      {
        id: 'engine-tank',
        shape: 'cylinder',
        positionM: [0, 0.5, 0],
        dimensionsM: [0.5, 1.0],
        linkId: 0,
      },
      {
        id: 'nozzle-bell',
        shape: 'cone',
        positionM: [0, -0.4, 0],
        dimensionsM: [0.6, 0.2, 0.8], // radiusBottom, radiusTop, height
        linkId: 0,
      },
    ],
    sockets: [
      { kind: 'attach', role: 'stack-top', solidId: 'engine-tank' },
      { kind: 'thrust', solidId: 'nozzle-bell' },
    ],
  };

  it('quaternionFromUnitZ aligns canonical +Z to target directions correctly', () => {
    // Identity for +Z
    const qZ = quaternionFromUnitZ([0, 0, 1]);
    expect(qZ).toEqual([0, 0, 0, 1]);

    // -Z (180 flip)
    const qNegZ = quaternionFromUnitZ([0, 0, -1]);
    expect(qNegZ).toEqual([0, 1, 0, 0]);

    // +Y
    const qY = quaternionFromUnitZ([0, 1, 0]);
    expect(Number.isFinite(qY[0])).toBeTrue();
    expect(Number.isFinite(qY[3])).toBeTrue();
  });

  it('derives stable socket IDs across seeds', () => {
    const skeleton1 = generatePartSkeleton(engineArchetype, 42);
    const sockets1 = derivePartSockets(skeleton1, engineArchetype, 42);

    const skeleton2 = generatePartSkeleton(engineArchetype, 42);
    const sockets2 = derivePartSockets(skeleton2, engineArchetype, 42);

    expect(sockets1.length).toBe(2);
    expect(sockets1[0].id).toBe(sockets2[0].id);
    expect(sockets1[1].id).toBe(sockets2[1].id);
  });

  it('places attach and thrust sockets at correct anatomical positions', () => {
    const skeleton = generatePartSkeleton(engineArchetype, 100);
    const sockets = derivePartSockets(skeleton, engineArchetype, 100);

    const attach = sockets.find((s) => s.kind === 'attach');
    const thrust = sockets.find((s) => s.kind === 'thrust');

    expect(attach).toBeDefined();
    expect(attach?.role).toBe('stack-top');
    // Top of cylinder at y = 0.5 + 0.5 = 1.0
    expect(attach?.positionM[1]).toBeCloseTo(1.0, 2);

    expect(thrust).toBeDefined();
    // Bottom of nozzle cone at y = -0.4 - 0.4 = -0.8
    expect(thrust?.positionM[1]).toBeCloseTo(-0.8, 2);
  });
});
