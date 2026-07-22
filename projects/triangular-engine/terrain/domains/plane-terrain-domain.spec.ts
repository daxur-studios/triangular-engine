import { ConstantTerrainField } from '../core/terrain-field';
import { generateTerrainPatchMesh } from '../meshing/terrain-patch-mesher';
import { PlaneTerrainDomain } from './plane-terrain-domain';

describe('PlaneTerrainDomain', () => {
  const domain = new PlaneTerrainDomain(1_024);

  it('supports negative and very large absolute tile coordinates', () => {
    expect(domain.getPatchBounds({ level: 0, x: -2, z: 1_000_000 })).toEqual({
      minU: -2_048,
      maxU: -1_024,
      minV: 1_024_000_000,
      maxV: 1_024_001_024,
    });
  });

  it('gives adjacent patches identical shared-edge positions and normals', () => {
    const field = new ConstantTerrainField(12);
    const left = generateTerrainPatchMesh(field, domain, {
      address: { level: 0, x: -1, z: 4 },
      resolution: 8,
    });
    const right = generateTerrainPatchMesh(field, domain, {
      address: { level: 0, x: 0, z: 4 },
      resolution: 8,
    });
    const row = 9;
    for (let v = 0; v < row; v++) {
      const li = (v * row + 8) * 3;
      const ri = v * row * 3;
      for (let axis = 0; axis < 3; axis++) {
        expect(
          left.centerWorldM[axis] + left.surface.positions[li + axis],
        ).toBe(right.centerWorldM[axis] + right.surface.positions[ri + axis]);
        expect(left.surface.normals[li + axis]).toBe(
          right.surface.normals[ri + axis],
        );
      }
    }
  });

  it('keeps local vertices precise at billion-metre coordinates', () => {
    const patch = generateTerrainPatchMesh(new ConstantTerrainField(), domain, {
      address: { level: 0, x: 1_000_000, z: -1_000_000 },
      resolution: 8,
    });
    expect(patch.centerWorldM[0]).toBe(1_024_000_512);
    expect(Math.max(...patch.surface.positions.map(Math.abs))).toBe(512);
  });
});
