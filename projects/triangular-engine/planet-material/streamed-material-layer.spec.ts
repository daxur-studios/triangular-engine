import { vec3, vec4 } from 'three/tsl';
import {
  bakeTerrainMaterialTile,
  TerrainMaterialTileGpu,
  type ITerrainMaterialResidentPage,
} from 'triangular-engine/terrain';
import { evaluateOnGpu } from './gpu-eval.testing';
import { streamedMaterialLayer } from './streamed-material-layer';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('streamedMaterialLayer on the GPU', () => {
  const root: ITerrainMaterialResidentPage = { address: { level: 0, x: 0, y: 0 }, slot: 0, lastUse: 0 };
  const COLOUR = [0.2, 0.4, 0.6];

  function bake(page: ITerrainMaterialResidentPage, rgb: number[]) {
    return bakeTerrainMaterialTile(
      {
        address: page.address,
        worldRevision: 'test',
        styleRevision: '1',
        samplingVersion: 1,
        format: 'rgba8-linear',
      },
      { sample: () => rgb as [number, number, number] },
      { interiorSize: 128, gutterSize: 2 },
    );
  }

  function publishedGpu(): TerrainMaterialTileGpu {
    const gpu = new TerrainMaterialTileGpu();
    const resident = new Map<string, ITerrainMaterialResidentPage>([['0/0/0', root]]);
    gpu.publish(bake(root, COLOUR), 0, resident);
    return gpu;
  }

  async function sampleAt(gpu: TerrainMaterialTileGpu, uvs: [number, number][], debug = 0) {
    gpu.debug.value = debug;
    const streamed = streamedMaterialLayer(gpu);
    const out = await evaluateOnGpu(
      uvs.map(([u, v]) => [[u, v, 0, 0]]),
      (at) => {
        const sample = streamed.layer(
          { uv: at(0).xy } as any,
          { albedo: vec3(0.9, 0.9, 0.9), roughness: 1, metalness: 0 } as any,
        );
        return vec4(sample.albedo, 1);
      },
    );
    return uvs.map((_, i) => [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]]);
  }

  it('reads the resident page colour through the directory (8-bit quantisation tolerance)', async () => {
    const gpu = publishedGpu();
    const result = await sampleAt(gpu, [[0.25, 0.5], [0.75, 0.3]]);
    result.forEach((rgb) => COLOUR.forEach((v, k) => expect(rgb[k]).toBeCloseTo(v, 1)));
    gpu.dispose();
  });

  it('follows a leaf table to a finer page when the directory points at one', async () => {
    const gpu = new TerrainMaterialTileGpu();
    const child: ITerrainMaterialResidentPage = { address: { level: 10, x: 300, y: 600 }, slot: 1, lastUse: 0 };
    const resident = new Map<string, ITerrainMaterialResidentPage>([
      ['0/0/0', root],
      ['10/300/600', child],
    ]);
    gpu.publish(bake(root, COLOUR), 0, resident);
    gpu.publish(bake(child, [0.9, 0.1, 0.1]), 1, resident);

    const [inChild, outside] = await sampleAt(gpu, [[300.5 / 1024, 600.5 / 1024], [0.9, 0.1]]);
    expect(inChild[0]).toBeCloseTo(0.9, 1);
    expect(inChild[1]).toBeCloseTo(0.1, 1);
    expect(outside[0]).toBeCloseTo(COLOUR[0], 1);
    gpu.dispose();
  });

  it('passes the layer below through until the first page is published', async () => {
    const gpu = new TerrainMaterialTileGpu();
    const [rgb] = await sampleAt(gpu, [[0.5, 0.5]]);
    rgb.forEach((v) => expect(v).toBeCloseTo(0.9, 4));
    gpu.dispose();
  });

  it('is a different graph from a plain colour (the check can fail)', async () => {
    const gpu = publishedGpu();
    const [debugged] = await sampleAt(gpu, [[0.5, 0.5]], 1);
    // Debug overlay tints toward the level colour, so it cannot equal the plain page colour.
    expect(Math.abs(debugged[0] - COLOUR[0]) + Math.abs(debugged[1] - COLOUR[1])).toBeGreaterThan(0.05);
    gpu.dispose();
  });
});
