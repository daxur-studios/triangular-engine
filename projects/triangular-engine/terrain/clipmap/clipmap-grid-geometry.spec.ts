import { buildSharedGridBuffers } from './clipmap-grid-geometry';

describe('clipmap-grid-geometry', () => {
  it('throws when resolution is not a power of two', () => {
    expect(() => buildSharedGridBuffers(30, 4)).toThrowError();
    expect(() => buildSharedGridBuffers(33, 4)).toThrowError();
  });

  it('builds shared positions spanning unit range [-0.5, 0.5]', () => {
    const resolution = 32;
    const { positionAttribute } = buildSharedGridBuffers(resolution, 4);
    const vertsPerEdge = resolution + 1;
    expect(positionAttribute.count).toBe(vertsPerEdge * vertsPerEdge);

    const positions = positionAttribute.array as Float32Array;
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]!;
      const y = positions[i + 1]!;
      const z = positions[i + 2]!;
      expect(y).toBe(0);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    expect(minX).toBeCloseTo(-0.5, 5);
    expect(maxX).toBeCloseTo(0.5, 5);
    expect(minZ).toBeCloseTo(-0.5, 5);
    expect(maxZ).toBeCloseTo(0.5, 5);
  });

  it('clamps stride at resolution for far levels (1 quad per tile)', () => {
    const resolution = 32;
    const levelCount = 12;
    const { levelGeometries } = buildSharedGridBuffers(resolution, levelCount);

    expect(levelGeometries.length).toBe(levelCount);

    // Levels 0..5 (log2(32) = 5):
    // level 0: 32 quads per edge -> 32*32*6 = 6144 indices
    expect(levelGeometries[0]!.index!.count).toBe(32 * 32 * 6);
    // level 1: 16 quads per edge -> 16*16*6 = 1536 indices
    expect(levelGeometries[1]!.index!.count).toBe(16 * 16 * 6);
    // level 5: 1 quad per edge -> 1*1*6 = 6 indices
    expect(levelGeometries[5]!.index!.count).toBe(6);

    // Levels 6..11 are clamped to 1 quad per tile -> 6 indices
    for (let level = 6; level < levelCount; level++) {
      expect(levelGeometries[level]!.index!.count).toBe(6);
    }
  });

  it('ensures all index values are valid vertex buffer references', () => {
    const resolution = 32;
    const { positionAttribute, levelGeometries } = buildSharedGridBuffers(resolution, 8);
    const maxIndex = positionAttribute.count - 1;

    for (const geom of levelGeometries) {
      const indices = geom.index!.array as Uint32Array;
      for (let i = 0; i < indices.length; i++) {
        expect(indices[i]!).toBeLessThanOrEqual(maxIndex);
        expect(indices[i]!).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
