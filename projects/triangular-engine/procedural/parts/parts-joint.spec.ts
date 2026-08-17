import type { IPartArchetype } from './parts-archetype';
import { derivePartColliders } from './parts-colliders';
import { type IPartVariant, posePartVariant } from './parts-joint';
import { derivePartMassProperties } from './parts-mass';
import { generatePartSkeleton } from './parts-skeleton';
import { derivePartSockets } from './parts-sockets';

describe('parts-joint', () => {
  const legArchetype: IPartArchetype = {
    schemaVersion: 1,
    id: 'test-leg',
    solids: [
      {
        id: 'mount-box',
        shape: 'box',
        positionM: [0, 0, 0],
        dimensionsM: [0.2, 0.2, 0.2],
        linkId: 0,
      },
      {
        id: 'strut-cyl',
        shape: 'cylinder',
        positionM: [0, -1.0, 0],
        dimensionsM: [0.05, 2.0],
        linkId: 1,
      },
    ],
    sockets: [
      { kind: 'attach', role: 'radial', solidId: 'mount-box' },
      { kind: 'pivot', solidId: 'mount-box' },
      { kind: 'foot', solidId: 'strut-cyl' },
    ],
    joint: {
      anchorM: [0, 0, 0],
      axis: [1, 0, 0], // rotate around X axis
      rangeRad: [0, Math.PI / 2], // 0 to 90 degrees
      restRad: 0,
    },
  };

  function createInitialVariant(): IPartVariant {
    const solids = generatePartSkeleton(legArchetype, 42);
    const sockets = derivePartSockets(solids, legArchetype, 42);
    const colliders = derivePartColliders(solids);
    const mass = derivePartMassProperties(solids);
    return { solids, sockets, colliders, mass, joint: legArchetype.joint };
  }

  it('pose(0) preserves rest state identically', () => {
    const initial = createInitialVariant();
    const posed = posePartVariant(initial, 0);

    expect(posed.solids[0].positionM).toEqual(initial.solids[0].positionM);
    expect(posed.solids[1].positionM[1]).toBeCloseTo(initial.solids[1].positionM[1], 4);
    expect(posed.sockets[0].positionM).toEqual(initial.sockets[0].positionM);
    expect(posed.colliders[1].anchorRelativePositionM[1]).toBeCloseTo(
      initial.colliders[1].anchorRelativePositionM[1],
      4,
    );
  });

  it('rotates only link-1 solids, sockets, and colliders by deploy angle', () => {
    const initial = createInitialVariant();
    const angle90 = Math.PI / 2; // 90 degrees around +X: (0, -1, 0) becomes (0, 0, -1)
    const posed = posePartVariant(initial, angle90);

    // Link 0 (mount-box & attach socket) untouched
    expect(posed.solids[0].positionM).toEqual(initial.solids[0].positionM);
    const attachSocket = posed.sockets.find((s) => s.kind === 'attach');
    expect(attachSocket?.positionM).toEqual(initial.sockets.find((s) => s.kind === 'attach')?.positionM!);

    // Link 1 (strut-cyl) rotated from (0, -1, 0) to (0, 0, -1)
    const strutSolid = posed.solids[1];
    expect(strutSolid.positionM[0]).toBeCloseTo(0, 3);
    expect(strutSolid.positionM[1]).toBeCloseTo(0, 3);
    expect(strutSolid.positionM[2]).toBeCloseTo(-1, 3);

    // Collider descriptor rotated with solid
    const strutCollider = posed.colliders.find((c) => c.solidId === 'strut-cyl');
    expect(strutCollider?.anchorRelativePositionM[2]).toBeCloseTo(-1, 3);

    // Foot socket moved to rotated extremity
    const footSocket = posed.sockets.find((s) => s.kind === 'foot');
    expect(footSocket?.positionM[2]).toBeCloseTo(-2, 3);
  });

  it('clamps deploy angle to joint rangeRad', () => {
    const initial = createInitialVariant();
    // Test over-range angle (e.g. 180 degrees when max is 90)
    const overPosed = posePartVariant(initial, Math.PI);
    const maxPosed = posePartVariant(initial, Math.PI / 2);

    expect(overPosed.solids[1].positionM).toEqual(maxPosed.solids[1].positionM);
  });
});
