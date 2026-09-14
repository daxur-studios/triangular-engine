import {
  ConstantTerrainField,
  ITerrainField,
  ITerrainFieldSample,
} from '../core/terrain-field';
import { TerrainVector3 } from '../core/terrain-math';
import { ITerrainSurfaceDomain } from '../domains/terrain-surface-domain';
import { PlaneTerrainDomain } from '../domains/plane-terrain-domain';
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

class CurvedTerrainField implements ITerrainField {
  readonly minElevationM = 0;
  readonly maxElevationM = 100;

  sample([x, _y, z]: TerrainVector3): ITerrainFieldSample {
    return { elevationM: (x * x + z * z * 0.7) / 1_000 };
  }

  sampleBatch(
    positions: Float64Array,
    output = new Float64Array(positions.length / 3),
  ): Float64Array {
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.sample([
        positions[index * 3],
        positions[index * 3 + 1],
        positions[index * 3 + 2],
      ]).elevationM;
    }
    return output;
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

  it('keeps optional visual skirts separate from the physics surface', () => {
    const mesh = generateTerrainPatchMesh(new ConstantTerrainField(), domain, {
      address,
      resolution: 4,
      skirtDepthM: 10,
    });

    expect(mesh.skirt).toBeDefined();
    expect(mesh.surface.positions).toHaveSize(25 * 3);
    expect(mesh.skirt!.positions.length).toBeGreaterThan(0);
    expect(mesh.skirt!.indices.length).toBeGreaterThan(0);
  });

  it('matches ordinary and differently refined sections around one transition patch', () => {
    const plane = new PlaneTerrainDomain(100);
    const field = new CurvedTerrainField();
    const transition = generateTerrainPatchMesh(field, plane, {
      address: { level: 0, x: 0, z: 0 },
      resolution: 16,
      baseResolution: 4,
      edgeRefinementLevels: [0, 2, 0, 0],
      edgeRefinementSegments: [
        [],
        [
          { start: 0, end: 0.5, levelDelta: 1 },
          { start: 0.5, end: 1, levelDelta: 2 },
        ],
        [],
        [],
      ],
    });
    const sameLevelNorth = generateTerrainPatchMesh(field, plane, {
      address: { level: 0, x: 0, z: -1 },
      resolution: 4,
    });
    const fineEastNorth = generateTerrainPatchMesh(field, plane, {
      address: { level: 1, x: 2, z: 0 },
      resolution: 4,
    });
    const fineEastSouthA = generateTerrainPatchMesh(field, plane, {
      address: { level: 2, x: 4, z: 2 },
      resolution: 4,
    });
    const fineEastSouthB = generateTerrainPatchMesh(field, plane, {
      address: { level: 2, x: 4, z: 3 },
      resolution: 4,
    });

    for (let sample = 0; sample <= 16; sample += 1) {
      const transitionNorth = worldVertex(transition, sample);
      const lower = Math.floor(sample / 4);
      const alpha = (sample % 4) / 4;
      const northLeft = worldVertex(sameLevelNorth, 4 * 5 + lower);
      const northRight = worldVertex(
        sameLevelNorth,
        4 * 5 + Math.min(4, lower + 1),
      );
      expectVectorClose(
        transitionNorth,
        interpolate(northLeft, northRight, alpha),
      );

      let expectedEast: TerrainVector3;
      if (sample <= 8) {
        const fineCoordinate = sample / 2;
        const fineLower = Math.floor(fineCoordinate);
        expectedEast = interpolate(
          worldVertex(fineEastNorth, fineLower * 5),
          worldVertex(fineEastNorth, Math.min(4, fineLower + 1) * 5),
          fineCoordinate - fineLower,
        );
      } else {
        const finePatch = sample <= 12 ? fineEastSouthA : fineEastSouthB;
        const fineSample = sample <= 12 ? sample - 8 : sample - 12;
        expectedEast = worldVertex(finePatch, fineSample * 5);
      }
      expectVectorClose(
        worldVertex(transition, sample * 17 + 16),
        expectedEast,
      );
    }
  });
});

function worldVertex(
  patch: ReturnType<typeof generateTerrainPatchMesh>,
  vertex: number,
): TerrainVector3 {
  const offset = vertex * 3;
  return [
    patch.centerWorldM[0] + patch.surface.positions[offset],
    patch.centerWorldM[1] + patch.surface.positions[offset + 1],
    patch.centerWorldM[2] + patch.surface.positions[offset + 2],
  ];
}

function interpolate(
  left: TerrainVector3,
  right: TerrainVector3,
  alpha: number,
): TerrainVector3 {
  return [
    left[0] * (1 - alpha) + right[0] * alpha,
    left[1] * (1 - alpha) + right[1] * alpha,
    left[2] * (1 - alpha) + right[2] * alpha,
  ];
}

function expectVectorClose(actual: TerrainVector3, expected: TerrainVector3): void {
  for (let axis = 0; axis < 3; axis += 1) {
    expect(actual[axis]).toBeCloseTo(expected[axis], 5);
  }
}
