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
      {
        id: 'piston-foot',
        shape: 'cylinder',
        positionM: [0, -2.0, 0],
        dimensionsM: [0.03, 0.5],
        linkId: 2,
      },
    ],
    sockets: [
      { kind: 'attach', role: 'radial', solidId: 'mount-box' },
      { kind: 'pivot', solidId: 'mount-box' },
      { kind: 'foot', solidId: 'piston-foot' },
    ],
    joint: {
      anchorM: [0, 0, 0],
      axis: [1, 0, 0], // rotate around X axis
      rangeRad: [0, Math.PI / 2], // 0 to 90 degrees
      restRad: 0,
      extensionM: 0.6,
      extensionAxis: [0, -1, 0],
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

  it('rotates link-1 and extends link-2 solids, sockets, and colliders', () => {
    const initial = createInitialVariant();
    const angle90 = Math.PI / 2; // 90 degrees around +X: (0, -1, 0) becomes (0, 0, -1)
    const posed = posePartVariant(initial, angle90);

    // Link 0 (mount-box & attach socket) untouched
    expect(posed.solids[0].positionM).toEqual(initial.solids[0].positionM);
    const attachSocket = posed.sockets.find((s) => s.kind === 'attach');
    expect(attachSocket?.positionM).toEqual(initial.sockets.find((s) => s.kind === 'attach')?.positionM!);

    // Link 1 (strut-cyl) rotated from (0, -1, 0) to (0, 0, -1) without translation
    const strutSolid = posed.solids[1];
    expect(strutSolid.positionM[0]).toBeCloseTo(0, 3);
    expect(strutSolid.positionM[1]).toBeCloseTo(0, 3);
    expect(strutSolid.positionM[2]).toBeCloseTo(-1, 3);

    // Link 2 (piston-foot) rotated from (0, -2, 0) to (0, 0, -2) PLUS translated by extensionM 0.6 along rotated -Y (which is -Z)
    // -2.0 + (-0.6) = -2.6 in Z
    const pistonSolid = posed.solids[2];
    expect(pistonSolid.positionM[0]).toBeCloseTo(0, 3);
    expect(pistonSolid.positionM[1]).toBeCloseTo(0, 3);
    expect(pistonSolid.positionM[2]).toBeCloseTo(-2.6, 3);

    // Foot socket is on link 2, so it inherits rotation + extension
    const footSocket = posed.sockets.find((s) => s.kind === 'foot');
    expect(footSocket?.positionM[2]).toBeCloseTo(-2.85, 2);

    // Live mass properties recalculated
    expect(posed.mass.centerOfMassM[2]).toBeLessThan(0);
  });

  it('clamps deploy angle to joint rangeRad', () => {
    const initial = createInitialVariant();
    // Test over-range angle (e.g. 180 degrees when max is 90)
    const overPosed = posePartVariant(initial, Math.PI);
    const maxPosed = posePartVariant(initial, Math.PI / 2);

    expect(overPosed.solids[1].positionM).toEqual(maxPosed.solids[1].positionM);
    expect(overPosed.solids[2].positionM).toEqual(maxPosed.solids[2].positionM);
  });

  it('handles symmetric/bipolar joint ranges (e.g. wing flaps or gimbal)', () => {
    const gimbalArchetype: IPartArchetype = {
      schemaVersion: 1,
      id: 'test-gimbal',
      solids: [
        {
          id: 'base',
          shape: 'cylinder',
          positionM: [0, 0.5, 0],
          dimensionsM: [0.3, 0.2],
          linkId: 0,
        },
        {
          id: 'nozzle',
          shape: 'cone',
          positionM: [0, -0.4, 0],
          dimensionsM: [0.4, 0.15, 0.8],
          linkId: 1,
        },
      ],
      sockets: [
        { kind: 'attach', role: 'stack-top', solidId: 'base' },
        { kind: 'thrust', solidId: 'nozzle' },
      ],
      joint: {
        anchorM: [0, 0, 0],
        axis: [1, 0, 0],
        rangeRad: [-0.2, 0.2], // -11.5 deg to +11.5 deg
        restRad: 0,
      },
    };

    const solids = generatePartSkeleton(gimbalArchetype, 1);
    const sockets = derivePartSockets(solids, gimbalArchetype, 1);
    const colliders = derivePartColliders(solids);
    const mass = derivePartMassProperties(solids);
    const variant: IPartVariant = { solids, sockets, colliders, mass, joint: gimbalArchetype.joint };

    const pitchedPos = posePartVariant(variant, 0.15);
    const pitchedNeg = posePartVariant(variant, -0.15);

    const thrustPos = pitchedPos.sockets.find((s) => s.kind === 'thrust')!;
    const thrustNeg = pitchedNeg.sockets.find((s) => s.kind === 'thrust')!;

    expect(thrustPos.positionM[2]).toBeLessThan(0);
    expect(thrustNeg.positionM[2]).toBeGreaterThan(0);
  });
});
