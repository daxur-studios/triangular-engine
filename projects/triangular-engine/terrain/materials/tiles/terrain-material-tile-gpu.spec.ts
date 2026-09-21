import { MeshStandardMaterial } from 'three';
import { buildTerrainMaterialPageTable, enableStreamedTerrainMaterial, TerrainMaterialTileGpu } from './terrain-material-tile-gpu';
import { bakeTerrainMaterialTile } from './terrain-material-tile-baker';
import type { ITerrainMaterialResidentPage } from './terrain-material-tile-stream';

describe('streamed material mapping and storage', () => {
  const root: ITerrainMaterialResidentPage = { address: { level: 0, x: 0, y: 0 }, slot: 0, lastUse: 0 };
  function lookup(table: ReturnType<typeof buildTerrainMaterialPageTable>, u: number, v: number) {
    const offset = (Math.floor(v * 32) * 32 + Math.floor(u * 32)) * 4;
    let entry = table.directory.slice(offset, offset + 4);
    if (entry[0] < 0) {
      const leafOffset = ((Math.floor(v * 1024) % 32) * 32 + Math.floor(u * 1024) % 32) * 4;
      entry = table.leaves[-entry[0] - 1].slice(leafOffset, leafOffset + 4);
    }
    return [...entry];
  }

  it('resolves sparse level-10 pages and correct ancestors without a dense table', () => {
    const parent = { address: { level: 2, x: 1, y: 2 }, slot: 1, lastUse: 0 };
    const child = { address: { level: 10, x: 300, y: 600 }, slot: 2, lastUse: 0 };
    const table = buildTerrainMaterialPageTable([child, root, parent]);
    expect(table.leaves.length).toBe(1);
    expect(lookup(table, 300.5 / 1024, 600.5 / 1024)).toEqual([2, 10, 300, 600]);
    expect(lookup(table, 301.5 / 1024, 600.5 / 1024)).toEqual([1, 2, 1, 2]);
    expect(lookup(table, 0.9, 0.1)).toEqual([0, 0, 0, 0]);
    const evicted = buildTerrainMaterialPageTable([root, parent]);
    expect(lookup(evicted, 300.5 / 1024, 600.5 / 1024)).toEqual([1, 2, 1, 2]);
  });

  it('marks only changed colour layers for upload and retains correct sampled gutters', () => {
    const gpu = new TerrainMaterialTileGpu();
    const resident = new Map<string, ITerrainMaterialResidentPage>();
    const make = (page: ITerrainMaterialResidentPage) => bakeTerrainMaterialTile({ address: page.address,
      worldRevision: 'test', styleRevision: '1', samplingVersion: 1, format: 'rgba8-linear' },
      { sample: (u, v, a) => [(a.x + u) / 2 ** a.level, (a.y + v) / 2 ** a.level, 0.5] },
      { interiorSize: 128, gutterSize: 2 });
    resident.set('0/0/0', root);
    gpu.publish(make(root), 0, resident);
    gpu.pages.clearLayerUpdates();
    const left = { address: { level: 1, x: 0, y: 0 }, slot: 1, lastUse: 0 };
    const right = { address: { level: 1, x: 1, y: 0 }, slot: 2, lastUse: 0 };
    resident.set('1/0/0', left);
    gpu.publish(make(left), 1, resident);
    expect([...gpu.pages.layerUpdates]).toEqual([1]);
    resident.set('1/1/0', right);
    gpu.publish(make(right), 2, resident);
    expect([...gpu.pages.layerUpdates]).toEqual([1, 2]);
    const a = make(left).mipData[0], b = make(right).mipData[0];
    // Each shared border uses identical geographic samples, including gutter support.
    for (let y = 0; y < 132; y++) {
      expect(a[(y * 132 + 129) * 4]).toBe(b[(y * 132 + 1) * 4]);
      expect(a[(y * 132 + 130) * 4]).toBe(b[(y * 132 + 2) * 4]);
    }
    expect(gpu.pages.generateMipmaps).toBeFalse();
    expect(gpu.allocatedBytes).toBeLessThan(64 * 1024 * 1024);
    gpu.dispose();
  });

  it('uses its own varying without redeclaring the Three.js uv attribute', () => {
    const gpu = new TerrainMaterialTileGpu();
    const material = new MeshStandardMaterial();
    enableStreamedTerrainMaterial(material, gpu);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>' };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('vTerrainStreamUv = uv;');
    expect(shader.vertexShader).not.toContain('attribute vec2 uv');
    expect(shader.fragmentShader).toContain('textureLod(uTerrainStreamPages');
    expect(shader.fragmentShader).not.toContain('vUv');
    gpu.dispose(); material.dispose();
  });

  it('changes displayed LOD without rebaking or evicting cached detail', () => {
    const gpu = new TerrainMaterialTileGpu();
    const child = { address: { level: 1, x: 0, y: 0 }, slot: 1, lastUse: 0 };
    const resident = new Map([['0/0/0', root], ['1/0/0', child]]);
    gpu.setSelection([root.address, child.address], resident);
    const data = gpu.directory.image.data as Float32Array;
    expect(data[0]).toBe(1);
    gpu.setSelection([root.address], resident);
    expect(data[0]).toBe(0);
    gpu.setSelection([root.address, child.address], resident);
    expect(data[0]).toBe(1);
    expect(resident.size).toBe(2);
    expect(gpu.pages.layerUpdates.size).toBe(0);
    gpu.dispose();
  });
});
