import { BoxGeometry, MeshBasicMaterial, PlaneGeometry } from 'three';

import { buildScatterInstancedMeshesByLod } from './scatter-lod-instanced-meshes';
import type { IScatterLodBucket } from '../terrain/scatter-lod-batches';
import type { ITerrainScatterInstance } from '../terrain/scatter-terrain-instances';

function instance(id: string, x: number): ITerrainScatterInstance {
  return {
    instanceId: id,
    worldPositionM: [x, 0, 0],
    normal: [0, 1, 0],
    surfaceUp: [0, 1, 0],
    rotationSeed01: 0,
    scaleSeed01: 0.5,
    embedSeed01: 0,
  };
}

describe('buildScatterInstancedMeshesByLod', () => {
  it('builds one InstancedMesh per bucket, using that tier\'s assets and castShadow', () => {
    const buckets: IScatterLodBucket[] = [
      {
        tierIndex: 0,
        lod: { kind: 'mesh', maxDistanceM: 50, castShadow: true },
        instances: [instance('a', 0), instance('b', 5)],
        alpha01ByInstanceId: new Map(),
      },
      {
        tierIndex: 1,
        lod: { kind: 'billboard', maxDistanceM: 200, castShadow: false },
        instances: [instance('c', 100)],
        alpha01ByInstanceId: new Map(),
      },
    ];

    const meshGeometry = new BoxGeometry(1, 1, 1);
    const billboardGeometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial();

    const result = buildScatterInstancedMeshesByLod({
      buckets,
      assetsByTier: (tierIndex) => ({
        geometry: tierIndex === 0 ? meshGeometry : billboardGeometry,
        material,
      }),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
    });

    expect(result.length).toBe(2);
    expect(result[0].mesh.count).toBe(2);
    expect(result[0].mesh.geometry).toBe(meshGeometry);
    expect(result[0].mesh.castShadow).toBe(true);
    expect(result[1].mesh.count).toBe(1);
    expect(result[1].mesh.geometry).toBe(billboardGeometry);
    expect(result[1].mesh.castShadow).toBe(false);
  });

  it('returns an empty array for empty buckets', () => {
    const result = buildScatterInstancedMeshesByLod({
      buckets: [],
      assetsByTier: () => ({ geometry: new BoxGeometry(), material: new MeshBasicMaterial() }),
      rules: { alignment: 'align-to-normal' },
      scale: { min: 1, max: 1 },
      anchorWorldM: [0, 0, 0],
    });
    expect(result).toEqual([]);
  });
});
