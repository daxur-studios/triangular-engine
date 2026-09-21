import type { ITerrainMaterialTileAddress } from './terrain-material-tile';

export function materialTileAddressKey(a: ITerrainMaterialTileAddress): string {
  return `${a.level}/${a.x}/${a.y}`;
}

export interface ITerrainMaterialTileSelection {
  /** Ancestors first; includes the pinned global root. */
  readonly addresses: readonly ITerrainMaterialTileAddress[];
  readonly refined: ReadonlySet<string>;
}

/** Unit-square quadtree selection, independent of mesh topology and renderer. */
export function selectTerrainMaterialTiles(options: {
  /** Projected tile extent in pixels; zero means outside the view. */
  readonly measure: (address: ITerrainMaterialTileAddress) => number;
  readonly targetTilePixels: number;
  readonly previousRefined?: ReadonlySet<string>;
  readonly maxLevel?: number;
  /** Includes ancestors, not merely leaves. */
  readonly maxTiles?: number;
}): ITerrainMaterialTileSelection {
  if (!(options.targetTilePixels > 0)) throw new RangeError('Positive texture pixel target required.');
  const maxLevel = Math.min(10, Math.max(0, options.maxLevel ?? 10));
  const maxTiles = Math.min(96, Math.max(1, options.maxTiles ?? 96));
  const root = { level: 0, x: 0, y: 0 };
  const addresses: ITerrainMaterialTileAddress[] = [root];
  const refined = new Set<string>();
  const frontier = [{ address: root, pixels: options.measure(root) }];
  while (frontier.length) {
    frontier.sort((a, b) => b.pixels - a.pixels);
    const candidate = frontier.shift()!;
    const a = candidate.address;
    const threshold = options.targetTilePixels *
      (options.previousRefined?.has(materialTileAddressKey(a)) ? 0.75 : 1);
    if (a.level >= maxLevel || candidate.pixels <= threshold) continue;
    const children = [0, 1, 2, 3].map(i => {
      const address = { level: a.level + 1, x: a.x * 2 + i % 2, y: a.y * 2 + Math.floor(i / 2) };
      return { address, pixels: options.measure(address) };
    }).filter(child => child.pixels > 0);
    if (addresses.length + children.length > maxTiles) continue;
    if (children.length) refined.add(materialTileAddressKey(a));
    for (const child of children) {
      addresses.push(child.address);
      frontier.push(child);
    }
  }
  return { addresses, refined };
}
