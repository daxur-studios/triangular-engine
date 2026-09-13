import {
  buildClipmapTiles,
  groupTilesByLevel,
  type IClipmapTile,
} from './clipmap-layout';

describe('clipmap-layout', () => {
  const baseTileSizeM = 16;
  const blockRadiusTiles = 4;
  const maxInstancesPerLevel = (2 * blockRadiusTiles) ** 2; // 64

  it('bounds instances per level strictly within (2*radius)^2', () => {
    const levelCount = 12;
    const tiles = buildClipmapTiles(
      1234.56,
      -789.12,
      baseTileSizeM,
      levelCount,
      blockRadiusTiles,
    );
    const groups = groupTilesByLevel(tiles, levelCount);

    expect(groups.length).toBe(levelCount);
    for (let level = 0; level < levelCount; level++) {
      expect(groups[level]!.length).toBeLessThanOrEqual(maxInstancesPerLevel);
    }
  });

  it('renders level 0 as a complete block and coarser levels as rings', () => {
    const levelCount = 4;
    const tiles = buildClipmapTiles(0, 0, baseTileSizeM, levelCount, blockRadiusTiles);
    const groups = groupTilesByLevel(tiles, levelCount);

    // Level 0 has no finer level covering it, so it must render the full block (64 tiles)
    expect(groups[0]!.length).toBe(maxInstancesPerLevel);

    // Levels 1..3 must have an interior hole where finer levels exist, so count < 64
    for (let level = 1; level < levelCount; level++) {
      expect(groups[level]!.length).toBeLessThan(maxInstancesPerLevel);
      expect(groups[level]!.length).toBeGreaterThan(0);
    }
  });

  it('ensures no two tiles at the same level overlap', () => {
    const levelCount = 4;
    const tiles = buildClipmapTiles(45.7, 92.3, baseTileSizeM, levelCount, blockRadiusTiles);
    const groups = groupTilesByLevel(tiles, levelCount);

    for (let level = 0; level < levelCount; level++) {
      const levelTiles = groups[level]!;
      for (let i = 0; i < levelTiles.length; i++) {
        for (let j = i + 1; j < levelTiles.length; j++) {
          const a = levelTiles[i]!;
          const b = levelTiles[j]!;
          const dx = Math.abs(a.centerXM - b.centerXM);
          const dz = Math.abs(a.centerZM - b.centerZM);
          const minSeparation = a.sizeM - 1e-4;
          const separated = dx >= minSeparation || dz >= minSeparation;
          expect(separated).toBeTrue();
        }
      }
    }
  });

  it('remains stable across fractional and off-center camera offsets', () => {
    const testOffsets = [
      [0, 0],
      [0.5, 0.5],
      [15.99, 15.99],
      [16.01, 16.01],
      [-500.3, 12000.7],
      [100000.2, -50000.8],
    ];

    for (const [camX, camZ] of testOffsets) {
      const tiles = buildClipmapTiles(camX, camZ, baseTileSizeM, 6, blockRadiusTiles);
      expect(tiles.length).toBeGreaterThan(0);
      const groups = groupTilesByLevel(tiles, 6);
      expect(groups[0]!.length).toBe(maxInstancesPerLevel);
    }
  });

  it('guarantees Level L bounding box aligns to Level L+1 tile size (zero partial overlap)', () => {
    const testCameras = [
      [0, 0],
      [15.5, 31.2],
      [60, 60],
      [-123.4, 567.8],
      [999.9, -888.8],
    ];

    for (const [camX, camZ] of testCameras) {
      const tiles = buildClipmapTiles(camX, camZ, baseTileSizeM, 6, blockRadiusTiles);
      for (let l = 0; l < 5; l++) {
        const lTiles = tiles.filter((t) => t.level === l);
        const minX = Math.min(...lTiles.map((t) => t.centerXM - t.sizeM / 2));
        const maxX = Math.max(...lTiles.map((t) => t.centerXM + t.sizeM / 2));
        const minZ = Math.min(...lTiles.map((t) => t.centerZM - t.sizeM / 2));
        const maxZ = Math.max(...lTiles.map((t) => t.centerZM + t.sizeM / 2));

        const nextTileSizeM = baseTileSizeM * 2 ** (l + 1);
        expect(Math.abs(minX % nextTileSizeM)).toBe(0);
        expect(Math.abs(maxX % nextTileSizeM)).toBe(0);
        expect(Math.abs(minZ % nextTileSizeM)).toBe(0);
        expect(Math.abs(maxZ % nextTileSizeM)).toBe(0);

        // Check that no Level L+1 tile partially cuts through Level L's box
        const nextTiles = tiles.filter((t) => t.level === l + 1);
        for (const nt of nextTiles) {
          const ntMinX = nt.centerXM - nt.sizeM / 2;
          const ntMaxX = nt.centerXM + nt.sizeM / 2;
          const ntMinZ = nt.centerZM - nt.sizeM / 2;
          const ntMaxZ = nt.centerZM + nt.sizeM / 2;

          const insideX = ntMinX >= minX && ntMaxX <= maxX;
          const insideZ = ntMinZ >= minZ && ntMaxZ <= maxZ;
          // Tile must NOT be strictly inside the finer level's box
          expect(insideX && insideZ).toBeFalse();

          // And must not cross into the box partially
          const xIntersect = Math.max(0, Math.min(ntMaxX, maxX) - Math.max(ntMinX, minX));
          const zIntersect = Math.max(0, Math.min(ntMaxZ, maxZ) - Math.max(ntMinZ, minZ));
          expect(xIntersect > 0 && zIntersect > 0).toBeFalse();
        }
      }
    }
  });
});
