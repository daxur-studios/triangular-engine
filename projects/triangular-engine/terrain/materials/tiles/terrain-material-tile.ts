import type { TerrainMaterialRgb } from '../terrain-material';

/** Address of a material tile in a 2D domain. Domain adapters may add a face. */
export interface ITerrainMaterialTileAddress {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly face?: string | number;
}

/** Stable, serializable identity for a tile. */
export interface ITerrainMaterialTileIdentity {
  readonly worldRevision: string;
  readonly address: ITerrainMaterialTileAddress;
  readonly styleRevision: string;
  readonly editRevision?: string;
  readonly samplingVersion: number;
  readonly format: 'rgba8-linear';
}

export interface ITerrainMaterialTileBakeOptions {
  /** Number of sampled texels excluding the border gutter. */
  readonly interiorSize: number;
  /** Duplicate sampling margin used by linear filtering and mip generation. */
  readonly gutterSize: number;
  /** Number of additional mip levels. Zero keeps only the baked level. */
  readonly mipLevels?: number;
}

/** CPU-side source used by the generic baker. Values are linear RGB in 0..1. */
export interface ITerrainMaterialTileSource {
  sample(
    localU: number,
    localV: number,
    address: ITerrainMaterialTileAddress,
  ): TerrainMaterialRgb;
}

export interface ITerrainMaterialTilePayload {
  readonly identity: ITerrainMaterialTileIdentity;
  readonly interiorSize: number;
  readonly gutterSize: number;
  readonly width: number;
  readonly height: number;
  /** Level zero first; every array is RGBA8 linear data. */
  readonly mipData: readonly Uint8Array[];
  readonly byteLength: number;
}

export function terrainMaterialTileKey(identity: ITerrainMaterialTileIdentity): string {
  const address = identity.address;
  const face = address.face === undefined ? '' : `:${String(address.face)}`;
  const edit = identity.editRevision === undefined ? '' : `:${identity.editRevision}`;
  return [
    identity.worldRevision,
    identity.styleRevision,
    identity.samplingVersion,
    identity.format,
    address.level,
    address.x,
    address.y,
    face,
    edit,
  ].join(':');
}

export function validateTerrainMaterialTileAddress(
  address: ITerrainMaterialTileAddress,
): void {
  if (
    !Number.isInteger(address.level) ||
    address.level < 0 ||
    !Number.isInteger(address.x) ||
    address.x < 0 ||
    !Number.isInteger(address.y) ||
    address.y < 0
  ) {
    throw new RangeError('Terrain material tile address must contain non-negative integers.');
  }
}

export function validateTerrainMaterialTileBakeOptions(
  options: ITerrainMaterialTileBakeOptions,
): void {
  if (
    !Number.isInteger(options.interiorSize) ||
    options.interiorSize < 2 ||
    !Number.isInteger(options.gutterSize) ||
    options.gutterSize < 0 ||
    !Number.isInteger(options.mipLevels ?? 0) ||
    (options.mipLevels ?? 0) < 0
  ) {
    throw new RangeError(
      'Terrain material tile options require interiorSize >= 2 and non-negative integer gutter/mip values.',
    );
  }
}
