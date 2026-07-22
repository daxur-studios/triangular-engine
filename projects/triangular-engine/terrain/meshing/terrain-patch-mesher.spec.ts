import { ConstantTerrainField } from '../core/terrain-field';
import { TerrainVector3 } from '../core/terrain-math';
import { ITerrainSurfaceDomain } from '../domains/terrain-surface-domain';
import { generateTerrainPatchMesh } from './terrain-patch-mesher';

interface IFakePatchAddress {
  readonly id: string;
}

class FakePlaneDomain implements ITerrainSurfaceDomain<IFakePatchAddress> {
  readonly kind = 'fake-plane';

  getPatchBounds(_address: IFakePatchAddress) {
    return { minU: 0, maxU: 2, minV: 0, maxV: 2 };
  }

  getFieldPosition(
    _address: IFakePatchAddress,
    u: number,
    v: number,
  ): TerrainVector3 {
    return [u, 0, v];
  }

  getSurfacePosition(
    _address: IFakePatchAddress,
    u: number,
    v: number,
    elevationM: number,
  ): TerrainVector3 {
    // Negating V makes increasing U × increasing V face the visible +Y side.
    return [1_000_000_000 + u, elevationM, -1_000_000_000 - v];
  }

  getGeometricErrorM(
    _address: IFakePatchAddress,
    resolution: number,
    minElevationM: number,
    maxElevationM: number,
  ): number {
    return maxElevationM - minElevationM + 2 / resolution;
  }
}

describe('multi-surface terrain foundation', () => {
  const address = { id: 'fixture' } as const;
  const domain = new FakePlaneDomain();

  it('generates patch-local geometry without knowing the surface shape', () => {
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(5), domain, {
      address,
      resolution: 2,
    });

    expect(mesh.address).toBe(address);
    expect(mesh.centerWorldM).toEqual([1_000_000_001, 5, -1_000_000_001]);
    expect([...mesh.surface.positions.slice(0, 3)]).toEqual([-1, 0, 1]);
    expect(mesh.surface.positions.length).toBe(27);
    expect(mesh.surface.indices.length).toBe(24);
    expect(mesh.geometricErrorM).toBe(1);
  });

  it('uses the domain orientation to produce inhabitant-facing normals and winding', () => {
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(), domain, {
      address,
      resolution: 2,
    });

    for (let index = 0; index < mesh.surface.normals.length; index += 3) {
      expect(mesh.surface.normals[index]).toBeCloseTo(0, 7);
      expect(mesh.surface.normals[index + 1]).toBeCloseTo(1, 7);
      expect(mesh.surface.normals[index + 2]).toBeCloseTo(0, 7);
    }
    expect([...mesh.surface.indices.slice(0, 6)]).toEqual([0, 1, 4, 0, 4, 3]);
  });

  it('rejects invalid patch resolution and degenerate bounds', () => {
    expect(() =>
      generateTerrainPatchMesh(new ConstantTerrainField(), domain, {
        address,
        resolution: 1,
      }),
    ).toThrowError(RangeError);

    const degenerate: ITerrainSurfaceDomain<IFakePatchAddress> = {
      kind: domain.kind,
      getPatchBounds: () => ({ minU: 0, maxU: 0, minV: 0, maxV: 1 }),
      getFieldPosition: (patchAddress, u, v) =>
        domain.getFieldPosition(patchAddress, u, v),
      getSurfacePosition: (patchAddress, u, v, elevationM) =>
        domain.getSurfacePosition(patchAddress, u, v, elevationM),
      getGeometricErrorM: (
        patchAddress,
        resolution,
        minElevationM,
        maxElevationM,
      ) =>
        domain.getGeometricErrorM(
          patchAddress,
          resolution,
          minElevationM,
          maxElevationM,
        ),
    };
    expect(() =>
      generateTerrainPatchMesh(new ConstantTerrainField(), degenerate, {
        address,
        resolution: 2,
      }),
    ).toThrowError(RangeError);
  });

  it('validates constant-field inputs and reuses a correctly sized batch output', () => {
    expect(() => new ConstantTerrainField(Number.NaN)).toThrowError(RangeError);
    const field = new ConstantTerrainField(3);
    const output = new Float64Array(2);
    expect(field.sampleBatch(new Float64Array(6), output)).toBe(output);
    expect([...output]).toEqual([3, 3]);
    expect(() => field.sampleBatch(new Float64Array(4))).toThrowError(
      RangeError,
    );
    expect(() =>
      field.sampleBatch(new Float64Array(6), new Float64Array(1)),
    ).toThrowError(RangeError);
  });
});
