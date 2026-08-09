import {
  NavigationDataChangeSet,
  NavigationDomain,
  NavigationEdgeSnapshot,
  NavigationTileSnapshot,
} from './navigation-types';

export interface SyntheticNavigationFixtureOptions {
  readonly frameId?: string;
  readonly domain?: NavigationDomain;
  readonly tileSize?: number;
  readonly tilesAcross?: number;
  readonly tilesDown?: number;
}

/** Creates a deterministic plane-tile fixture for queue and planner benchmarks. */
export function createSyntheticNavigationFixture(
  options: SyntheticNavigationFixtureOptions = {},
): NavigationDataChangeSet {
  const frameId = options.frameId ?? 'fixture-plane';
  const domain = options.domain ?? 'ground';
  const tileSize = options.tileSize ?? 10;
  const tilesAcross = options.tilesAcross ?? 4;
  const tilesDown = options.tilesDown ?? 4;

  if (!Number.isFinite(tileSize) || tileSize <= 0 || !Number.isSafeInteger(tilesAcross) || tilesAcross <= 0
    || !Number.isSafeInteger(tilesDown) || tilesDown <= 0) {
    throw new Error('Synthetic navigation fixture dimensions must be positive.');
  }

  const upsertedTiles: NavigationTileSnapshot[] = [];
  const upsertedEdges: NavigationEdgeSnapshot[] = [];
  for (let row = 0; row < tilesDown; row += 1) {
    for (let column = 0; column < tilesAcross; column += 1) {
      const x = column * tileSize;
      const z = row * tileSize;
      upsertedTiles.push({
        id: `tile:${column}:${row}`,
        version: 1,
        frameId,
        regionId: `region:${column}:${row}`,
        domain,
        bounds: {
          minimum: { x, y: 0, z },
          maximum: { x: x + tileSize, y: 0, z: z + tileSize },
        },
      });

      const fromRegionId = `region:${column}:${row}`;
      for (const [nextColumn, nextRow] of [[column + 1, row], [column, row + 1]]) {
        if (nextColumn >= tilesAcross || nextRow >= tilesDown) {
          continue;
        }
        const toRegionId = `region:${nextColumn}:${nextRow}`;
        const edgeId = `edge:${column}:${row}:${nextColumn}:${nextRow}`;
        upsertedEdges.push(
          { id: `${edgeId}:forward`, version: 1, fromRegionId, toRegionId, domain, cost: tileSize },
          { id: `${edgeId}:reverse`, version: 1, fromRegionId: toRegionId, toRegionId: fromRegionId, domain, cost: tileSize },
        );
      }
    }
  }

  return { upsertedTiles, removedTileIds: [], upsertedEdges, removedEdgeIds: [] };
}
