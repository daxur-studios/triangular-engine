import { ConstantTerrainField } from '../core/terrain-field';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import { CylinderTerrainDomain } from './cylinder-terrain-domain';

describe('CylinderTerrainDomain', () => {
  const domain = new CylinderTerrainDomain({
    radiusM: 10_000,
    lengthM: 50_000,
    levelZeroAngularPatchCount: 8,
    levelZeroAxialPatchCount: 4,
  });

  it('wraps angular neighbors and deliberately stops at axial ends', () => {
    expect(
      domain.getNeighbor({ level: 0, angularIndex: 0, axialIndex: 0 }, -1, 0),
    ).toEqual({ level: 0, angularIndex: 7, axialIndex: 0 });
    expect(
      domain.getNeighbor({ level: 0, angularIndex: 7, axialIndex: 3 }, 1, 0),
    ).toEqual({ level: 0, angularIndex: 0, axialIndex: 3 });
    expect(
      domain.getNeighbor({ level: 0, angularIndex: 0, axialIndex: 0 }, 0, -1),
    ).toBeNull();
    expect(
      domain.getNeighbor({ level: 0, angularIndex: 0, axialIndex: 3 }, 0, 1),
    ).toBeNull();
  });

  it('uses periodic angular field coordinates without losing axial variation', () => {
    const address = { level: 0, angularIndex: 0, axialIndex: 0 };
    const atZero = domain.getFieldPosition(address, -100, 0);
    const atFullTurn = domain.getFieldPosition(address, -100, Math.PI * 2);
    expect(atFullTurn[0]).toBe(atZero[0]);
    expect(atFullTurn[1]).toBeCloseTo(atZero[1], 12);
    expect(atFullTurn[2]).toBeCloseTo(atZero[2], 12);
    expect(domain.getFieldPosition(address, 100, 0)[0]).not.toBe(atZero[0]);
  });

  it('produces inhabitant-facing inward normals and winding', () => {
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(25), domain, {
      address: { level: 0, angularIndex: 2, axialIndex: 1 },
      resolution: 8,
    });
    for (let index = 0; index < mesh.surface.positions.length; index += 3) {
      const worldY = mesh.centerWorldM[1] + mesh.surface.positions[index + 1];
      const worldZ = mesh.centerWorldM[2] + mesh.surface.positions[index + 2];
      const radialDot =
        worldY * mesh.surface.normals[index + 1] +
        worldZ * mesh.surface.normals[index + 2];
      expect(radialDot).toBeLessThan(0);
    }
  });

  it('matches positions and normals exactly across the angular seam', () => {
    const field = new ConstantTerrainField(40);
    const seamStart = domain.getSurfacePosition(
      { level: 0, angularIndex: 0, axialIndex: 2 },
      1_000,
      0,
      40,
    );
    const seamEnd = domain.getSurfacePosition(
      { level: 0, angularIndex: 7, axialIndex: 2 },
      1_000,
      Math.PI * 2,
      40,
    );
    expect(seamEnd[0]).toBe(seamStart[0]);
    expect(seamEnd[1]).toBeCloseTo(seamStart[1], 10);
    expect(seamEnd[2]).toBeCloseTo(seamStart[2], 10);
    const first = generateTerrainPatchMesh(field, domain, {
      address: { level: 0, angularIndex: 0, axialIndex: 2 },
      resolution: 8,
    });
    const last = generateTerrainPatchMesh(field, domain, {
      address: { level: 0, angularIndex: 7, axialIndex: 2 },
      resolution: 8,
    });
    const row = 9;
    for (let axial = 0; axial < row; axial++) {
      const firstVertex = axial * 3;
      const lastVertex = (8 * row + axial) * 3;
      for (let axis = 0; axis < 3; axis++) {
        const positionDelta = Math.abs(
          first.centerWorldM[axis] + first.surface.positions[firstVertex + axis] -
            (last.centerWorldM[axis] + last.surface.positions[lastVertex + axis]),
        );
        // Independent f32-localized patches retain sub-millimetre agreement.
        expect(positionDelta).toBeLessThan(0.0003);
        expect(first.surface.normals[firstVertex + axis]).toBeCloseTo(
          last.surface.normals[lastVertex + axis],
          5,
        );
      }
    }
  });

  it('keeps deep-level vertices patch-local at billion-metre radius', () => {
    const huge = new CylinderTerrainDomain({
      radiusM: 1_000_000_000,
      lengthM: 2_000_000_000,
    });
    const counts = huge.getPatchCounts(20);
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(), huge, {
      address: {
        level: 20,
        angularIndex: Math.floor(counts.angular / 2),
        axialIndex: Math.floor(counts.axial / 2),
      },
      resolution: 8,
    });
    expect(Math.max(...mesh.surface.positions.map(Math.abs))).toBeLessThan(1_000);
  });
});
