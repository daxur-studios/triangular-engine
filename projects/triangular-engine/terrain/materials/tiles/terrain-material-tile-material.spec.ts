import {
  createTerrainMaterialTileUniforms,
  createTerrainMaterialTileTexture,
  updateTerrainMaterialTileAtlasRegion,
} from './terrain-material-tile-material';
import { bakeTerrainMaterialTile } from './terrain-material-tile-baker';
import type { ITerrainMaterialTilePayload } from './terrain-material-tile';

function payload(value: number): ITerrainMaterialTilePayload {
  return {
    identity: {
      worldRevision: String(value),
      address: { level: 1, x: 0, y: 0 },
      styleRevision: 'style',
      samplingVersion: 1,
      format: 'rgba8-linear',
    },
    interiorSize: 2,
    gutterSize: 0,
    width: 2,
    height: 2,
    mipData: [new Uint8Array(2 * 2 * 4).fill(value)],
    byteLength: 2 * 2 * 4,
  };
}

describe('terrain material tile atlas adapter', () => {
  it('keeps each geographic fallback while pages resize and arrive out of order', () => {
    const uniforms = createTerrainMaterialTileUniforms();
    const makeTile = (value: number, interiorSize: number, gutterSize: number) =>
      bakeTerrainMaterialTile(payload(value).identity,
        { sample: () => [value / 255, 0, 0] },
        { interiorSize, gutterSize, mipLevels: 2 });
    const colours = [30, 60, 90, 120];
    for (let page = 0; page < 4; page += 1) {
      updateTerrainMaterialTileAtlasRegion(uniforms, makeTile(colours[page], 4, 1),
        page % 2, Math.floor(page / 2), [2, 2]);
    }
    // Test both increasing and decreasing resolution, with changed gutters.
    for (const size of [16, 8]) {
      for (const page of [3, 1, 0, 2]) {
        colours[page] += 10;
        const tile = makeTile(colours[page], size, 2);
        updateTerrainMaterialTileAtlasRegion(uniforms, tile,
          page % 2, Math.floor(page / 2), [2, 2]);
        const image = uniforms.texture.value.image;
        const data = image.data as Uint8Array;
        let mismatches = 0;
        for (let y = 0; y < image.height; y += 1) {
          for (let x = 0; x < image.width; x += 1) {
            const expected = colours[Math.floor(y / tile.height) * 2 + Math.floor(x / tile.width)];
            const offset = (y * image.width + x) * 4;
            if (data[offset] !== expected || data[offset + 3] !== 255) mismatches += 1;
          }
        }
        expect(mismatches).toBe(0);
      }
    }
    uniforms.texture.value.dispose();
  });

  it('preserves local texture coordinates when resizing pages with gutters', () => {
    const uniforms = createTerrainMaterialTileUniforms();
    const gradient = bakeTerrainMaterialTile(payload(0).identity,
      { sample: (u, v) => [u, v, 0] },
      { interiorSize: 4, gutterSize: 1 });
    updateTerrainMaterialTileAtlasRegion(uniforms, gradient, 0, 0, [2, 1]);
    const refined = bakeTerrainMaterialTile(payload(1).identity,
      { sample: () => [0, 0, 1] },
      { interiorSize: 12, gutterSize: 2 });
    updateTerrainMaterialTileAtlasRegion(uniforms, refined, 1, 0, [2, 1]);
    const image = uniforms.texture.value.image;
    const data = image.data as Uint8Array;
    for (let y = 4; y < 12; y += 1) {
      for (let x = 4; x < 12; x += 1) {
        const offset = (y * image.width + x) * 4;
        expect(Math.abs(data[offset] - (x - 2 + 0.5) / 12 * 255)).toBeLessThan(2);
        expect(Math.abs(data[offset + 1] - (y - 2 + 0.5) / 12 * 255)).toBeLessThan(2);
      }
    }
    uniforms.texture.value.dispose();
  });

  it('uploads every row and quadrant of a guttered atlas when mips are requested', () => {
    const uniforms = createTerrainMaterialTileUniforms();
    let residentTexture;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        const value = 40 * (1 + y * 2 + x);
        const tile = bakeTerrainMaterialTile(payload(value).identity,
          { sample: () => [value / 255, 0, 0] },
          { interiorSize: 64, gutterSize: 1, mipLevels: 6 });
        updateTerrainMaterialTileAtlasRegion(uniforms, tile, x, y, [2, 2]);
        residentTexture ??= uniforms.texture.value;
        expect(uniforms.texture.value).toBe(residentTexture);
      }
    }
    const texture = uniforms.texture.value;
    // Three uploads image.data only when explicit mipmaps are empty.
    expect(texture.mipmaps.length).toBe(0);
    expect(texture.generateMipmaps).toBeTrue();
    expect(texture.image.width).toBe(132);
    expect(texture.image.height).toBe(132);
    const data = texture.image.data as Uint8Array;
    let mismatches = 0;
    for (let y = 0; y < 132; y += 1) {
      for (let x = 0; x < 132; x += 1) {
        const offset = (y * 132 + x) * 4;
        const value = 40 * (1 + Math.floor(y / 66) * 2 + Math.floor(x / 66));
        if (data[offset] !== value || data[offset + 3] !== 255) mismatches += 1;
      }
    }
    expect(mismatches).toBe(0);
    texture.dispose();
  });

  it('includes the full resolution level in explicit DataTexture mipmaps', () => {
    const tile = bakeTerrainMaterialTile(payload(10).identity,
      { sample: (u, v) => [u, v, 0.5] },
      { interiorSize: 64, gutterSize: 1, mipLevels: 6 });
    const texture = createTerrainMaterialTileTexture(tile);
    expect(texture.mipmaps.length).toBe(tile.mipData.length);
    texture.mipmaps.forEach((mip, level) => {
      const image = mip as { width: number; height: number; data: Uint8Array };
      expect(image.width).toBe(Math.max(1, tile.width >> level));
      expect(image.height).toBe(Math.max(1, tile.height >> level));
      expect(image.data).toBe(tile.mipData[level]);
      expect(image.data.length).toBe(image.width * image.height * 4);
    });
    texture.dispose();
  });

  it('updates one regional page without replacing sibling pages', () => {
    const uniforms = createTerrainMaterialTileUniforms();
    updateTerrainMaterialTileAtlasRegion(uniforms, payload(10), 0, 0, [2, 1]);
    updateTerrainMaterialTileAtlasRegion(uniforms, payload(20), 1, 0, [2, 1]);

    const data = uniforms.texture.value.image.data as Uint8Array;
    expect(uniforms.texture.value.image.width).toBe(4);
    expect(data[0]).toBe(10);
    expect(data[2 * 4]).toBe(20);
    expect(uniforms.tileGrid.value).toEqual([2, 1]);
  });
});
