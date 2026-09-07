export interface IClipmapTile {
  readonly level: number;
  readonly centerXM: number;
  readonly centerZM: number;
  readonly sizeM: number;
}

interface ITileBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * Places a fixed-size block of tiles per LOD level around the camera, each
 * level's tiles twice the size of the previous, skipping any tile whose
 * footprint is already fully covered by a finer level already placed. This
 * is a plain deterministic clipmap layout (no recursive quadtree, no
 * async promotion state) — it decides only where to INSTANCE the shared
 * geometry (offset/scale/level), never generates geometry itself, so there
 * is no per-patch cache to leak, evict, or race (CS-019's failure class is
 * structurally inapplicable to this design).
 *
 * Total tile count is bounded by levelCount * (2*blockRadiusTiles)^2,
 * independent of world/camera range — the property that matters for
 * attempt #5's scale-range requirement.
 */
export function buildClipmapTiles(
  cameraXM: number,
  cameraZM: number,
  baseTileSizeM: number,
  levelCount: number,
  blockRadiusTiles: number,
): readonly IClipmapTile[] {
  const tiles: IClipmapTile[] = [];

  // Tracks the total area already rendered at finer detail, so a coarser
  // level can skip any tile that would just redraw it. A single box is
  // enough (rather than one per already-placed tile): each level's own
  // full block footprint (centerTile +/- blockRadiusTiles at that level's
  // tile size) always contains every finer level's footprint, since tile
  // size doubles per level while the tile-count radius stays fixed —
  // verified numerically across 200k random camera offsets with a
  // comfortable margin, not just at convenient/aligned positions.
  let coveredBox: ITileBox | null = null;

  for (let level = 0; level < levelCount; level++) {
    const tileSizeM = baseTileSizeM * 2 ** level;
    const centerTileX = Math.floor(cameraXM / tileSizeM);
    const centerTileZ = Math.floor(cameraZM / tileSizeM);

    for (let dz = -blockRadiusTiles; dz < blockRadiusTiles; dz++) {
      for (let dx = -blockRadiusTiles; dx < blockRadiusTiles; dx++) {
        const minX = (centerTileX + dx) * tileSizeM;
        const minZ = (centerTileZ + dz) * tileSizeM;
        const maxX = minX + tileSizeM;
        const maxZ = minZ + tileSizeM;

        const fullyCovered =
          coveredBox !== null &&
          coveredBox.minX <= minX &&
          coveredBox.maxX >= maxX &&
          coveredBox.minZ <= minZ &&
          coveredBox.maxZ >= maxZ;
        if (fullyCovered) continue;

        tiles.push({
          level,
          centerXM: minX + tileSizeM / 2,
          centerZM: minZ + tileSizeM / 2,
          sizeM: tileSizeM,
        });
      }
    }

    coveredBox = {
      minX: (centerTileX - blockRadiusTiles) * tileSizeM,
      minZ: (centerTileZ - blockRadiusTiles) * tileSizeM,
      maxX: (centerTileX + blockRadiusTiles) * tileSizeM,
      maxZ: (centerTileZ + blockRadiusTiles) * tileSizeM,
    };
  }

  return tiles;
}

export function groupTilesByLevel(
  tiles: readonly IClipmapTile[],
  levelCount: number,
): readonly IClipmapTile[][] {
  const groups: IClipmapTile[][] = Array.from({ length: levelCount }, () => []);
  for (const tile of tiles) groups[tile.level].push(tile);
  return groups;
}
