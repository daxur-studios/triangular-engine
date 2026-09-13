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
});
