import { NearestFilter, RepeatWrapping } from 'three';
import { createProceduralNormalMapTexture } from './procedural-normal-map';

describe('createProceduralNormalMapTexture', () => {
  it('produces a square texture at the requested size with repeat wrapping', () => {
    const texture = createProceduralNormalMapTexture({ size: 32 });
    expect(texture.image.width).toBe(32);
    expect(texture.image.height).toBe(32);
    expect(texture.wrapS).toBe(RepeatWrapping);
    expect(texture.wrapT).toBe(RepeatWrapping);
  });

  it('encodes unit-length normals at every sampled pixel', () => {
    const size = 16;
    const texture = createProceduralNormalMapTexture({ size });
    const data = texture.image.data as Uint8Array;
    for (let i = 0; i < size * size; i++) {
      const nx = (data[i * 4] / 255) * 2 - 1;
      const nz = (data[i * 4 + 1] / 255) * 2 - 1;
      const ny = (data[i * 4 + 2] / 255) * 2 - 1;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(length).toBeCloseTo(1, 1);
    }
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    const a = createProceduralNormalMapTexture({ size: 16, seed: 7 });
    const b = createProceduralNormalMapTexture({ size: 16, seed: 7 });
    const c = createProceduralNormalMapTexture({ size: 16, seed: 8 });
    expect(Array.from(a.image.data as Uint8Array)).toEqual(
      Array.from(b.image.data as Uint8Array),
    );
    expect(Array.from(a.image.data as Uint8Array)).not.toEqual(
      Array.from(c.image.data as Uint8Array),
    );
  });

  it('supports nearest filtering for intentionally chunky normals', () => {
    const texture = createProceduralNormalMapTexture({ filter: 'nearest' });
    expect(texture.magFilter).toBe(NearestFilter);
    expect(texture.minFilter).toBe(NearestFilter);
  });
});
