import {
  CellPlanetWorldCache,
  handleCellPlanetWorkerMessage,
  type CellPlanetMaterialTileWorkerRequest,
  type CellPlanetMeshWorkerRequest,
  type CellPlanetCellLookupWorkerRequest,
} from './cell-planet-worker-pipeline';
import type { ILatLonTerrainPatchAddress } from 'triangular-engine/terrain/core';

describe('cell-planet-worker-pipeline', () => {
  const address: ILatLonTerrainPatchAddress = {
    level: 0,
    x: 0,
    y: 0,
  };

  it('caches worlds and shares graph across archetypes with same seed', () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const worldVolcanic = cache.getOrCreateWorld('volcanic', 42);
    const worldMoon = cache.getOrCreateWorld('moon', 42);

    expect(worldVolcanic.graph).toBe(worldMoon.graph);
    expect(worldVolcanic.profile.archetype).not.toBe(worldMoon.profile.archetype);

    const worldVolcanicAgain = cache.getOrCreateWorld('volcanic', 42);
    expect(worldVolcanicAgain).toBe(worldVolcanic);
  });

  it('handles materialTile requests and produces transferable mips', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const request: CellPlanetMaterialTileWorkerRequest = {
      kind: 'materialTile',
      id: 101,
      colorMode: 'natural',
      materialTileResolution: 32,
      materialTileX: 0,
      materialTileY: 0,
      materialTileGrid: [2, 1],
      radius: 10,
      heightScale: 2,
      worldProfile: 'moon',
      seed: 7,
    };

    const { response, transfer } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
    expect(response.id).toBe(101);
    expect('materialTile' in response).toBeTrue();
    if ('materialTile' in response && response.materialTile) {
      expect(response.materialTile.width).toBeGreaterThan(0);
      expect(response.materialTile.mipData.length).toBeGreaterThan(0);
      expect(transfer.length).toBeGreaterThan(0);
    }
  });

  it('handles diagnostic heat and moisture material tiles', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    for (const colorMode of ['heat', 'moisture'] as const) {
      const request: CellPlanetMaterialTileWorkerRequest = {
        kind: 'materialTile',
        id: 110,
        colorMode,
        materialTileResolution: 16,
        materialTileX: 0,
        materialTileY: 0,
        materialTileGrid: [2, 1],
        radius: 10,
        worldProfile: 'terran',
        seed: 3,
      };
      const { response } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
      expect(response.id).toBe(110);
      expect('materialTile' in response && !!response.materialTile).toBeTrue();
    }
  });

  it('handles cellLookup requests', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const request: CellPlanetCellLookupWorkerRequest = {
      kind: 'cellLookup',
      id: 102,
      colorMode: 'material',
      worldProfile: 'mars',
      seed: 9,
    };

    const { response, transfer } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
    expect(response.id).toBe(102);
    if ('cellLookup' in response && response.cellLookup) {
      expect(response.cellLookup.cellTextureWidth).toBe(50);
      expect(response.cellLookup.cellIdData.length).toBeGreaterThan(0);
      expect(transfer.length).toBe(2);
    }
  });

  it('handles terrain mesh requests with dual-space positions, normals, and transfer buffers', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const request: CellPlanetMeshWorkerRequest = {
      id: 103,
      address,
      radius: 100,
      resolution: 4,
      baseResolution: 4,
      edgeRefinementLevels: [0, 0, 0, 0],
      reduction: 0,
      targetError: 1,
      colorMode: 'material',
      worldProfile: 'moon',
      seed: 12,
    };

    const { response, transfer } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
    expect(response.id).toBe(103);
    if ('patch' in response && response.patch) {
      const surface = response.patch.surface;
      expect(surface.positions.length).toBe((4 + 1) * (4 + 1) * 3);
      expect(surface.normals.length).toBe(surface.positions.length);
      expect(surface.attributes).toBeDefined();
      if (surface.attributes) {
        expect(surface.attributes['aSpherePos']).toBeDefined();
        expect(surface.attributes['aFlatPos']).toBeDefined();
        expect(surface.attributes['aSphereNorm']).toBeDefined();
        expect(surface.attributes['aFlatNorm']).toBeDefined();
        expect(surface.attributes['color']).toBeDefined();
        expect(surface.attributes['terrainMacroLandFactor']).toBeDefined();
      }

      // Normals should be finite and normalized
      const normals = surface.normals;
      for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
        expect(len).toBeCloseTo(1, 2);
      }
      expect(transfer.length).toBeGreaterThanOrEqual(10);
    }
  });

  it('handles mesh requests with recentring via renderOriginBodyFixedM', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const request: CellPlanetMeshWorkerRequest = {
      id: 104,
      address,
      radiusM: 6_000_000,
      heightScaleM: 10_000,
      renderOriginBodyFixedM: [6_000_000, 0, 0],
      resolution: 4,
      worldProfile: 'volcanic',
      seed: 1,
    };

    const { response } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
    expect(response.id).toBe(104);
    if ('patch' in response && response.patch) {
      expect(response.patch.centerWorldM).toBeDefined();
      const positions = response.patch.surface.positions;
      expect(Math.abs(positions[0])).toBeLessThan(4_500_000);
    }
  });

  it('keeps recentred flat and sphere positions continuous with the un-recentred mesh', async () => {
    const plainRequest: CellPlanetMeshWorkerRequest = {
      id: 201,
      address,
      radiusM: 6_000_000,
      heightScaleM: 10_000,
      resolution: 4,
      worldProfile: 'volcanic',
      seed: 1,
    };
    const recentredRequest: CellPlanetMeshWorkerRequest = {
      id: 202,
      address,
      radiusM: 6_000_000,
      heightScaleM: 10_000,
      renderOriginBodyFixedM: [6_000_000, 0, 0],
      resolution: 4,
      worldProfile: 'volcanic',
      seed: 1,
    };
    const plain = await handleCellPlanetWorkerMessage(plainRequest, {
      worldCache: new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 }),
    });
    const recentred = await handleCellPlanetWorkerMessage(recentredRequest, {
      worldCache: new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 }),
    });
    const plainPatch = 'patch' in plain.response ? plain.response.patch : undefined;
    const recentredPatch = 'patch' in recentred.response ? recentred.response.patch : undefined;
    expect(plainPatch).toBeDefined();
    expect(recentredPatch).toBeDefined();
    if (!plainPatch || !recentredPatch) return;

    // Attributes may be stored as a bare Float32Array or as { array, itemSize }.
    const float32Attribute = (attributes: unknown, name: string): Float32Array => {
      const value = (attributes as Record<string, unknown> | undefined)?.[name];
      const array = value instanceof Float32Array ? value : (value as { array?: Float32Array } | undefined)?.array;
      expect(array).toBeDefined();
      return array ?? new Float32Array(0);
    };
    // Recover absolute body-fixed positions: the stored value is relative to the patch centre
    // (centerWorldM) and the render origin, so add both back.
    type Patch = NonNullable<typeof recentredPatch>;
    const absolutePositions = (patch: Patch, name: string, origin: readonly [number, number, number]): number[] => {
      const values = float32Attribute(patch.surface.attributes, name);
      const [cx, cy, cz] = patch.centerWorldM;
      const out: number[] = [];
      for (let i = 0; i < values.length; i += 3) {
        out.push(
          values[i]! + cx + origin[0],
          values[i + 1]! + cy + origin[1],
          values[i + 2]! + cz + origin[2],
        );
      }
      return out;
    };

    const plainFlat = absolutePositions(plainPatch, 'aFlatPos', [0, 0, 0]);
    const recentredFlat = absolutePositions(recentredPatch, 'aFlatPos', [6_000_000, 0, 0]);
    const plainSphere = absolutePositions(plainPatch, 'aSpherePos', [0, 0, 0]);
    const recentredSphere = absolutePositions(recentredPatch, 'aSpherePos', [6_000_000, 0, 0]);

    expect(recentredFlat.length).toBe(plainFlat.length);
    expect(recentredSphere.length).toBe(plainSphere.length);
    // Float32 at ~6e6 m has ~0.5 m ulp, so allow a few metres of rounding slack.
    for (let i = 0; i < plainFlat.length; i += 1) {
      expect(Math.abs(recentredFlat[i]! - plainFlat[i]!)).toBeLessThan(5);
    }
    for (let i = 0; i < plainSphere.length; i += 1) {
      expect(Math.abs(recentredSphere[i]! - plainSphere[i]!)).toBeLessThan(5);
    }
  });

  it('handles mesh requests with simplification reduction', async () => {
    const cache = new CellPlanetWorldCache({ defaultCellCount: 50, defaultRelaxationIterations: 1 });
    const request: CellPlanetMeshWorkerRequest = {
      id: 105,
      address,
      radius: 100,
      resolution: 8,
      baseResolution: 8,
      simplify: {
        ratio: 0.5,
        targetError: 0.1,
      },
      colorMode: 'natural',
      worldProfile: 'terran',
      seed: 3,
    };

    const { response } = await handleCellPlanetWorkerMessage(request, { worldCache: cache });
    expect(response.id).toBe(105);
    if ('patch' in response && response.patch) {
      const originalIndexCount = 8 * 8 * 6;
      expect(response.patch.surface.indices.length).toBeLessThan(originalIndexCount);
    }
  });
});
