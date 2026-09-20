import { TerrainVector3 } from './terrain-math';

/** Index storage selected according to generated patch vertex count. */
export type TerrainPatchIndexArray = Uint16Array | Uint32Array;

/** A normalized section of one patch edge that borders a finer selected patch. */
export interface ITerrainPatchEdgeSegment {
  readonly start: number;
  readonly end: number;
  readonly levelDelta: number;
}

/** Edge sections in north, east, south, west order. */
export type TerrainPatchEdgeSegments = readonly [
  readonly ITerrainPatchEdgeSegment[],
  readonly ITerrainPatchEdgeSegment[],
  readonly ITerrainPatchEdgeSegment[],
  readonly ITerrainPatchEdgeSegment[],
];

/** Custom vertex attribute for transferable patch geometry (e.g. dual morph positions). */
export interface ITerrainPatchAttribute {
  readonly array: Float32Array;
  readonly itemSize: number;
}

/** Transferable patch geometry with no renderer or physics ownership. */
export interface ITerrainPatchGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors?: Float32Array;
  indices: TerrainPatchIndexArray;
  attributes?: Readonly<Record<string, ITerrainPatchAttribute | Float32Array>>;
}

/** Patch-local mesh shared by visual and future collider consumers. */
export interface ITerrainPatchMesh<TAddress> {
  address: TAddress;
  resolution: number;
  centerWorldM: TerrainVector3;
  surface: ITerrainPatchGeometry;
  /** Kept separate so physics never consumes visual seam-hiding geometry. */
  skirt?: ITerrainPatchGeometry;
  geometricErrorM: number;
}
